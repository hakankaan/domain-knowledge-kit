import type { Command as Cmd } from "commander";
import { existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDomainModel } from "../../../shared/loader.js";
import { contextsDir } from "../../../shared/paths.js";
import { DomainGraph } from "../../../shared/graph.js";

export function registerRm(program: Cmd): void {
  program
    .command("rm <id>")
    .alias("remove")
    .alias("delete")
    .description("Remove a domain item securely without dangling references")
    .option("-f, --force", "Force removal even if there are dependents")
    .option("-r, --root <path>", "Override repository root")
    .action(
      (
        id: string,
        opts: { root?: string; force?: boolean },
      ) => {
        // Validation format
        if (!id.includes(".")) {
          console.error("ID must be scoped (e.g. 'ordering.OrderPlaced').");
          process.exit(1);
        }

        const [ctx, name] = id.split(".");

        const model = loadDomainModel({ root: opts.root });
        const graph = DomainGraph.from(model);

        if (!graph.hasNode(id)) {
          console.error(`Item '${id}' not found.`);
          process.exit(1);
        }

        const node = graph.nodes.get(id)!;
        
        // Cannot remove contexts or flow easily right now
        if (node.kind === "context" || node.kind === "flow" || node.kind === "actor" || node.kind === "adr") {
           console.error(`Remove target must be a domain item, got kind: ${node.kind}.`);
           process.exit(1);
        }

        // Find items that reference this
        const dependents = new Set<string>();
        for (const edge of graph.edges) {
          // If another node points TO this node, it's a dependent.
          // Note: "contains" is context -> item, not a real dependency preventing removal
          // "emits" could mean Event -> Aggregate
          if (edge.to === id && edge.label !== "contains") {
            dependents.add(edge.from);
          }
          // Some edges go FROM the node being deleted TO the dependent, 
          // e.g. Event --raised_by--> Aggregate. This is fine, deleting the event just removes the capability.
          // But if something subscribes TO the event, that's bad.
        }

        if (dependents.size > 0 && !opts.force) {
            console.error(`Cannot remove '${id}'. It is referenced by:`);
            for (const dep of dependents) {
                console.error(`  - ${dep}`);
            }
            console.error(`\nUse --force to override.`);
            process.exit(1);
        }

        if (dependents.size > 0 && opts.force) {
            console.warn(`Warning: Removed '${id}' despite ${dependents.size} dependents.`);
        }

        // Remove the file itself
        const ctxDir = join(contextsDir(opts.root), ctx);
        const kindToDir: Record<string, string> = {
            event: "events", command: "commands", aggregate: "aggregates", 
            policy: "policies", read_model: "read-models"
        };

        if (node.kind === "glossary") {
             const metaPath = join(ctxDir, "context.yml");
             const content = readFileSync(metaPath, "utf-8");
             // Minimalist glossary removal logic
             const lines = content.split("\n");
             const newLines = lines.filter(line => !line.includes(`term: ${name}`));
             writeFileSync(metaPath, newLines.join("\n"), "utf-8");
        } else {
            const typeDir = kindToDir[node.kind];
            const itemPath = join(ctxDir, typeDir, `${name}.yml`);
            
            if (existsSync(itemPath)) {
                rmSync(itemPath);
            }
        }

        console.log(`Successfully removed '${id}'.`);
      },
    );
}
