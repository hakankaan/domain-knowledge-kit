import type { Command as Cmd } from "commander";
import { existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDomainModel } from "../../../shared/loader.js";
import { contextsDir, adrDir } from "../../../shared/paths.js";
import { DomainGraph } from "../../../shared/graph.js";
import type { NodeKind, GraphNode } from "../../../shared/graph.js";
import { parseYaml, stringifyYaml } from "../../../shared/yaml.js";
import {
  classifyId,
  KIND_TO_DIR,
  removeGlossaryEntry,
  removeActorEntry,
  removeFlowFromIndex,
  removeFlowStepsForItem,
  removeFlowStepsForContext,
  removeContextFromIndex,
  cleanDomainItemRef,
  updateAdrFrontmatter,
  allAdrFiles,
  allDomainFiles,
  printDiff,
} from "../refactor-helpers.js";

// ── Dependent detection ───────────────────────────────────────────────

/**
 * Find all items that hold YAML references to the node being removed.
 *
 * Extends the basic "edge.to === id" check with cases where the graph
 * edge goes FROM the removed node, but the TARGET file holds the back-
 * reference (e.g. event.raised_by, policy.when.events, command.actor).
 */
function findDependents(
  graph: DomainGraph,
  id: string,
  nodeKind: NodeKind,
): Set<string> {
  const dependents = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.label === "contains") continue;
    // Target of an edge points to this node → source holds reference
    if (edge.to === id) {
      dependents.add(edge.from);
    }
    // Source is this node; check edge labels where the TARGET holds a
    // back-reference in its own file.
    if (edge.from === id) {
      if (edge.label === "triggers") {
        // event --triggers--> policy: policy.when.events references this event
        dependents.add(edge.to);
      } else if (edge.label === "initiates") {
        // actor --initiates--> command: command.actor references this actor
        dependents.add(edge.to);
      } else if (
        nodeKind === "aggregate" &&
        (edge.label === "emits" || edge.label === "handles")
      ) {
        // aggregate --emits--> event: event.raised_by references this aggregate
        // aggregate --handles--> command: command.handled_by references this aggregate
        dependents.add(edge.to);
      }
    }
  }
  return dependents;
}

// ── Inline YAML helpers ───────────────────────────────────────────────

/** Remove an adr_ref entry from a domain YAML file (YAML-aware). */
function cleanAdrRef(
  filePath: string,
  adrId: string,
  showDiff: boolean,
): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  const data = parseYaml<{ adr_refs?: string[] }>(content);
  if (!data.adr_refs?.includes(adrId)) return;
  data.adr_refs = data.adr_refs.filter((r) => r !== adrId);
  if (data.adr_refs.length === 0) delete data.adr_refs;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(filePath, content, newContent);
  writeFileSync(filePath, newContent, "utf-8");
}

/** Remove a scoped ID from domain_refs or any list field in a YAML file. */
function cleanScopedIdFromFile(
  filePath: string,
  scopedId: string,
  showDiff: boolean,
): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  const data = parseYaml<Record<string, unknown>>(content);
  let changed = false;

  for (const key of ["domain_refs", "adr_refs"]) {
    const arr = data[key] as string[] | undefined;
    if (arr?.includes(scopedId)) {
      const filtered = arr.filter((r) => r !== scopedId);
      if (filtered.length === 0) delete data[key];
      else data[key] = filtered;
      changed = true;
    }
  }
  if (!changed) return;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(filePath, content, newContent);
  writeFileSync(filePath, newContent, "utf-8");
}

// ── Per-kind removal helpers ──────────────────────────────────────────

function rmActor(
  actorName: string,
  graph: DomainGraph,
  opts: { root?: string; force?: boolean; diff?: boolean },
): void {
  const actorNodeId = `actor.${actorName}`;
  if (!graph.hasNode(actorNodeId)) {
    console.error(`Actor '${actorName}' not found.`);
    process.exit(1);
  }

  const dependents = findDependents(graph, actorNodeId, "actor");
  const realDeps = new Set(
    [...dependents].filter((d) => graph.nodes.get(d)?.kind !== "adr"),
  );

  if (realDeps.size > 0 && !opts.force) {
    console.error(`Cannot remove actor '${actorName}'. It is referenced by:`);
    for (const dep of realDeps) console.error(`  - ${dep}`);
    console.error(`\nUse --force to clean up references and remove.`);
    process.exit(1);
  }

  if (realDeps.size > 0 && opts.force) {
    const ctxBase = contextsDir(opts.root);
    for (const depId of realDeps) {
      const depNode = graph.nodes.get(depId);
      if (!depNode?.context) continue;
      const typeDir = KIND_TO_DIR[depNode.kind];
      if (!typeDir) continue;
      const filePath = join(ctxBase, depNode.context, typeDir, `${depNode.name}.yml`);
      cleanDomainItemRef(filePath, depNode.kind, actorName, opts.diff ?? false);
    }
  }

  removeActorEntry(opts.root, actorName, opts.diff ?? false);
  console.log(`Successfully removed actor '${actorName}'.`);
}

function rmFlow(
  flowName: string,
  graph: DomainGraph,
  opts: { root?: string; diff?: boolean },
): void {
  if (!graph.hasNode(`flow.${flowName}`)) {
    console.error(`Flow '${flowName}' not found.`);
    process.exit(1);
  }
  removeFlowFromIndex(opts.root, flowName, opts.diff ?? false);
  console.log(`Successfully removed flow '${flowName}'.`);
}

function rmAdr(
  adrId: string,
  graph: DomainGraph,
  opts: { root?: string; force?: boolean; diff?: boolean },
): void {
  if (!graph.hasNode(adrId)) {
    console.error(`ADR '${adrId}' not found.`);
    process.exit(1);
  }

  const dependents = findDependents(graph, adrId, "adr");
  const domainDeps: GraphNode[] = [];
  const adrDeps: GraphNode[] = [];
  for (const depId of dependents) {
    const node = graph.nodes.get(depId);
    if (!node) continue;
    if (node.kind === "adr") adrDeps.push(node);
    else domainDeps.push(node);
  }

  if ((domainDeps.length > 0 || adrDeps.length > 0) && !opts.force) {
    console.error(`Cannot remove '${adrId}'. It is referenced by:`);
    for (const n of [...domainDeps, ...adrDeps]) console.error(`  - ${n.id}`);
    console.error(`\nUse --force to clean up references and remove.`);
    process.exit(1);
  }

  if (opts.force) {
    const ctxBase = contextsDir(opts.root);
    for (const node of domainDeps) {
      if (!node.context || node.kind === "glossary") continue;
      const typeDir = KIND_TO_DIR[node.kind];
      if (!typeDir) continue;
      const filePath = join(ctxBase, node.context, typeDir, `${node.name}.yml`);
      cleanAdrRef(filePath, adrId, opts.diff ?? false);
    }
    const adrBase = adrDir(opts.root);
    for (const node of adrDeps) {
      const filePath = join(adrBase, `${node.name}.md`);
      updateAdrFrontmatter(
        filePath,
        (fm) => {
          if (fm["superseded_by"] !== adrId) return false;
          delete fm["superseded_by"];
          return true;
        },
        opts.diff ?? false,
      );
    }
  }

  const adrPath = join(adrDir(opts.root), `${adrId}.md`);
  if (!existsSync(adrPath)) {
    console.error(`ADR file not found: ${adrPath}`);
    process.exit(1);
  }
  if (opts.diff) {
    console.log(`\n--- a/${adrPath}\n+++ /dev/null`);
    console.log(`- (File deleted: ${adrPath})`);
  }
  rmSync(adrPath);
  console.log(`Successfully removed '${adrId}'.`);
}

function rmContext(
  ctxName: string,
  graph: DomainGraph,
  opts: { root?: string; force?: boolean; diff?: boolean },
): void {
  if (!graph.hasNode(`context.${ctxName}`)) {
    console.error(`Context '${ctxName}' not found.`);
    process.exit(1);
  }

  const ctxDir = join(contextsDir(opts.root), ctxName);
  const ctxItems = [...graph.nodes.values()].filter((n) => n.context === ctxName);
  const hasItems = ctxItems.some((n) => n.kind !== "context");

  // Find external nodes (outside this context) that reference items in this context
  const externalRefs = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.label === "contains") continue;
    const toCtx = graph.nodes.get(edge.to)?.context;
    const fromNode = graph.nodes.get(edge.from);
    if (toCtx === ctxName && fromNode?.context !== ctxName) {
      externalRefs.add(edge.from);
    }
  }

  if ((hasItems || externalRefs.size > 0) && !opts.force) {
    if (hasItems) {
      console.error(
        `Cannot remove context '${ctxName}': it contains ${ctxItems.filter((n) => n.kind !== "context").length} item(s).`,
      );
    }
    if (externalRefs.size > 0) {
      console.error(`Cannot remove context '${ctxName}': it has external references:`);
      for (const ref of externalRefs) console.error(`  - ${ref}`);
    }
    console.error(`\nUse --force to clean up all references and remove.`);
    process.exit(1);
  }

  if (opts.force) {
    // Remove flow steps that reference items in this context
    removeFlowStepsForContext(opts.root, ctxName, opts.diff ?? false);

    // Remove domain_refs in ADRs pointing to items in this context
    for (const adrFilePath of allAdrFiles(opts.root)) {
      updateAdrFrontmatter(
        adrFilePath,
        (fm) => {
          const refs = fm["domain_refs"] as string[] | undefined;
          if (!refs?.length) return false;
          const filtered = refs.filter((r) => !r.startsWith(`${ctxName}.`));
          if (filtered.length === refs.length) return false;
          if (filtered.length === 0) delete fm["domain_refs"];
          else fm["domain_refs"] = filtered;
          return true;
        },
        opts.diff ?? false,
      );
    }

    // Remove cross-context references in other domain item files
    for (const filePath of allDomainFiles(opts.root)) {
      if (filePath.includes(`/contexts/${ctxName}/`)) continue;
      for (const itemNode of ctxItems) {
        if (itemNode.kind === "context") continue;
        cleanScopedIdFromFile(filePath, itemNode.id, opts.diff ?? false);
      }
    }
  }

  if (opts.diff) {
    console.log(`\n--- a/${ctxDir}/\n+++ /dev/null\n- (Directory removed: ${ctxDir}/)`);
  }
  rmSync(ctxDir, { recursive: true });

  removeContextFromIndex(opts.root, ctxName, opts.diff ?? false);
  console.log(`Successfully removed context '${ctxName}'.`);
}

function rmDomainItem(
  id: string,
  graph: DomainGraph,
  opts: { root?: string; force?: boolean; diff?: boolean },
): void {
  const dot = id.indexOf(".");
  const ctx = id.slice(0, dot);
  const name = id.slice(dot + 1);

  if (!graph.hasNode(id)) {
    console.error(`Item '${id}' not found.`);
    process.exit(1);
  }

  const node = graph.nodes.get(id)!;
  const dependents = findDependents(graph, id, node.kind);
  const realDeps = new Set(
    [...dependents].filter((d) => graph.nodes.get(d)?.kind !== "context"),
  );

  if (realDeps.size > 0 && !opts.force) {
    console.error(`Cannot remove '${id}'. It is referenced by:`);
    for (const dep of realDeps) console.error(`  - ${dep}`);
    console.error(`\nUse --force to clean up references and remove.`);
    process.exit(1);
  }

  if (realDeps.size > 0 && opts.force) {
    const ctxBase = contextsDir(opts.root);
    for (const depId of realDeps) {
      const depNode = graph.nodes.get(depId)!;

      if (depNode.kind === "adr") {
        const adrFilePath = join(adrDir(opts.root), `${depNode.name}.md`);
        updateAdrFrontmatter(
          adrFilePath,
          (fm) => {
            const refs = fm["domain_refs"] as string[] | undefined;
            if (!refs?.includes(id)) return false;
            const filtered = refs.filter((r) => r !== id);
            if (filtered.length === 0) delete fm["domain_refs"];
            else fm["domain_refs"] = filtered;
            return true;
          },
          opts.diff ?? false,
        );
        continue;
      }

      if (depNode.kind === "flow") {
        removeFlowStepsForItem(opts.root, id, opts.diff ?? false);
        continue;
      }

      if (depNode.kind === "context" || depNode.kind === "glossary") continue;

      if (!depNode.context) continue;

      const typeDir = KIND_TO_DIR[depNode.kind];
      if (!typeDir) continue;
      const filePath = join(ctxBase, depNode.context, typeDir, `${depNode.name}.yml`);
      cleanDomainItemRef(filePath, depNode.kind, name, opts.diff ?? false);
    }
  }

  const ctxDir = join(contextsDir(opts.root), ctx);

  if (node.kind === "glossary") {
    removeGlossaryEntry(ctxDir, name, opts.diff ?? false);
  } else {
    const typeDir = KIND_TO_DIR[node.kind];
    const itemPath = join(ctxDir, typeDir, `${name}.yml`);
    if (!existsSync(itemPath)) {
      console.error(`File not found: ${itemPath}`);
      process.exit(1);
    }
    if (opts.diff) {
      console.log(`\n--- a/${itemPath}\n+++ /dev/null`);
      console.log(`- (File deleted: ${itemPath})`);
    }
    rmSync(itemPath);
  }

  console.log(`Successfully removed '${id}'.`);
}

// ── Command registration ──────────────────────────────────────────────

export function registerRm(program: Cmd): void {
  program
    .command("rm <id>")
    .alias("remove")
    .alias("delete")
    .description(
      "Remove a domain item, actor, ADR, flow, or context safely, without leaving dangling references",
    )
    .option("--diff", "Show a diff of changes made")
    .option(
      "-f, --force",
      "Clean up dangling references and remove (required when dependents exist)",
    )
    .option("-r, --root <path>", "Override repository root")
    .addHelpText(
      "after",
      `
ID formats:
  ctx.ItemName      domain item (event/command/policy/aggregate/read_model/glossary)
  actor.ActorName   actor
  flow.FlowName     flow
  adr-NNNN          Architecture Decision Record
  context.ctxName   bounded context (or bare: ctxName)
`,
    )
    .action(
      (id: string, opts: { root?: string; force?: boolean; diff?: boolean }) => {
        const model = loadDomainModel({ root: opts.root });
        const graph = DomainGraph.from(model);

        const parsed = classifyId(id);

        switch (parsed.kind) {
          case "actor":
            rmActor(parsed.name, graph, opts);
            break;
          case "flow":
            rmFlow(parsed.name, graph, opts);
            break;
          case "adr":
            rmAdr(parsed.name, graph, opts);
            break;
          case "context":
            rmContext(parsed.name, graph, opts);
            break;
          case "domain":
            rmDomainItem(id, graph, opts);
            break;
        }
      },
    );
}
