/**
 * ADR frontmatter + body parser.
 *
 * Reads Markdown files from `.dkk/adr/` and extracts the YAML
 * frontmatter block (delimited by `---`) into typed `AdrRecord`
 * objects, keeping the Markdown body intact and split into its
 * level-2 sections.
 *
 * The body is stored **verbatim**. Search indexing needs a flattened,
 * boilerplate-free variant instead — that is what {@link adrSearchText}
 * produces. Storing only the stripped form (as this module used to)
 * meant everything downstream — `dkk show`, the MCP server, the docs
 * renderer — saw one flattened blob with the headings gone, so "what
 * was decided" could not be told apart from "why".
 */
import { readFileSync } from "node:fs";
import type { AdrRecord, AdrSection } from "./types/domain.js";
import { parseYaml } from "./yaml.js";

/** Regex that captures the YAML block between the opening and closing `---`. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Frontmatter keys that are mandatory for a file to load as an ADR. */
const REQUIRED_KEYS = ["id", "title", "status", "date"] as const;

/**
 * Fields DKK computes at load time. They live on `AdrRecord` for the
 * convenience of consumers but are never written to (or read from) the
 * on-disk frontmatter, whose schema is `additionalProperties: false`.
 */
export const ADR_RUNTIME_FIELDS = ["body", "sections", "file"] as const;

/**
 * Strip the runtime-only fields, leaving exactly what belongs in the
 * file's YAML frontmatter. Use before schema-validating or
 * re-serialising a record.
 */
export function adrFrontmatter(adr: AdrRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { ...adr };
  for (const key of ADR_RUNTIME_FIELDS) delete out[key];
  return out;
}

/**
 * Strip Markdown formatting from body text for cleaner search indexing.
 *
 * Removes heading markers, link syntax, emphasis, inline code, and
 * fenced code-block delimiters while preserving the readable content.
 */
export function stripMarkdown(md: string): string {
  return md
    // Remove fenced code-block delimiters (``` or ~~~)
    .replace(/^(`{3,}|~{3,}).*$/gm, "")
    // Remove heading markers
    .replace(/^#{1,6}\s+/gm, "")
    // Remove images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Remove links [text](url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Remove bold/italic markers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // Remove inline code backticks
    .replace(/`([^`]*)`/g, "$1")
    // Collapse multiple whitespace into single space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this file under `.dkk/adr/` one DKK should load as an ADR?
 *
 * `README.md` and dotfiles are the directory's own documentation, not
 * decisions. The loader and the single-file validator must agree on
 * this or the per-edit hook rejects a file the model never reads.
 *
 * @param filename - Basename only, not a path.
 */
export function isAdrFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".md") && !filename.startsWith(".") && lower !== "readme.md";
}

/** Lower-kebab slug for a heading — the key `--section` matches against. */
export function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Split a Markdown body into sections on its level-2 headings.
 *
 * Level 2 is the canonical section level for an ADR (`## Context`,
 * `## Decision`, …), and splitting there keeps any `###` subsections
 * nested inside their parent rather than fragmenting the section.
 * Documents that use `#` for sections instead fall back to level 1,
 * minus the leading title heading.
 */
export function parseSections(body: string): AdrSection[] {
  const collect = (level: number): AdrSection[] => {
    const re = new RegExp(`^${"#".repeat(level)}\\s+(.+?)\\s*$`, "gm");
    const heads: { heading: string; start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      heads.push({ heading: m[1], start: m.index, end: m.index + m[0].length });
    }
    return heads.map((h, i) => ({
      heading: h.heading,
      slug: slugifyHeading(h.heading),
      body: body.slice(h.end, heads[i + 1]?.start ?? body.length).trim(),
    }));
  };

  const level2 = collect(2);
  if (level2.length > 0) return level2;

  // No `##` at all — treat `#` as the section level, dropping the first
  // heading, which is the document title rather than a section.
  const level1 = collect(1);
  return level1.length > 1 ? level1.slice(1) : [];
}

/**
 * Look up one section of an ADR by heading slug.
 *
 * Matches the exact slug first, then any slug that starts with the
 * query, so `--section alt` finds "Alternatives Considered".
 */
export function findSection(
  sections: AdrSection[] | undefined,
  query: string,
): AdrSection | undefined {
  if (!sections?.length) return undefined;
  const want = slugifyHeading(query);
  return (
    sections.find((s) => s.slug === want) ??
    sections.find((s) => s.slug.startsWith(want))
  );
}

/**
 * Flattened body text for the search index.
 *
 * Drops the two forms of boilerplate the scaffold writes into the body:
 * the H1 that repeats `title`, and the `**Status:** / **Date:** /
 * **Deciders:** / **Supersedes:**` echo of the frontmatter. Both are
 * already indexed as their own columns, so leaving them in the text
 * blob only dilutes FTS scores and pushes real content out of the
 * result snippet.
 */
export function adrSearchText(adr: AdrRecord): string {
  const body = adr.body ?? "";
  if (!body) return "";

  // Only the preamble (everything before the first section heading)
  // carries the echo; the rest of the body is left untouched.
  const splitAt = body.search(/^##\s+/m);
  const preamble = splitAt === -1 ? body : body.slice(0, splitAt);
  const rest = splitAt === -1 ? "" : body.slice(splitAt);

  const cleaned = preamble
    // The H1 that repeats the title.
    .replace(/^#\s+.*$/m, "")
    // The metadata echo lines.
    .replace(/^\*\*(?:Status|Date|Deciders|Supersedes|Superseded by):\*\*.*$/gm, "");

  return stripMarkdown(`${cleaned}\n${rest}`);
}

/** Why a file under `.dkk/adr/` failed to load as an ADR. */
export type AdrParseFailure =
  /** No `---` frontmatter block at all. */
  | "no-frontmatter"
  /** Frontmatter present but missing `id`, `title`, `status`, or `date`. */
  | "missing-fields"
  /** The YAML inside the frontmatter block is malformed. */
  | "parse-error";

/** Outcome of parsing one candidate ADR document. */
export type AdrParseResult =
  | { ok: true; record: AdrRecord }
  | { ok: false; reason: AdrParseFailure; message: string };

/**
 * Parse a Markdown string into an ADR record, reporting *why* it failed
 * rather than collapsing every failure mode into `null`.
 */
export function parseAdrDocument(markdown: string): AdrParseResult {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) {
    return {
      ok: false,
      reason: "no-frontmatter",
      message:
        "no YAML frontmatter block — an ADR must open with `---` and declare id, title, status, date",
    };
  }

  let raw: Record<string, unknown>;
  try {
    raw = parseYaml<Record<string, unknown>>(match[1]);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return { ok: false, reason: "parse-error", message: `malformed YAML frontmatter — ${msg}` };
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "parse-error", message: "frontmatter is not a YAML mapping" };
  }

  const missing = REQUIRED_KEYS.filter((k) => !raw[k]);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "missing-fields",
      message: `frontmatter is missing required field(s): ${missing.join(", ")}`,
    };
  }

  // js-yaml auto-converts ISO date strings to Date objects; normalise back.
  for (const key of ["date", "review_by"]) {
    if (raw[key] instanceof Date) {
      raw[key] = (raw[key] as Date).toISOString().slice(0, 10);
    }
  }

  // Body = everything after the closing `---`, kept verbatim. Slicing at
  // the end of the matched block (rather than searching for the next
  // `---`) is exact even when a frontmatter value contains one.
  const body = markdown.slice(match.index + match[0].length).trim();
  if (body.length > 0) {
    raw.body = body;
    const sections = parseSections(body);
    if (sections.length > 0) raw.sections = sections;
  }

  return { ok: true, record: raw as unknown as AdrRecord };
}

/**
 * Parse YAML frontmatter from a Markdown string.
 *
 * @returns The parsed `AdrRecord`, or `null` if the document is not a
 *   loadable ADR. Use {@link parseAdrDocument} when the reason matters.
 */
export function parseAdrFrontmatter(markdown: string): AdrRecord | null {
  const result = parseAdrDocument(markdown);
  return result.ok ? result.record : null;
}

/**
 * Read an ADR Markdown file from disk and parse it.
 *
 * Never throws on a malformed file: a bad ADR is reported as a failed
 * parse so the caller can attribute it to a path. Letting the YAML
 * exception escape took down the entire model load — `validate`,
 * `render`, `search` and `show` alike — over one bad file, and the
 * error named a line number in no particular file.
 */
export function parseAdrFile(filePath: string): AdrParseResult {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "parse-error", message: `cannot be read — ${msg}` };
  }

  const result = parseAdrDocument(content);
  if (result.ok) result.record.file = filePath;
  return result;
}
