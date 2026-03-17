import type { Command as Cmd } from "commander";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDomainModel } from "../../../shared/loader.js";
import { contextsDir, adrDir, indexFile } from "../../../shared/paths.js";
import { DomainGraph } from "../../../shared/graph.js";

function rewriteReferences(filePath: string, oldId: string, newId: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  // Simple regex replace for the ID string. This handles most cases
  // (e.g. lists of references) without breaking YAML formatting.
  // We use word boundaries to avoid partial matches.
  // Exception: ID contains dot, so we need a broader boundary match
  const regex = new RegExp(`\\b${oldId.replace(/\./g, '\\.')}\\b`, 'g');
  if (regex.test(content)) {
    const newContent = content.replace(regex, newId);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }
  return false;
}

export function registerRename(program: Cmd): void {
  program
    .command("rename <old-id> <new-id>")
    .description("Rename a domain item and update all references to it")
    .option("-r, --root <path>", "Override repository root")
    .action(
      (
        oldId: string,
        newId: string,
        opts: { root?: string },
      ) => {
        // Validation format
        if (!oldId.includes(".") || !newId.includes(".")) {
          console.error("IDs must be scoped (e.g. 'ordering.OrderPlaced').");
          process.exit(1);
        }

        const [oldCtx, oldName] = oldId.split(".");
        const [newCtx, newName] = newId.split(".");

        if (oldCtx !== newCtx) {
          console.error("Cross-context renaming is not supported by this command.");
          process.exit(1);
        }

        const model = loadDomainModel({ root: opts.root });
        const graph = DomainGraph.from(model);

        if (!graph.hasNode(oldId)) {
          console.error(`Item '${oldId}' not found.`);
          process.exit(1);
        }

        if (graph.hasNode(newId)) {
          console.error(`Status check: Target ID '${newId}' already exists.`);
          process.exit(1);
        }

        const node = graph.nodes.get(oldId)!;
        
        // Cannot rename contexts or flow easily safely right now with simple regex
        if (node.kind === "context" || node.kind === "flow" || node.kind === "actor" || node.kind === "adr") {
           console.error(`Rename target must be a domain item, got kind: ${node.kind}.`);
           process.exit(1);
        }

        console.log(`Renaming ${node.kind} '${oldId}' to '${newId}'...`);

        // Find items that reference this
        const dependents = new Set<string>();
        for (const edge of graph.edges) {
          if (edge.to === oldId && edge.label !== "contains") {
            dependents.add(edge.from);
          }
        }

        let updatedFiles = 0;

        // 1. Rewrite references in dependent domain items
        for (const depId of dependents) {
           const depNode = graph.nodes.get(depId)!;
           if (depNode.kind === "adr") {
             const adrPath = join(adrDir(opts.root), `${depNode.name}.md`);
             if (rewriteReferences(adrPath, oldId, newId)) updatedFiles++;
             continue;
           }
           if (depNode.kind === "flow") {
              const domIdxPath = indexFile(opts.root);
              if (rewriteReferences(domIdxPath, oldId, newId)) updatedFiles++;
              continue;
           }
           if (depNode.kind === "actor") {
               // Actor file is single
               continue; // Actor doesn't reference items, items reference actors
           }

           // General domain item
           if (depNode.context) {
              const ctxDir = join(contextsDir(opts.root), depNode.context);
              
              // We don't know the exact file without scanning or mapping kinds to dirs.
              // So we just map the kind backwards to the file path.
              const kindToDir: Record<string, string> = {
                event: "events", command: "commands", aggregate: "aggregates", 
                policy: "policies", read_model: "read-models"
              };

              if (depNode.kind === "glossary") {
                  const metaPath = join(ctxDir, "context.yml");
                   if (rewriteReferences(metaPath, oldId, newId)) updatedFiles++;
              } else if (kindToDir[depNode.kind]) {
                  const itemPath = join(ctxDir, kindToDir[depNode.kind], `${depNode.name}.yml`);
                  if (rewriteReferences(itemPath, oldId, newId)) updatedFiles++;
              }
           }
        }

        // 2. Rename the file itself and modify its internal name property
        const ctxDir = join(contextsDir(opts.root), oldCtx);
        const kindToDir: Record<string, string> = {
            event: "events", command: "commands", aggregate: "aggregates", 
            policy: "policies", read_model: "read-models"
        };

        if (node.kind === "glossary") {
             const metaPath = join(ctxDir, "context.yml");
             if (rewriteReferences(metaPath, oldName, newName)) updatedFiles++;
        } else {
            const typeDir = kindToDir[node.kind];
            const oldPath = join(ctxDir, typeDir, `${oldName}.yml`);
            const newPath = join(ctxDir, typeDir, `${newName}.yml`);
            
            // Rewrite inner name property
            const content = readFileSync(oldPath, "utf-8");
            const newContent = content.replace(/^name:\s*"?.*"?\s*$/m, `name: ${newName}`);
            writeFileSync(oldPath, newContent, "utf-8");

            renameSync(oldPath, newPath);
            updatedFiles++;
        }

        console.log(`Successfully renamed to '${newId}'. Updated ${updatedFiles} configurations.`);
      },
    );
}
