/**
 * `domain summary <id>` command — concise overview of an item.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import { DomainGraph } from "../../../shared/graph.js";

/** Register the `summary` subcommand. */
export function registerSummary(program: Cmd): void {
  program
    .command("summary <id>")
    .description("Show a concise summary of a domain item (useful for AI context)")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { json?: boolean; minify?: boolean; root?: string }) => {
      const model = loadDomainModel({ root: opts.root });
      const graph = DomainGraph.from(model);

      const node = graph.nodes.get(id);
      if (!node) {
        if (opts.json) {
          console.log(JSON.stringify({ error: `Item "${id}" not found` }, null, opts.minify ? 0 : 2));
        } else {
          console.error(`Error: Item "${id}" not found.`);
        }
        process.exit(1);
      }

      const related = Array.from(graph.getRelated(id, 1));

      if (opts.json) {
        const payload = {
          id: node.id,
          name: node.name,
          kind: node.kind,
          context: node.context,
          related,
        };
        console.log(JSON.stringify(payload, null, opts.minify ? 0 : 2));
        return;
      }

      console.log(`\n# [${node.kind}] ${node.name}${node.context ? ` (Context: ${node.context})` : ""}\n`);
      console.log(`Related (${related.length}):`);
      for (const r of related) console.log(`  - ${r}`);
      console.log();
    });
}
