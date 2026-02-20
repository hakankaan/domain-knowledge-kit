/**
 * `domain related <id>` command — graph traversal to find related items.
 *
 * Performs a BFS traversal from a given item ID in the domain graph
 * and lists all reachable items within the specified depth.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../core/loader.js";
import { DomainGraph } from "../core/graph.js";

/** Register the `related` subcommand. */
export function registerRelated(program: Cmd): void {
  program
    .command("related <id>")
    .description("Show items related to a domain item via graph traversal (BFS)")
    .option("-d, --depth <n>", "Maximum traversal depth", "1")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { depth?: string; root?: string }) => {
      const depth = parseInt(opts.depth ?? "1", 10);
      const model = loadDomainModel({ root: opts.root });
      const graph = DomainGraph.from(model);

      if (!graph.hasNode(id)) {
        console.error(`Error: Node "${id}" not found in the domain graph.`);
        process.exit(1);
      }

      const related = graph.getRelated(id, depth);

      if (related.size === 0) {
        console.log(`\nNo related items found for "${id}" within depth ${depth}.\n`);
        return;
      }

      console.log(`\n${related.size} item(s) related to "${id}" (depth=${depth}):\n`);

      // Group by kind for readability
      const grouped = new Map<string, string[]>();
      for (const nId of related) {
        const node = graph.nodes.get(nId);
        const kind = node?.kind ?? "unknown";
        if (!grouped.has(kind)) grouped.set(kind, []);
        grouped.get(kind)!.push(nId);
      }

      for (const [kind, ids] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`  ${kind}:`);
        for (const nId of ids.sort()) {
          const node = graph.nodes.get(nId);
          const label = node ? `${node.name}${node.context ? ` [${node.context}]` : ""}` : nId;
          console.log(`    - ${nId}  (${label})`);
        }
      }
      console.log();
    });
}
