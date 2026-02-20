/**
 * `domain render` command — validate + render + build search index.
 *
 * Validates the domain model, renders Markdown documentation via
 * Handlebars templates, and rebuilds the FTS5 search index.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import { validateDomainModel } from "../validator.js";
import { renderDocs } from "../renderer.js";
import { buildIndex } from "../indexer.js";

/** Register the `render` subcommand. */
export function registerRender(program: Cmd): void {
  program
    .command("render")
    .description("Validate, render Markdown docs, and rebuild search index")
    .option("--skip-validation", "Skip schema + cross-ref validation")
    .option("--json", "Output as JSON")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: { skipValidation?: boolean; json?: boolean; root?: string }) => {
      const model = loadDomainModel({ root: opts.root });

      // 1. Validate (unless skipped)
      if (!opts.skipValidation) {
        if (!opts.json) console.log("Validating domain model…");
        const result = validateDomainModel(model);

        if (!opts.json) {
          for (const w of result.warnings) {
            const loc = w.path ? ` (${w.path})` : "";
            console.warn(`\u26a0  ${w.message}${loc}`);
          }
          for (const e of result.errors) {
            const loc = e.path ? ` (${e.path})` : "";
            console.error(`\u2717  ${e.message}${loc}`);
          }
        }

        if (!result.valid) {
          if (opts.json) {
            console.log(JSON.stringify({
              success: false,
              error: "Validation failed",
              validationErrors: result.errors.map((e) => ({ message: e.message, path: e.path ?? null })),
            }, null, 2));
          } else {
            console.error(`\n\u2717 Validation failed with ${result.errors.length} error(s). Fix errors before rendering.\n`);
          }
          process.exit(1);
        }
        if (!opts.json) console.log("\u2713 Validation passed.\n");
      }

      // 2. Render docs
      if (!opts.json) console.log("Rendering documentation…");
      const renderResult = renderDocs(model, { root: opts.root });
      if (!opts.json) console.log(`\u2713 Rendered ${renderResult.fileCount} file(s).\n`);

      // 3. Build search index
      if (!opts.json) console.log("Building search index…");
      const dbPath = buildIndex(model, { root: opts.root });
      if (!opts.json) console.log(`\u2713 Search index written to ${dbPath}.\n`);

      if (opts.json) {
        console.log(JSON.stringify({
          success: true,
          rendered: renderResult.fileCount,
          files: renderResult.files,
          searchIndex: dbPath,
        }, null, 2));
      } else {
        console.log("Done.");
      }
    });
}
