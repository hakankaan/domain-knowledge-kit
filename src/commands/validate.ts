/**
 * `domain validate` command — schema + cross-reference validation.
 *
 * Loads the domain model, validates it against JSON Schemas and
 * cross-reference rules, and exits with code 1 on errors.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../shared/loader.js";
import { validateDomainModel } from "../core/validator.js";

/** Register the `validate` subcommand. */
export function registerValidate(program: Cmd): void {
  program
    .command("validate")
    .description("Validate domain YAML against schemas and cross-references")
    .option("--warn-missing-fields", "Warn about events/commands with no fields")
    .option("--json", "Output as JSON")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: { warnMissingFields?: boolean; json?: boolean; root?: string }) => {
      const model = loadDomainModel({ root: opts.root });
      const result = validateDomainModel(model, {
        warnMissingFields: opts.warnMissingFields,
      });

      if (opts.json) {
        console.log(JSON.stringify({
          valid: result.valid,
          errors: result.errors.map((e) => ({ message: e.message, path: e.path ?? null })),
          warnings: result.warnings.map((w) => ({ message: w.message, path: w.path ?? null })),
        }, null, 2));
        if (!result.valid) process.exit(1);
        return;
      }

      // Print warnings
      for (const w of result.warnings) {
        const loc = w.path ? ` (${w.path})` : "";
        console.warn(`\u26a0  ${w.message}${loc}`);
      }

      // Print errors
      for (const e of result.errors) {
        const loc = e.path ? ` (${e.path})` : "";
        console.error(`\u2717  ${e.message}${loc}`);
      }

      // Summary
      const warnCount = result.warnings.length;
      const errCount = result.errors.length;

      if (result.valid) {
        console.log(`\n\u2713 Validation passed.${warnCount > 0 ? ` (${warnCount} warning(s))` : ""}\n`);
      } else {
        console.error(`\n\u2717 Validation failed: ${errCount} error(s), ${warnCount} warning(s).\n`);
        process.exit(1);
      }
    });
}
