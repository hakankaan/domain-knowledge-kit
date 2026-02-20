/**
 * `domain render` command — validate + render + build search index.
 *
 * Validates the domain model, renders Markdown documentation via
 * Handlebars templates, and rebuilds the FTS5 search index.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../core/loader.js";
import { validateDomainModel } from "../core/validator.js";
import { renderDocs } from "../core/renderer.js";
import { buildIndex } from "../core/indexer.js";

/** Register the `render` subcommand. */
export function registerRender(program: Cmd): void {
  program
    .command("render")
    .description("Validate, render Markdown docs, and rebuild search index")
    .option("--skip-validation", "Skip schema + cross-ref validation")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: { skipValidation?: boolean; root?: string }) => {
      const model = loadDomainModel({ root: opts.root });

      // 1. Validate (unless skipped)
      if (!opts.skipValidation) {
        console.log("Validating domain model…");
        const result = validateDomainModel(model);

        for (const w of result.warnings) {
          const loc = w.path ? ` (${w.path})` : "";
          console.warn(`⚠  ${w.message}${loc}`);
        }
        for (const e of result.errors) {
          const loc = e.path ? ` (${e.path})` : "";
          console.error(`✗  ${e.message}${loc}`);
        }

        if (!result.valid) {
          console.error(`\n✗ Validation failed with ${result.errors.length} error(s). Fix errors before rendering.\n`);
          process.exit(1);
        }
        console.log("✓ Validation passed.\n");
      }

      // 2. Render docs
      console.log("Rendering documentation…");
      const renderResult = renderDocs(model, { root: opts.root });
      console.log(`✓ Rendered ${renderResult.fileCount} file(s).\n`);

      // 3. Build search index
      console.log("Building search index…");
      const dbPath = buildIndex(model, { root: opts.root });
      console.log(`✓ Search index written to ${dbPath}.\n`);

      console.log("Done.");
    });
}
