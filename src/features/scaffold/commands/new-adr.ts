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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adrDir } from "../../../shared/paths.js";

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

/** Convert a title to a kebab-case slug for the filename hint. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function registerNewAdr(program: Cmd): void {
  program
    .command("adr <title>")
    .description("Scaffold a new ADR file with frontmatter template")
    .option("-r, --root <path>", "Override repository root")
    .option("-s, --status <status>", "ADR status (proposed, accepted, deprecated)", "proposed")
    .action((title: string, opts: { root?: string; status?: string }) => {
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

      const num = nextAdrNumber(dir);
      const id = `adr-${pad4(num)}`;
      const filename = `${id}.md`;
      const filePath = join(dir, filename);

      // Guard: should not happen with auto-numbering, but be safe
      if (existsSync(filePath)) {
        console.error(`Error: ${filePath} already exists.`);
        process.exit(1);
      }

      const _slug = slugify(title);
      const content = `---
id: ${id}
title: ${title}
status: ${status}
date: ${today()}
deciders: []
domain_refs: []
---

# ${id.toUpperCase()} — ${title}

**Status:** ${status.charAt(0).toUpperCase() + status.slice(1)}
**Date:** ${today()}

## Context

<!-- What is the issue that we're seeing that is motivating this decision? -->

## Decision

<!-- What is the change that we're proposing and/or doing? -->

## Consequences

<!-- What becomes easier or harder as a result of this decision? -->
`;

      writeFileSync(filePath, content, "utf-8");
      console.log(`Created ${filename}`);
      console.log(`  .dkk/adr/${filename}`);
    });
}
