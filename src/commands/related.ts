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
    .option("--json", "Output as JSON")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { depth?: string; json?: boolean; root?: string }) => {
      const depth = parseInt(opts.depth ?? "1", 10);
      const model = loadDomainModel({ root: opts.root });
      const graph = DomainGraph.from(model);

      if (!graph.hasNode(id)) {
        if (opts.json) {
          console.log(JSON.stringify({ error: `Node "${id}" not found in the domain graph` }, null, 2));
        } else {
          console.error(`Error: Node "${id}" not found in the domain graph.`);
        }
        process.exit(1);
      }

      const related = graph.getRelated(id, depth);

      // Group by kind for readability
      const grouped = new Map<string, { id: string; name: string; context?: string }[]>();
      for (const nId of related) {
        const node = graph.nodes.get(nId);
        const kind = node?.kind ?? "unknown";
        if (!grouped.has(kind)) grouped.set(kind, []);
        grouped.get(kind)!.push({
          id: nId,
          name: node?.name ?? nId,
          ...(node?.context ? { context: node.context } : {}),
        });
      }

      if (opts.json) {
        const result: Record<string, { id: string; name: string; context?: string }[]> = {};
        for (const [kind, items] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          result[kind] = items.sort((a, b) => a.id.localeCompare(b.id));
        }
        console.log(JSON.stringify({ id, depth, related: result }, null, 2));
        return;
      }

      if (related.size === 0) {
        console.log(`\nNo related items found for "${id}" within depth ${depth}.\n`);
        return;
      }

      console.log(`\n${related.size} item(s) related to "${id}" (depth=${depth}):\n`);

      for (const [kind, items] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`  ${kind}:`);
        for (const item of items.sort((a, b) => a.id.localeCompare(b.id))) {
          const label = `${item.name}${item.context ? ` [${item.context}]` : ""}`;
          console.log(`    - ${item.id}  (${label})`);
        }
      }
      console.log();
    });
}
