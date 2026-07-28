/**
 * Presenting an ADR for reading.
 *
 * An ADR is frontmatter plus Markdown prose, and the prose carries the
 * decision. Serialising the whole record as YAML folded that prose into
 * one scalar — headings gone, lists gone, tables gone — so the primary
 * way both humans and agents read a decision returned a blob in which
 * *Context*, *Decision* and *Consequences* were indistinguishable.
 *
 * Frontmatter renders as YAML; the body renders as the Markdown it is.
 */
import type { AdrRecord } from "../../shared/types/domain.js";
import { adrFrontmatter, findSection } from "../../shared/adr-parser.js";
import { stringifyYaml } from "../../shared/yaml.js";

/** A read-ready view of one ADR. */
export interface AdrView {
  /** Frontmatter fields only, YAML-serialised. */
  frontmatter: string;
  /** Markdown body — the whole thing, or one section when narrowed. */
  body: string;
  /** Heading of the section shown, when narrowed to one. */
  section?: string;
  /** Every section slug in the document, for discovery. */
  availableSections: string[];
}

export type AdrViewResult =
  | { ok: true; view: AdrView }
  | { ok: false; message: string };

/**
 * Build a view of an ADR, optionally narrowed to one section.
 *
 * @param section - Heading slug (or a prefix of one, e.g. "alt").
 */
export function adrView(adr: AdrRecord, section?: string): AdrViewResult {
  const available = (adr.sections ?? []).map((s) => s.slug);
  const frontmatter = stringifyYaml(adrFrontmatter(adr)).trimEnd();

  if (!section) {
    return {
      ok: true,
      view: { frontmatter, body: adr.body ?? "", availableSections: available },
    };
  }

  const found = findSection(adr.sections, section);
  if (!found) {
    return {
      ok: false,
      message: available.length
        ? `${adr.id} has no section matching "${section}". Available: ${available.join(", ")}`
        : `${adr.id} has no level-2 headings to select a section from.`,
    };
  }

  return {
    ok: true,
    view: {
      frontmatter,
      body: found.body,
      section: found.heading,
      availableSections: available,
    },
  };
}

/**
 * Full text rendering of an ADR: a heading, the frontmatter as a YAML
 * block, then the Markdown body verbatim.
 */
export function renderAdrText(adr: AdrRecord, view: AdrView): string {
  const parts = [`# ADR: ${adr.title}`];
  if (view.section) parts.push(`_Section: ${view.section}_`);
  parts.push(`\`\`\`yaml\n${view.frontmatter}\n\`\`\``);
  if (view.body) parts.push(view.body);
  else parts.push("_(no body)_");
  if (!view.section && view.availableSections.length) {
    parts.push(
      `\n---\nSections: ${view.availableSections.join(", ")} — read one with \`--section <name>\`.`,
    );
  }
  return parts.join("\n\n");
}
