/**
 * `domain search <query>` command — FTS5 keyword search over domain items.
 *
 * Runs a full-text search against the SQLite FTS5 index and displays
 * ranked results with optional context/type/tag filters.
 */
import type { Command as Cmd } from "commander";
import { search } from "../searcher.js";
import { DomainGraph } from "../../../shared/graph.js";
import { loadDomainModel } from "../../../shared/loader.js";

/** Register the `search` subcommand. */
export function registerSearch(program: Cmd): void {
  program
    .command("search <query>")
    .description("Full-text search across domain items (requires index; run 'domain-knowledge-kit render' first)")
    .option("-c, --context <name>", "Filter results to a bounded context")
    .option("-t, --type <type>", "Filter results by item type")
    .option("--tag <tag>", "Filter results by tag/keyword")
    .option("--limit <n>", "Maximum results to return", "20")
    .option("--expand", "Expand top results with graph neighbours")
    .option("--json", "Output as JSON")
    .option("-r, --root <path>", "Override repository root")
    .action((query: string, opts: {
      context?: string;
      type?: string;
      tag?: string;
      limit?: string;
      expand?: boolean;
      json?: boolean;
      root?: string;
    }) => {
      const filters = {
        context: opts.context,
        type: opts.type,
        tag: opts.tag,
      };

      let graph: DomainGraph | undefined;
      if (opts.expand) {
        const model = loadDomainModel({ root: opts.root });
        graph = DomainGraph.from(model);
      }

      const results = search(query, filters, {
        root: opts.root,
        limit: parseInt(opts.limit ?? "20", 10),
        graph,
      });

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`\nNo results for "${query}".\n`);
        return;
      }

      console.log(`\n${results.length} result(s) for "${query}":\n`);

      for (const r of results) {
        const ctx = r.context ? ` [${r.context}]` : "";
        console.log(`  ${r.id}  (${r.type})${ctx}  score=${r.score}`);
        console.log(`    ${r.excerpt}`);
        if (r.adrIds.length > 0) {
          console.log(`    ADRs: ${r.adrIds.join(", ")}`);
        }
        if (r.relatedIds.length > 0) {
          console.log(`    Related: ${r.relatedIds.join(", ")}`);
        }
        console.log();
      }
    });
}
