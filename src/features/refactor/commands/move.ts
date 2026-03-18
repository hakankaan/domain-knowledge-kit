/**
 * move command — relocate a domain item from one bounded context to another.
 *
 * Unlike 'rename', this command moves an item's YAML file to a different
 * context directory and rewrites all references (flows, ADR domain_refs,
 * same-context and cross-context domain items) to use the new scoped ID.
 *
 * Usage:
 *   dkk move <id> <new-context>              # keeps same item name
 *   dkk move <id> <new-context.NewName>      # renames as well
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDomainModel } from "../../../shared/loader.js";
import { contextsDir } from "../../../shared/paths.js";
import { DomainGraph } from "../../../shared/graph.js";
import { parseYaml, stringifyYaml } from "../../../shared/yaml.js";
import {
  classifyId,
  KIND_TO_DIR,
  rewriteFile,
  updateAdrFrontmatter,
  updateFlowStepsForItem,
  renameDomainItemRef,
  allAdrFiles,
  allDomainFiles,
  printDiff,
} from "../refactor-helpers.js";

export function registerMove(program: Cmd): void {
  program
    .command("move <id> <destination>")
    .description(
      "Move a domain item to a different bounded context, updating all references",
    )
    .option("--diff", "Show a diff of changes made")
    .option("-r, --root <path>", "Override repository root")
    .addHelpText(
      "after",
      `
Destination formats:
  new-context           move to new-context with the same item name
  new-context.NewName   move to new-context and rename

Examples:
  dkk move ordering.OrderPlaced payments
  dkk move ordering.OrderPlaced payments.PaymentReceived
`,
    )
    .action(
      (
        id: string,
        destination: string,
        opts: { root?: string; diff?: boolean },
      ) => {
        const parsed = classifyId(id);

        if (parsed.kind !== "domain") {
          console.error(
            `'move' only supports domain items (ctx.Name format). ` +
              `Use 'rename' for actors, ADRs, flows, and contexts.`,
          );
          process.exit(1);
        }

        const oldCtx = parsed.ctx!;
        const oldName = parsed.name;
        const oldId = id;

        // Parse destination: either "new-ctx" or "new-ctx.NewName"
        let newCtx: string;
        let newName: string;
        if (destination.includes(".")) {
          const dot = destination.indexOf(".");
          newCtx = destination.slice(0, dot);
          newName = destination.slice(dot + 1);
        } else {
          newCtx = destination;
          newName = oldName;
        }

        const newId = `${newCtx}.${newName}`;

        if (oldCtx === newCtx && oldName === newName) {
          console.error("Source and destination are identical; nothing to do.");
          process.exit(1);
        }

        if (oldCtx === newCtx) {
          console.error(
            `Source and destination are in the same context '${oldCtx}'. Use 'dkk rename' instead.`,
          );
          process.exit(1);
        }

        const model = loadDomainModel({ root: opts.root });
        const graph = DomainGraph.from(model);

        if (!graph.hasNode(oldId)) {
          console.error(`Item '${oldId}' not found.`);
          process.exit(1);
        }

        if (graph.hasNode(newId)) {
          console.error(`Target ID '${newId}' already exists.`);
          process.exit(1);
        }

        if (!graph.hasNode(`context.${newCtx}`)) {
          console.error(
            `Destination context '${newCtx}' does not exist. Create it first with 'dkk new context ${newCtx}'.`,
          );
          process.exit(1);
        }

        const node = graph.nodes.get(oldId)!;

        if (node.kind === "glossary") {
          console.error(
            "Glossary terms cannot be moved across contexts; they are context-scoped by definition.",
          );
          process.exit(1);
        }

        const typeDir = KIND_TO_DIR[node.kind];
        if (!typeDir) {
          console.error(`Unsupported item kind '${node.kind}'.`);
          process.exit(1);
        }

        const ctxBase = contextsDir(opts.root);
        const oldDir = join(ctxBase, oldCtx, typeDir);
        const newDir = join(ctxBase, newCtx, typeDir);
        const oldPath = join(oldDir, `${oldName}.yml`);
        const newPath = join(newDir, `${newName}.yml`);

        if (!existsSync(oldPath)) {
          console.error(`File not found: ${oldPath}`);
          process.exit(1);
        }

        // 1. Update/copy the item file's `name` field and move it
        const content = readFileSync(oldPath, "utf-8");
        const data = parseYaml<Record<string, unknown>>(content);
        const nameChanged = oldName !== newName;
        if (nameChanged) {
          data["name"] = newName;
        }
        const newContent = nameChanged ? stringifyYaml(data) : content;
        if (opts.diff) {
          console.log(`\n--- a/${oldPath}\n+++ b/${newPath}`);
          if (nameChanged) printDiff(oldPath, content, newContent);
          else console.log(`(File moved: ${oldPath} → ${newPath})`);
        }

        mkdirSync(newDir, { recursive: true });
        writeFileSync(newPath, newContent, "utf-8");
        rmSync(oldPath);

        // 2. Update references in all domain item files (both contexts)
        let updated = 0;

        // Within-context same items referencing oldName by simple name:
        // Find items in oldCtx that reference this item
        const oldCtxDeps = [...graph.edges]
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
              n.kind !== "flow" &&
              n.kind !== "glossary",
          );

        const visited = new Set<string>();
        for (const depNode of oldCtxDeps) {
          if (!depNode || visited.has(depNode.id)) continue;
          visited.add(depNode.id);
          if (!depNode.context) continue;
          const depTypeDir = KIND_TO_DIR[depNode.kind];
          if (!depTypeDir) continue;
          const depPath = join(ctxBase, depNode.context, depTypeDir, `${depNode.name}.yml`);
          // Remove the back-reference from old-ctx neighbors (they now reference a non-existent item)
          // We rewrite the simple name to the new scoped id
          if (
            renameDomainItemRef(
              depPath,
              depNode.kind,
              oldName,
              // Within old-ctx, the reference was by simple name. After move, the item is
              // in a different context so cross-context references need the full scoped id.
              newId,
              opts.diff ?? false,
            )
          )
            updated++;
        }

        // Rewrite scoped ID references across all domain files (cross-context, flows, ADRs)
        for (const filePath of allDomainFiles(opts.root)) {
          if (filePath === newPath) continue;
          if (rewriteFile(filePath, oldId, newId, opts.diff ?? false)) updated++;
        }

        // Update flow steps
        const steps = updateFlowStepsForItem(
          opts.root,
          oldId,
          newId,
          opts.diff ?? false,
        );
        if (steps > 0) updated += steps;

        // Update ADR domain_refs
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

        console.log(
          `Successfully moved '${oldId}' → '${newId}'. Updated ${updated} reference(s).`,
        );
      },
    );
}
