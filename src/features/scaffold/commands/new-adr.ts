/**
 * `dkk new adr <title>` command — scaffold a new ADR file.
 *
 * Creates `.dkk/adr/adr-NNNN.md` with YAML frontmatter and a body from
 * the `adr` Handlebars template. The next number is derived from both
 * the existing filenames and the ids they declare.
 *
 * Frontmatter is serialised with the YAML writer rather than
 * interpolated into a string. A title containing `:` — "Use Redis:
 * cache layer" — produced invalid YAML the old way, and since the
 * loader parses every ADR, one such file took down `validate`,
 * `render`, `search` and `show` with a parse error that named no file.
 */
import type { Command as Cmd } from "commander";
import Handlebars from "handlebars";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adrDir, resolveTemplate } from "../../../shared/paths.js";
import { stringifyYaml } from "../../../shared/yaml.js";
import { parseAdrFile } from "../../../shared/adr-parser.js";
import { updateAdrFrontmatter } from "../../refactor/refactor-helpers.js";
import { setItemAdrRef, type LinkOutcome } from "../../adr/adr-links.js";
import { ADR_STATUSES, type AdrStatusName } from "../../adr/status.js";

/**
 * Keep the human-readable `**Status:**` line in a superseded ADR's body
 * in agreement with its (already-flipped) frontmatter. Touches only the
 * first such line; ADRs without one — including everything the current
 * template scaffolds — are left alone.
 */
function flipBodyStatusLine(filePath: string, newId: string): void {
  const content = readFileSync(filePath, "utf-8");
  const updated = content.replace(
    /^\*\*Status:\*\* .*$/m,
    `**Status:** Superseded (by ${newId})`,
  );
  if (updated !== content) writeFileSync(filePath, updated, "utf-8");
}

/**
 * Next free ADR number.
 *
 * Considers both the `adr-NNNN.md` filenames and the `id:` each file
 * declares. Scanning filenames alone would happily mint an id that a
 * mis-numbered file already claims, and the loader keys ADRs by id —
 * so the new ADR would silently collide with an existing one.
 */
function nextAdrNumber(dir: string): number {
  if (!existsSync(dir)) return 1;

  let max = 0;
  const consider = (candidate: string | undefined) => {
    const m = /^adr-(\d{4})$/.exec(candidate ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  };

  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md") || f.toLowerCase() === "readme.md" || f.startsWith(".")) continue;
    consider(f.replace(/\.md$/, ""));
    const parsed = parseAdrFile(join(dir, f));
    if (parsed.ok) consider(parsed.record.id);
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
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Render the ADR body from the `adr` template (project override wins). */
function renderBody(
  root: string | undefined,
  data: Record<string, unknown>,
): string {
  const tplPath = resolveTemplate("adr", root);
  if (!tplPath) {
    throw new Error(
      "ADR template not found — expected adr.md.hbs in .dkk/templates/ or the installed dkk package",
    );
  }
  const tpl = Handlebars.compile(readFileSync(tplPath, "utf-8"), { noEscape: true });
  return tpl(data);
}

interface NewAdrOptions {
  root?: string;
  status?: string;
  domainRefs?: string[];
  deciders?: string[];
  supersedes?: string[];
  tags?: string[];
  links?: string[];
  backlink?: boolean;
  json?: boolean;
  minify?: boolean;
}

export function registerNewAdr(program: Cmd): void {
  program
    .command("adr <title>")
    .description("Scaffold a new ADR file with frontmatter template")
    .option("-r, --root <path>", "Override repository root")
    .option(
      "-s, --status <status>",
      `ADR status (${ADR_STATUSES.join(", ")})`,
      "proposed",
    )
    .option("--domain-refs <ids>", "Domain references (comma-separated)", parseCsv)
    .option("--deciders <names>", "Deciders (comma-separated)", parseCsv)
    .option("--tags <tags>", "Tags for filtering (comma-separated)", parseCsv)
    .option("--links <urls>", "External links — ticket/PR/RFC URLs (comma-separated)", parseCsv)
    .option(
      "--supersedes <ids>",
      "ADR id(s) this decision supersedes (comma-separated). Records `supersedes` here and flips each old ADR to status: superseded with superseded_by pointing back.",
      parseCsv,
    )
    .option(
      "--no-backlink",
      "Do not write the reciprocal adr_refs on each --domain-refs target",
    )
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON")
    .action((title: string, opts: NewAdrOptions) => {
      const status = (opts.status ?? "proposed") as AdrStatusName;
      if (!ADR_STATUSES.includes(status)) {
        console.error(
          `Error: Invalid status "${status}". Must be one of: ${ADR_STATUSES.join(", ")}`,
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

      // Frontmatter as data → YAML. `deciders` and `domain_refs` stay
      // present-but-empty as visible slots for the author to fill.
      const frontmatter: Record<string, unknown> = {
        id,
        title,
        status,
        date: today(),
        deciders: opts.deciders ?? [],
        domain_refs: opts.domainRefs ?? [],
      };
      if (supersedes.length) frontmatter.supersedes = supersedes;
      if (opts.tags?.length) frontmatter.tags = opts.tags;
      if (opts.links?.length) frontmatter.links = opts.links;

      const body = renderBody(opts.root, {
        id,
        idUpper: id.toUpperCase(),
        title,
        status,
        statusLabel: status.charAt(0).toUpperCase() + status.slice(1),
        date: today(),
        deciders: opts.deciders ?? [],
        domainRefs: opts.domainRefs ?? [],
        supersedes,
        supersedesList: supersedes.join(", "),
      });

      const content = `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${body.trimStart()}`;
      writeFileSync(filePath, content, "utf-8");

      // Flip each superseded ADR: status → superseded, superseded_by →
      // this ADR. Doing it here keeps the supersession chain consistent
      // in one step — the validator lints exactly this pairing.
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

      // Reciprocal half: every --domain-refs target gets adr_refs back.
      // The link is only queryable from the item side once this is
      // written, and hand-editing N item files was the step the ADR
      // authoring workflow most often skipped.
      const linked: LinkOutcome[] = [];
      if (opts.backlink !== false) {
        for (const ref of opts.domainRefs ?? []) {
          linked.push(setItemAdrRef(ref, id, "add", opts.root));
        }
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              id,
              path: filePath,
              title,
              status,
              supersedes: flipped,
              linked: linked.map((l) => ({ id: l.id, changed: l.changed, error: l.error })),
            },
            null,
            opts.minify ? 0 : 2,
          ),
        );
        return;
      }

      console.log(`Created ${filename}`);
      console.log(`  .dkk/adr/${filename}`);
      for (const oldId of flipped) {
        console.log(`  ${oldId}: status → superseded, superseded_by → ${id}`);
      }
      for (const l of linked) {
        if (l.error) console.log(`  ! ${l.id}: adr_refs not written — ${l.error}`);
        else if (l.changed) console.log(`  ${l.id}: adr_refs += ${id}`);
      }
    });
}
