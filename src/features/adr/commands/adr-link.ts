/**
 * `dkk adr link` / `dkk adr unlink` — maintain both halves of an
 * ADR ↔ domain link in one step.
 *
 * `domain_refs` on the ADR and `adr_refs` on the item are the same
 * fact recorded twice, and only writing both makes it queryable from
 * either side: the rendered docs and every item-side read use
 * `adr_refs`, so a one-way `domain_refs` link is invisible where people
 * actually look.
 */
import type { Command as Cmd } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { adrDir } from "../../../shared/paths.js";
import { linkAdr, type LinkReport } from "../adr-links.js";

interface LinkOptions {
  root?: string;
  json?: boolean;
  minify?: boolean;
}

/** Shared implementation for both directions. */
function run(
  adrId: string,
  itemIds: string[],
  op: "add" | "remove",
  opts: LinkOptions,
): void {
  if (!/^adr-\d{4}$/.test(adrId)) {
    console.error(`Error: "${adrId}" is not a valid ADR id (adr-NNNN).`);
    process.exit(1);
  }
  if (!existsSync(join(adrDir(opts.root), `${adrId}.md`))) {
    console.error(`Error: ADR "${adrId}" not found in .dkk/adr/.`);
    process.exit(1);
  }

  const report: LinkReport = linkAdr(adrId, itemIds, op, opts.root);
  const failed = report.items.filter((i) => i.error);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          adr: adrId,
          op: op === "add" ? "link" : "unlink",
          domain_refs_changed: report.adr.changed,
          items: report.items.map((i) => ({ id: i.id, changed: i.changed, error: i.error })),
        },
        null,
        opts.minify ? 0 : 2,
      ),
    );
    if (failed.length) process.exitCode = 1;
    return;
  }

  const verb = op === "add" ? "linked" : "unlinked";
  console.log(`${adrId}: domain_refs ${report.adr.changed ? "updated" : "unchanged"}`);
  for (const item of report.items) {
    if (item.error) console.log(`  ! ${item.id}: ${item.error}`);
    else if (item.changed) console.log(`  ${item.id}: adr_refs ${verb}`);
    else console.log(`  = ${item.id}: already ${op === "add" ? "linked" : "unlinked"}`);
  }
  if (failed.length) {
    console.error(
      `\n${failed.length} target(s) could not be written; their refs were left off the ADR too.`,
    );
    process.exitCode = 1;
  }
}

export function registerAdrLink(program: Cmd): void {
  program
    .command("link <adr-id> <item-ids...>")
    .description("Link an ADR to domain items, writing both domain_refs and adr_refs")
    .option("-r, --root <path>", "Override repository root")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .addHelpText(
      "after",
      `
Targets may be domain items (ordering.OrderPlaced), actors (actor.Customer),
flows (flow.OrderFulfillment), contexts (context.ordering), or glossary
terms (ordering.BackOrder).

Example:
  dkk adr link adr-0007 ordering.Order ordering.OrderPlaced actor.Customer
`,
    )
    .action((adrId: string, itemIds: string[], opts: LinkOptions) =>
      run(adrId, itemIds, "add", opts),
    );

  program
    .command("unlink <adr-id> <item-ids...>")
    .description("Remove an ADR ↔ domain-item link from both sides")
    .option("-r, --root <path>", "Override repository root")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .action((adrId: string, itemIds: string[], opts: LinkOptions) =>
      run(adrId, itemIds, "remove", opts),
    );
}
