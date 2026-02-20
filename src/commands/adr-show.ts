/**
 * `domain adr show <id>` command — print an ADR's frontmatter.
 *
 * Looks up an ADR by its id (e.g. "adr-0001") and prints
 * its frontmatter metadata as YAML, plus location on disk.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../core/loader.js";
import { stringifyYaml } from "../utils/yaml.js";

/** Register the `adr show` subcommand on an `adr` parent command. */
export function registerAdrShow(adrCmd: Cmd): void {
  adrCmd
    .command("show <id>")
    .description("Show ADR frontmatter by ID (e.g. adr-0001)")
    .option("--json", "Output as JSON")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { json?: boolean; root?: string }) => {
      const model = loadDomainModel({ root: opts.root });
      const adr = model.adrs.get(id);

      if (!adr) {
        if (opts.json) {
          console.log(JSON.stringify({ error: `ADR "${id}" not found` }, null, 2));
        } else {
          console.error(`Error: ADR "${id}" not found.`);
        }
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(adr, null, 2));
        return;
      }

      console.log(`\n# ${adr.title} (${adr.id})\n`);
      console.log(stringifyYaml(adr));
    });
}
