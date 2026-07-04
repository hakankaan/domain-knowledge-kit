/**
 * `domain validate` command — schema + cross-reference validation.
 *
 * Loads the domain model, validates it against JSON Schemas and
 * cross-reference rules, and exits with code 1 on errors.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import { validateDomainModel, validateSingleFile } from "../validator.js";

/** Register the `validate` subcommand. */
export function registerValidate(program: Cmd): void {
  program
    .command("validate [id]")
    .description("Validate domain YAML against schemas and cross-references")
    .option("--warn-missing-fields", "Warn about events/commands with no fields")
    .option(
      "--federation <mode>",
      "Federation strictness: lenient (default — unreachable peers warn) or strict (errors)",
      "lenient",
    )
    .option(
      "--file <path>",
      "Schema-only validation of a single file (no cross-reference checks — safe mid-batch)",
    )
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string | undefined, opts: {
      warnMissingFields?: boolean;
      federation?: string;
      file?: string;
      json?: boolean;
      minify?: boolean;
      root?: string;
    }) => {
      const fedMode = opts.federation;
      if (fedMode !== undefined && fedMode !== "lenient" && fedMode !== "strict") {
        console.error(`Error: --federation must be "lenient" or "strict" (got "${fedMode}").`);
        process.exit(1);
      }
      // The [id] filter matches item paths (context:…, adr:…), which never
      // appear in --file results — combining them would silently filter
      // every finding away and report a false "passed".
      if (opts.file && id) {
        console.error("Error: --file cannot be combined with an item id filter.");
        process.exit(1);
      }
      const result = opts.file
        ? validateSingleFile(opts.file, { root: opts.root })
        : validateDomainModel(loadDomainModel({ root: opts.root }), {
            warnMissingFields: opts.warnMissingFields,
            federation: fedMode as "lenient" | "strict" | undefined,
            root: opts.root,
          });

      let { valid, errors, warnings } = result;

      if (id) {
        const isMatch = (p?: string) => {
          if (!p) return false;
          if (p === `actor:${id}` || p === `adr:${id}` || p === `context:${id}`) return true;
          const [ctx, name] = id.split(".");
          if (ctx && name) {
            return p.startsWith(`context:${ctx}.`) && p.endsWith(`:${name}`);
          }
          return false;
        };
        errors = errors.filter((e) => isMatch(e.path));
        warnings = warnings.filter((w) => isMatch(w.path));
        valid = errors.length === 0;
      }

      if (opts.json) {
        const payload = {
          valid,
          errors: errors.map((e) => ({ message: e.message, path: e.path ?? null })),
          warnings: warnings.map((w) => ({ message: w.message, path: w.path ?? null })),
        };
        console.log(JSON.stringify(payload, null, opts.minify ? 0 : 2));
        if (!valid) process.exit(1);
        return;
      }

      // Print warnings
      for (const w of warnings) {
        const loc = w.path ? ` (${w.path})` : "";
        console.warn(`\u26a0  ${w.message}${loc}`);
      }

      // Print errors
      for (const e of errors) {
        const loc = e.path ? ` (${e.path})` : "";
        console.error(`\u2717  ${e.message}${loc}`);
      }

      // Summary
      const warnCount = warnings.length;
      const errCount = errors.length;

      if (valid) {
        console.log(`\n\u2713 Validation passed.${warnCount > 0 ? ` (${warnCount} warning(s))` : ""}\n`);
      } else {
        console.error(`\n\u2717 Validation failed: ${errCount} error(s), ${warnCount} warning(s).\n`);
        process.exit(1);
      }
    });
}
