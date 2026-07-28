/**
 * `dkk adr decisions <id|--file path>` — which decisions govern this?
 *
 * The CLI half of the `dkk_decisions` MCP tool, so the answer is
 * reachable without an MCP client.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import { mapFileToContext } from "../../audit/commands/drift.js";
import { collectDecisions, type DecisionsReport } from "../decisions.js";

/** Plain-English gloss for each provenance route. */
const VIA_LABEL: Record<string, string> = {
  code_refs: "binds this file",
  adr_refs: "linked from the item",
  domain_refs: "names the item",
  context: "governs the context",
};

function printReport(report: DecisionsReport): void {
  console.log(`\nDecisions for ${report.subject}${report.context ? ` (context: ${report.context})` : ""}\n`);

  if (report.decisions.length === 0) {
    console.log(`  ${report.note ?? "None found."}\n`);
    return;
  }

  for (const d of report.decisions) {
    const via = d.via.map((v) => VIA_LABEL[v] ?? v).join(", ");
    console.log(`  ${d.id}  [${d.status}]  ${d.title}`);
    console.log(`      via ${via}  ·  ${d.date}`);
    if (d.currentId) {
      console.log(`      superseded — the decision in effect is ${d.currentId}`);
    }
  }

  console.log(`\n  In effect: ${report.binding.length ? report.binding.join(", ") : "none"}`);
  if (report.retired.length) {
    console.log(`  History:   ${report.retired.join(", ")}`);
  }
  console.log("");
}

export function registerAdrDecisions(program: Cmd): void {
  program
    .command("decisions [id]")
    .description("Show which ADRs govern a domain item, context, actor, flow, or source file")
    .option("-f, --file <path>", "Ask about a source file instead of a domain id")
    .option("--no-include-context", "Exclude decisions that govern the whole owning context")
    .option("-r, --root <path>", "Override repository root")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .addHelpText(
      "after",
      `
Examples:
  dkk adr decisions ordering.Order
  dkk adr decisions context.ordering
  dkk adr decisions --file src/storage/writer.ts

"In effect" follows supersession chains, so a superseded ADR is never
reported as binding — its successor is.
`,
    )
    .action(
      (
        id: string | undefined,
        opts: {
          file?: string;
          includeContext?: boolean;
          root?: string;
          json?: boolean;
          minify?: boolean;
        },
      ) => {
        if (!id && !opts.file) {
          console.error("Error: pass a domain id or --file <path>.");
          process.exit(1);
        }

        const model = loadDomainModel({ root: opts.root });

        const report = opts.file
          ? (() => {
              const mapping = mapFileToContext(opts.file!, { root: opts.root });
              return collectDecisions(model, mapping.file, {
                fileBinding: { context: mapping.context, adrs: mapping.adrsBoundDirectly ?? [] },
                includeContext: opts.includeContext,
              });
            })()
          : collectDecisions(model, id!, { includeContext: opts.includeContext });

        if (opts.json) {
          console.log(JSON.stringify(report, null, opts.minify ? 0 : 2));
          return;
        }
        printReport(report);
      },
    );
}
