/**
 * `dkk new adr <title>` command — scaffold a new ADR file.
 *
 * Creates `.dkk/adr/adr-NNNN.md` with YAML frontmatter template.
 * Automatically determines the next ADR number by scanning existing files.
 *
 * Flags:
 *   --status accepted|proposed|deprecated  (default: proposed)
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adrDir } from "../../../shared/paths.js";
import { updateAdrFrontmatter } from "../../refactor/refactor-helpers.js";

/**
 * Keep the human-readable `**Status:**` line in a superseded ADR's body
 * in agreement with its (already-flipped) frontmatter. Touches only the
 * first such line; ADRs without one are left alone.
 */
function flipBodyStatusLine(filePath: string, newId: string): void {
  const content = readFileSync(filePath, "utf-8");
  const updated = content.replace(
    /^\*\*Status:\*\* .*$/m,
    `**Status:** Superseded (by ${newId})`,
  );
  if (updated !== content) writeFileSync(filePath, updated, "utf-8");
}

/** Scan existing adr-NNNN.md files and return the next number. */
function nextAdrNumber(dir: string): number {
  if (!existsSync(dir)) return 1;

  const files = readdirSync(dir);
  let max = 0;
  for (const f of files) {
    const m = f.match(/^adr-(\d{4})\.md$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/** Pad a number to 4 digits. */
function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/** Get today's date as YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}



function parseCsv(val: string): string[] {
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

export function registerNewAdr(program: Cmd): void {
  program
    .command("adr <title>")
    .description("Scaffold a new ADR file with frontmatter template")
    .option("-r, --root <path>", "Override repository root")
    .option("-s, --status <status>", "ADR status (proposed, accepted, deprecated)", "proposed")
    .option("--domain-refs <ids>", "Domain references (comma-separated)", parseCsv)
    .option("--deciders <names>", "Deciders (comma-separated)", parseCsv)
    .option(
      "--supersedes <ids>",
      "ADR id(s) this decision supersedes (comma-separated). Flips each old ADR to status: superseded with superseded_by pointing here.",
      parseCsv,
    )
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON")
    .action((title: string, opts: { root?: string; status?: string; domainRefs?: string[]; deciders?: string[]; supersedes?: string[]; json?: boolean; minify?: boolean }) => {
      const status = opts.status ?? "proposed";
      const validStatuses = ["proposed", "accepted", "deprecated", "superseded"];
      if (!validStatuses.includes(status)) {
        console.error(
          `Error: Invalid status "${status}". Must be one of: ${validStatuses.join(", ")}`,
        );
        process.exit(1);
      }

      const dir = adrDir(opts.root);
      mkdirSync(dir, { recursive: true });

      // Verify supersession targets exist BEFORE creating anything.
      const supersedes = opts.supersedes ?? [];
      for (const oldId of supersedes) {
        if (!/^adr-\d{4}$/.test(oldId)) {
          console.error(`Error: --supersedes id "${oldId}" is not a valid ADR id (adr-NNNN).`);
          process.exit(1);
        }
        if (!existsSync(join(dir, `${oldId}.md`))) {
          console.error(`Error: --supersedes target "${oldId}" not found in .dkk/adr/.`);
          process.exit(1);
        }
      }

      const num = nextAdrNumber(dir);
      const id = `adr-${pad4(num)}`;
      const filename = `${id}.md`;
      const filePath = join(dir, filename);

      if (existsSync(filePath)) {
        console.error(`Error: ${filePath} already exists.`);
        process.exit(1);
      }

      const decidersStr = opts.deciders?.length ? opts.deciders.map(d => `\n  - "${d}"`).join('') : " []";
      const domainRefsStr = opts.domainRefs?.length ? opts.domainRefs.map(r => `\n  - ${r}`).join('') : " []";

      const supersedesLine = supersedes.length
        ? `\n**Supersedes:** ${supersedes.join(", ")}`
        : "";

      const content = `---
id: ${id}
title: ${title}
status: ${status}
date: ${today()}
deciders:${decidersStr}
domain_refs:${domainRefsStr}
---

# ${id.toUpperCase()} — ${title}

**Status:** ${status.charAt(0).toUpperCase() + status.slice(1)}
**Date:** ${today()}${supersedesLine}

## Context

<!-- What is the issue that we're seeing that is motivating this decision? -->

## Decision

<!-- What is the change that we're proposing and/or doing? -->

## Consequences

<!-- What becomes easier or harder as a result of this decision? -->
`;

      writeFileSync(filePath, content, "utf-8");

      // Flip each superseded ADR: status → superseded, superseded_by → this
      // ADR. Doing it here keeps the supersession chain consistent in one
      // step — the validator lints exactly this pairing.
      const flipped: string[] = [];
      for (const oldId of supersedes) {
        const oldPath = join(dir, `${oldId}.md`);
        const changed = updateAdrFrontmatter(oldPath, (fm) => {
          fm["status"] = "superseded";
          fm["superseded_by"] = id;
          return true;
        });
        if (changed) {
          flipBodyStatusLine(oldPath, id);
          flipped.push(oldId);
        }
      }

      if (opts.json) {
         console.log(JSON.stringify({
            id,
            path: filePath,
            title,
            supersedes: flipped,
         }, null, opts.minify ? 0 : 2));
         return;
      }

      console.log(`Created ${filename}`);
      console.log(`  .dkk/adr/${filename}`);
      for (const oldId of flipped) {
        console.log(`  ${oldId}: status → superseded, superseded_by → ${id}`);
      }
    });
}
