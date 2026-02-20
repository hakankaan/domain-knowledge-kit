/**
 * ADR frontmatter parser.
 *
 * Reads Markdown files from `docs/adr/` and extracts the YAML
 * frontmatter block (delimited by `---`) into typed `AdrRecord` objects.
 */
import { readFileSync } from "node:fs";
import type { AdrRecord } from "../types/domain.js";
import { parseYaml } from "./yaml.js";

/** Regex that captures the YAML block between the opening and closing `---`. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Parse YAML frontmatter from a Markdown string.
 *
 * @returns The parsed `AdrRecord`, or `null` if no frontmatter is found.
 */
export function parseAdrFrontmatter(markdown: string): AdrRecord | null {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return null;

  const raw = parseYaml<Record<string, unknown>>(match[1]);

  // The frontmatter must at minimum contain `id`, `title`, `status`, `date`.
  if (!raw.id || !raw.title || !raw.status || !raw.date) return null;

  // js-yaml auto-converts ISO date strings to Date objects; normalise back.
  if (raw.date instanceof Date) {
    raw.date = raw.date.toISOString().slice(0, 10);
  }

  return raw as unknown as AdrRecord;
}

/**
 * Read an ADR Markdown file from disk and return its frontmatter.
 *
 * @returns The parsed `AdrRecord`, or `null` if the file has no valid frontmatter.
 */
export function parseAdrFile(filePath: string): AdrRecord | null {
  const content = readFileSync(filePath, "utf-8");
  return parseAdrFrontmatter(content);
}
