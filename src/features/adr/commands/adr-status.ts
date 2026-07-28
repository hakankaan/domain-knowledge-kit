/**
 * `dkk adr status <id> <status>` — move an ADR through its lifecycle.
 *
 * Status used to live in two places at once: the frontmatter (which the
 * model reads) and a `**Status:** Accepted` line in the body (which
 * humans read). Nothing kept them in agreement, so "proposed → accepted"
 * was a manual two-place edit and the body copy drifted. This command
 * owns the transition and writes every copy that exists.
 */
import type { Command as Cmd } from "commander";
import { existsSync } from "node:fs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adrDir } from "../../../shared/paths.js";
import { parseAdrFile } from "../../../shared/adr-parser.js";
import { updateAdrFrontmatter } from "../../refactor/refactor-helpers.js";
import {
  ADR_STATUSES,
  STATUS_MEANING,
  statusLabel,
  transitionWarning,
  type AdrStatusName,
} from "../status.js";

/**
 * Rewrite a `**Status:** …` line in the body when the ADR has one.
 * ADRs scaffolded by current DKK do not — the frontmatter is the single
 * copy — but older ones and hand-written ones do.
 */
function syncBodyStatusLine(filePath: string, status: AdrStatusName, supersededBy?: string): boolean {
  const content = readFileSync(filePath, "utf-8");
  const suffix = status === "superseded" && supersededBy ? ` (by ${supersededBy})` : "";
  const updated = content.replace(
    /^\*\*Status:\*\* .*$/m,
    `**Status:** ${statusLabel(status)}${suffix}`,
  );
  if (updated === content) return false;
  writeFileSync(filePath, updated, "utf-8");
  return true;
}

export function registerAdrStatus(program: Cmd): void {
  program
    .command("status <id> <status>")
    .description(`Set an ADR's lifecycle status (${ADR_STATUSES.join(" | ")})`)
    .option("-r, --root <path>", "Override repository root")
    .option(
      "--superseded-by <adr-id>",
      "Required when setting status to superseded: the ADR that replaces this one",
    )
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .addHelpText(
      "after",
      `\nStatuses:\n${ADR_STATUSES.map((s) => `  ${s.padEnd(11)} ${STATUS_MEANING[s]}`).join("\n")}\n`,
    )
    .action(
      (
        id: string,
        status: string,
        opts: { root?: string; supersededBy?: string; json?: boolean; minify?: boolean },
      ) => {
        const fail = (message: string): never => {
          if (opts.json) {
            console.log(JSON.stringify({ error: message }, null, opts.minify ? 0 : 2));
          } else {
            console.error(`Error: ${message}`);
          }
          process.exit(1);
        };

        if (!ADR_STATUSES.includes(status as AdrStatusName)) {
          fail(`Invalid status "${status}". Must be one of: ${ADR_STATUSES.join(", ")}`);
        }
        const next = status as AdrStatusName;

        const filePath = join(adrDir(opts.root), `${id}.md`);
        if (!existsSync(filePath)) fail(`ADR "${id}" not found at ${filePath}`);

        const parsed = parseAdrFile(filePath);
        if (!parsed.ok) fail(`${id}.md could not be read — ${parsed.message}`);
        const current = (parsed as { ok: true; record: { status: AdrStatusName } }).record.status;

        const supersededBy = opts.supersededBy;
        if (next === "superseded" && !supersededBy) {
          fail(
            `status "superseded" needs --superseded-by <adr-id> so the chain stays machine-readable. To retire a decision with no replacement, use "deprecated".`,
          );
        }
        if (supersededBy) {
          if (!/^([a-z][a-z0-9-]*:)?adr-\d{4}$/.test(supersededBy)) {
            fail(`--superseded-by "${supersededBy}" is not a valid ADR id (adr-NNNN).`);
          }
          if (!supersededBy.includes(":") && !existsSync(join(adrDir(opts.root), `${supersededBy}.md`))) {
            fail(`--superseded-by target "${supersededBy}" not found in .dkk/adr/.`);
          }
          if (supersededBy === id) fail(`an ADR cannot supersede itself.`);
        }

        let clearedSupersededBy = false;
        const changed = updateAdrFrontmatter(filePath, (fm) => {
          const before = JSON.stringify([fm.status, fm.superseded_by]);
          fm.status = next;
          if (next === "superseded") {
            fm.superseded_by = supersededBy;
          } else if (fm.superseded_by) {
            // Leaving `superseded` with a stale pointer would trip the
            // validator's supersession-consistency lint.
            delete fm.superseded_by;
            clearedSupersededBy = true;
          }
          return JSON.stringify([fm.status, fm.superseded_by]) !== before;
        });

        const bodySynced = changed ? syncBodyStatusLine(filePath, next, supersededBy) : false;

        // Record the forward half on the superseding ADR too, so the
        // chain is answerable from both ends.
        let forwardLinked = false;
        if (next === "superseded" && supersededBy && !supersededBy.includes(":")) {
          const newPath = join(adrDir(opts.root), `${supersededBy}.md`);
          forwardLinked = updateAdrFrontmatter(newPath, (fm) => {
            const list = Array.isArray(fm.supersedes) ? (fm.supersedes as string[]) : [];
            if (list.includes(id)) return false;
            fm.supersedes = [...list, id].sort();
            return true;
          });
        }

        const warning = transitionWarning(current, next);

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                id,
                from: current,
                to: next,
                changed,
                superseded_by: next === "superseded" ? supersededBy : undefined,
                cleared_superseded_by: clearedSupersededBy || undefined,
                body_status_line_synced: bodySynced || undefined,
                forward_linked: forwardLinked || undefined,
                warning: warning ?? undefined,
              },
              null,
              opts.minify ? 0 : 2,
            ),
          );
          return;
        }

        if (!changed) {
          console.log(`${id} is already "${next}" — nothing to do.`);
          return;
        }

        console.log(`${id}: ${current} → ${next}`);
        if (next === "superseded") console.log(`  superseded_by → ${supersededBy}`);
        if (clearedSupersededBy) console.log(`  superseded_by cleared (no longer superseded)`);
        if (bodySynced) console.log(`  body **Status:** line updated`);
        if (forwardLinked) console.log(`  ${supersededBy}: supersedes += ${id}`);
        if (warning) console.log(`\n  Note: ${warning}`);
      },
    );
}
