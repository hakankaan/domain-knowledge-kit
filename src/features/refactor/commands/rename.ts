import type { Command as Cmd } from "commander";
import { existsSync, readFileSync, renameSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadDomainModel } from "../../../shared/loader.js";
import { contextsDir, adrDir } from "../../../shared/paths.js";
import { DomainGraph } from "../../../shared/graph.js";
import { parseYaml, stringifyYaml } from "../../../shared/yaml.js";
import type { ContextMetaFile } from "../../../shared/types/domain.js";
import {
  classifyId,
  KIND_TO_DIR,
  rewriteFile,
  renameGlossaryEntry,
  renameActorEntry,
  renameFlowInIndex,
  renameContextInIndex,
  updateAdrFrontmatter,
  renameDomainItemRef,
  allAdrFiles,
  allDomainFiles,
  printDiff,
} from "../refactor-helpers.js";

// ── Per-kind rename helpers ───────────────────────────────────────────

function renameActor(
  oldName: string,
  newName: string,
  graph: DomainGraph,
  opts: { root?: string; diff?: boolean },
): void {
  const oldId = `actor.${oldName}`;
  const newId = `actor.${newName}`;

  if (!graph.hasNode(oldId)) {
    console.error(`Actor '${oldName}' not found.`);
    process.exit(1);
  }
  if (graph.hasNode(newId)) {
    console.error(`Actor '${newName}' already exists.`);
    process.exit(1);
  }

  // Rename in actors.yml
  renameActorEntry(opts.root, oldName, newName, opts.diff ?? false);

  // Update all command/read_model files that reference this actor by name
  let updated = 0;
  for (const filePath of allDomainFiles(opts.root)) {
    if (filePath.endsWith("context.yml")) continue;
    // Only rewrite actor-name-bearing dirs: commands, read-models
    if (
      !filePath.includes("/commands/") &&
      !filePath.includes("/read-models/")
    )
      continue;
    const content = readFileSync(filePath, "utf-8");
    const data = parseYaml<Record<string, unknown>>(content);
    let changed = false;
    if (data["actor"] === oldName) {
      data["actor"] = newName;
      changed = true;
    }
    const usedBy = data["used_by"] as string[] | undefined;
    if (usedBy) {
      const idx = usedBy.indexOf(oldName);
      if (idx !== -1) {
        usedBy[idx] = newName;
        changed = true;
      }
    }
    if (!changed) continue;
    const newContent = stringifyYaml(data);
    if (opts.diff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    updated++;
  }

  console.log(
    `Successfully renamed actor '${oldName}' → '${newName}'. Updated ${updated} file(s).`,
  );
}

function renameFlow(
  oldName: string,
  newName: string,
  graph: DomainGraph,
  opts: { root?: string; diff?: boolean },
): void {
  if (!graph.hasNode(`flow.${oldName}`)) {
    console.error(`Flow '${oldName}' not found.`);
    process.exit(1);
  }
  if (graph.hasNode(`flow.${newName}`)) {
    console.error(`Flow '${newName}' already exists.`);
    process.exit(1);
  }
  renameFlowInIndex(opts.root, oldName, newName, opts.diff ?? false);
  console.log(`Successfully renamed flow '${oldName}' → '${newName}'.`);
}

function renameAdr(
  oldId: string,
  newId: string,
  graph: DomainGraph,
  opts: { root?: string; diff?: boolean },
): void {
  if (!graph.hasNode(oldId)) {
    console.error(`ADR '${oldId}' not found.`);
    process.exit(1);
  }
  if (graph.hasNode(newId)) {
    console.error(`ADR '${newId}' already exists.`);
    process.exit(1);
  }

  const adrBase = adrDir(opts.root);
  const oldPath = join(adrBase, `${oldId}.md`);
  const newPath = join(adrBase, `${newId}.md`);

  if (!existsSync(oldPath)) {
    console.error(`ADR file not found: ${oldPath}`);
    process.exit(1);
  }

  // Update the id field inside the frontmatter
  updateAdrFrontmatter(
    oldPath,
    (fm) => {
      if (fm["id"] !== oldId) return false;
      fm["id"] = newId;
      return true;
    },
    opts.diff ?? false,
  );

  // Rename the file
  renameSync(oldPath, newPath);

  // Update all domain YAML files that reference oldId in adr_refs
  let updated = 0;
  for (const filePath of allDomainFiles(opts.root)) {
    if (filePath.endsWith("context.yml")) continue;
    if (rewriteFile(filePath, oldId, newId, opts.diff ?? false)) updated++;
  }

  // Update context.yml files (glossary adr_refs)
  const ctxBase = contextsDir(opts.root);
  if (existsSync(ctxBase)) {
    for (const ent of readdirSync(ctxBase, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const ctxMeta = join(ctxBase, ent.name, "context.yml");
      if (rewriteFile(ctxMeta, oldId, newId, opts.diff ?? false)) updated++;
    }
  }

  // Update other ADR files that reference oldId in superseded_by or domain_refs
  for (const adrFilePath of allAdrFiles(opts.root)) {
    if (adrFilePath === newPath) continue;
    updateAdrFrontmatter(
      adrFilePath,
      (fm) => {
        let changed = false;
        if (fm["superseded_by"] === oldId) {
          fm["superseded_by"] = newId;
          changed = true;
        }
        const refs = fm["domain_refs"] as string[] | undefined;
        if (refs?.includes(oldId)) {
          const idx = refs.indexOf(oldId);
          refs[idx] = newId;
          changed = true;
        }
        return changed;
      },
      opts.diff ?? false,
    );
  }

  console.log(
    `Successfully renamed '${oldId}' → '${newId}'. Updated ${updated} domain file(s).`,
  );
}

function renameContext(
  oldName: string,
  newName: string,
  graph: DomainGraph,
  opts: { root?: string; diff?: boolean },
): void {
  if (!graph.hasNode(`context.${oldName}`)) {
    console.error(`Context '${oldName}' not found.`);
    process.exit(1);
  }
  if (graph.hasNode(`context.${newName}`)) {
    console.error(`Context '${newName}' already exists.`);
    process.exit(1);
  }

  const ctxBase = contextsDir(opts.root);
  const oldDir = join(ctxBase, oldName);
  const newDir = join(ctxBase, newName);

  // 1. Update context.yml name field
  const metaPath = join(oldDir, "context.yml");
  if (existsSync(metaPath)) {
    const content = readFileSync(metaPath, "utf-8");
    const meta = parseYaml<ContextMetaFile>(content);
    meta.name = newName;
    const newContent = stringifyYaml(meta);
    if (opts.diff) printDiff(metaPath, content, newContent);
    writeFileSync(metaPath, newContent, "utf-8");
  }

  // 2. Rename the directory
  renameSync(oldDir, newDir);

  // 3. Update index.yml context entry + flow step refs with old ctx prefix
  renameContextInIndex(opts.root, oldName, newName, opts.diff ?? false);

  // 4. Rewrite cross-context references in other domain YAML files and ADRs
  //    (scoped IDs like "old-ctx.ItemName" → "new-ctx.ItemName")
  let updated = 0;
  const oldPrefix = `${oldName}.`;
  const newPrefix = `${newName}.`;

  for (const filePath of allDomainFiles(opts.root)) {
    // Skip files that are now in the renamed directory
    if (filePath.includes(`/contexts/${newName}/`)) continue;
    if (rewriteFile(filePath, oldPrefix, newPrefix, opts.diff ?? false))
      updated++;
  }
  for (const adrFilePath of allAdrFiles(opts.root)) {
    updateAdrFrontmatter(
      adrFilePath,
      (fm) => {
        const refs = fm["domain_refs"] as string[] | undefined;
        if (!refs?.length) return false;
        let changed = false;
        fm["domain_refs"] = refs.map((r) => {
          if (r.startsWith(oldPrefix)) {
            changed = true;
            return newPrefix + r.slice(oldPrefix.length);
          }
          return r;
        });
        return changed;
      },
      opts.diff ?? false,
    );
  }

  console.log(
    `Successfully renamed context '${oldName}' → '${newName}'. Updated ${updated} cross-reference(s).`,
  );
}

function renameGlossaryItem(
  id: string,
  newId: string,
  graph: DomainGraph,
  opts: { root?: string; diff?: boolean },
): void {
  const dot = id.indexOf(".");
  const ctx = id.slice(0, dot);
  const oldTerm = id.slice(dot + 1);
  const newDot = newId.indexOf(".");
  const newCtx = newId.slice(0, newDot);
  const newTerm = newId.slice(newDot + 1);

  if (ctx !== newCtx) {
    console.error(
      "Cross-context glossary rename is not supported; use 'move' instead.",
    );
    process.exit(1);
  }

  const ctxDir = join(contextsDir(opts.root), ctx);
  const renamed = renameGlossaryEntry(
    ctxDir,
    oldTerm,
    newTerm,
    opts.diff ?? false,
  );
  if (!renamed) {
    console.error(`Glossary term '${oldTerm}' not found in context '${ctx}'.`);
    process.exit(1);
  }
  console.log(`Successfully renamed glossary term '${oldTerm}' → '${newTerm}'.`);
}

function renameDomainItem(
  oldId: string,
  newId: string,
  graph: DomainGraph,
  opts: { root?: string; diff?: boolean },
): void {
  const oldDot = oldId.indexOf(".");
  const oldCtx = oldId.slice(0, oldDot);
  const oldName = oldId.slice(oldDot + 1);
  const newDot = newId.indexOf(".");
  const newCtx = newId.slice(0, newDot);
  const newName = newId.slice(newDot + 1);

  if (oldCtx !== newCtx) {
    console.error(
      "Cross-context rename is not supported by 'rename'; use 'dkk move' to relocate items across contexts.",
    );
    process.exit(1);
  }

  if (!graph.hasNode(oldId)) {
    console.error(`Item '${oldId}' not found.`);
    process.exit(1);
  }
  if (graph.hasNode(newId)) {
    console.error(`Target ID '${newId}' already exists.`);
    process.exit(1);
  }

  const node = graph.nodes.get(oldId)!;

  if (node.kind === "glossary") {
    renameGlossaryItem(oldId, newId, graph, opts);
    return;
  }

  console.log(`Renaming ${node.kind} '${oldId}' → '${newId}'...`);

  const ctxBase = contextsDir(opts.root);
  const ctxDir = join(ctxBase, oldCtx);
  const typeDir = KIND_TO_DIR[node.kind];
  const oldPath = join(ctxDir, typeDir, `${oldName}.yml`);
  const newPath = join(ctxDir, typeDir, `${newName}.yml`);

  if (!existsSync(oldPath)) {
    console.error(`File not found: ${oldPath}`);
    process.exit(1);
  }

  // 1. Update the `name` field inside the item's own file
  const content = readFileSync(oldPath, "utf-8");
  const data = parseYaml<Record<string, unknown>>(content);
  data["name"] = newName;
  const newContent = stringifyYaml(data);
  if (opts.diff) printDiff(oldPath, content, newContent);
  writeFileSync(oldPath, newContent, "utf-8");

  // 2. Rename the file
  renameSync(oldPath, newPath);

  // 3. Update references in the same context (simple name)
  let updated = 0;
  const samectxDeps = [...graph.edges]
    .filter(
      (e) =>
        e.label !== "contains" &&
        (e.to === oldId || e.from === oldId) &&
        graph.nodes.get(e.to)?.context === oldCtx &&
        graph.nodes.get(e.from)?.context === oldCtx,
    )
    .flatMap((e) => [e.to, e.from])
    .filter((nId) => nId !== oldId)
    .map((nId) => graph.nodes.get(nId))
    .filter(
      (n) =>
        n !== undefined &&
        n.kind !== "context" &&
        n.kind !== "adr" &&
        n.kind !== "flow",
    );

  const visitedDep = new Set<string>();
  for (const depNode of samectxDeps) {
    if (!depNode || visitedDep.has(depNode.id)) continue;
    visitedDep.add(depNode.id);
    if (depNode.kind === "glossary" || !depNode.context) continue;
    const depDir = KIND_TO_DIR[depNode.kind];
    if (!depDir) continue;
    const depPath = join(ctxBase, depNode.context, depDir, `${depNode.name}.yml`);
    if (renameDomainItemRef(depPath, depNode.kind, oldName, newName, opts.diff ?? false))
      updated++;
  }

  // 4. Update flow steps (scoped ID)
  const idxPath = join(ctxBase, "..", "index.yml");
  if (rewriteFile(idxPath, oldId, newId, opts.diff ?? false)) updated++;

  // 5. Update ADR domain_refs (scoped ID)
  for (const adrFilePath of allAdrFiles(opts.root)) {
    updateAdrFrontmatter(
      adrFilePath,
      (fm) => {
        const refs = fm["domain_refs"] as string[] | undefined;
        if (!refs?.includes(oldId)) return false;
        const idx = refs.indexOf(oldId);
        refs[idx] = newId;
        return true;
      },
      opts.diff ?? false,
    );
  }

  // 6. Update other domain files that hold the scoped ID in cross-context refs
  for (const filePath of allDomainFiles(opts.root)) {
    if (filePath.startsWith(ctxDir)) continue;
    if (rewriteFile(filePath, oldId, newId, opts.diff ?? false)) updated++;
  }

  console.log(
    `Successfully renamed '${oldId}' → '${newId}'. Updated ${updated} reference(s).`,
  );
}

// ── Command registration ──────────────────────────────────────────────

export function registerRename(program: Cmd): void {
  program
    .command("rename <old-id> <new-id>")
    .description("Rename a domain item and update all references")
    .option("--diff", "Show a diff of changes made")
    .option("-r, --root <path>", "Override repository root")
    .addHelpText(
      "after",
      `
ID formats (same for old-id and new-id):
  ctx.ItemName      domain item   (rename within same context)
  actor.ActorName   actor
  flow.FlowName     flow
  adr-NNNN          Architecture Decision Record
  context.ctxName   bounded context (or bare: ctxName)

Cross-context rename: use 'dkk move <id> <new-context>' instead.
`,
    )
    .action(
      (oldId: string, newId: string, opts: { root?: string; diff?: boolean }) => {
        const model = loadDomainModel({ root: opts.root });
        const graph = DomainGraph.from(model);

        const oldParsed = classifyId(oldId);
        const newParsed = classifyId(newId);

        if (oldParsed.kind !== newParsed.kind) {
          console.error(
            `ID kind mismatch: '${oldId}' is ${oldParsed.kind}, '${newId}' is ${newParsed.kind}.`,
          );
          process.exit(1);
        }

        switch (oldParsed.kind) {
          case "actor":
            renameActor(oldParsed.name, newParsed.name, graph, opts);
            break;
          case "flow":
            renameFlow(oldParsed.name, newParsed.name, graph, opts);
            break;
          case "adr":
            renameAdr(oldParsed.name, newParsed.name, graph, opts);
            break;
          case "context":
            renameContext(oldParsed.name, newParsed.name, graph, opts);
            break;
          case "domain":
            renameDomainItem(oldId, newId, graph, opts);
            break;
        }
      },
    );
}

