/**
 * ADR frontmatter parser.
 *
 * Reads Markdown files from `.domain-pack/adr/` and extracts the YAML
 * frontmatter block (delimited by `---`) into typed `AdrRecord` objects.
 */
import { readFileSync } from "node:fs";
import type { AdrRecord } from "./types/domain.js";
import { parseYaml } from "./yaml.js";

/** Regex that captures the YAML block between the opening and closing `---`. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Strip Markdown formatting from body text for cleaner search indexing.
 *
 * Removes heading markers, link syntax, emphasis, inline code, and
 * fenced code-block delimiters while preserving the readable content.
 */
function stripMarkdown(md: string): string {
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

  // Extract body text after the closing ---
  const closingIndex = markdown.indexOf("---", match.index + 3);
  if (closingIndex !== -1) {
    const bodyRaw = markdown.slice(closingIndex + 3).trim();
    if (bodyRaw.length > 0) {
      raw.body = stripMarkdown(bodyRaw);
    }
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
