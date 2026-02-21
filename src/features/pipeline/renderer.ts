/**
 * Domain documentation renderer.
 *
 * Compiles Handlebars templates from `tools/dkk/templates/`
 * and renders Markdown documentation to `.dkk/docs/`.
 *
 * Output structure:
 *   .dkk/docs/
 *     index.md                      ← top-level domain overview
 *     <context>/
 *       index.md                    ← per-context overview
 *       <ItemName>.md               ← per-item page
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import type {
  DomainModel,
  DomainContext,
  AdrRecord,
  Field,
  Example,
} from "../../shared/types/domain.js";
import { forEachItem, itemAdrRefs } from "../../shared/item-visitor.js";
import { docsDir, templatesDir } from "../../shared/paths.js";

// ── Types ─────────────────────────────────────────────────────────────

/** Options for the renderer. */
export interface RendererOptions {
  /** Override repository root (default: auto-detected). */
  root?: string;
  /** Override templates directory. */
  templateDir?: string;
  /** Override output directory. */
  outputDir?: string;
}

/** Result returned after rendering completes. */
export interface RenderResult {
  /** Total number of files written. */
  fileCount: number;
  /** Paths of all written files (absolute). */
  files: string[];
}

// ── Handlebars helpers ────────────────────────────────────────────────

/** Register custom Handlebars helpers used across all templates. */
function registerHelpers(hbs: typeof Handlebars): void {
  /** Join an array of strings with a separator. */
  hbs.registerHelper(
    "join",
    (arr: string[] | undefined, sep: string): string => {
      if (!Array.isArray(arr)) return "";
      return arr.join(typeof sep === "string" ? sep : ", ");
    },
  );

  /**
   * Summarise an array of {@link Field} objects as a compact string.
   * Example: "orderId (UUID), amount (Money)"
   */
  hbs.registerHelper(
    "fieldSummary",
    (fields: Field[] | undefined): string => {
      if (!Array.isArray(fields) || fields.length === 0) return "—";
      return fields
        .map((f) => `${f.name} (${f.type})`)
        .join(", ");
    },
  );
}

// ── Template loading ──────────────────────────────────────────────────

interface CompiledTemplates {
  index: HandlebarsTemplateDelegate;
  context: HandlebarsTemplateDelegate;
  item: HandlebarsTemplateDelegate;
}

/**
 * Read and compile the three Handlebars templates.
 * Throws if any template file is missing.
 */
function loadTemplates(tplDir: string): CompiledTemplates {
  function compile(name: string): HandlebarsTemplateDelegate {
    const filePath = join(tplDir, `${name}.md.hbs`);
    if (!existsSync(filePath)) {
      throw new Error(`Template not found: ${filePath}`);
    }
    const source = readFileSync(filePath, "utf-8");
    return Handlebars.compile(source, { noEscape: true });
  }

  return {
    index: compile("index"),
    context: compile("context"),
    item: compile("item"),
  };
}

// ── Data preparation ──────────────────────────────────────────────────

/** Flatten glossary entries from all contexts with their source context. */
function collectGlossary(model: DomainModel) {
  const entries: Array<{ term: string; definition: string; context: string }> =
    [];
  for (const [ctxName, ctx] of model.contexts) {
    for (const g of ctx.glossary ?? []) {
      entries.push({
        term: g.term,
        definition: g.definition,
        context: ctxName,
      });
    }
  }
  return entries.sort((a, b) => a.term.localeCompare(b.term));
}

/** Collect all ADRs referenced by a context's items. */
function collectContextAdrs(
  ctx: DomainContext,
  allAdrs: Map<string, AdrRecord>,
): AdrRecord[] {
  const refs = new Set<string>();

  forEachItem(ctx, (_type, _name, item) => {
    for (const r of itemAdrRefs(item) ?? []) refs.add(r);
  });

  const records: AdrRecord[] = [];
  for (const ref of [...refs].sort()) {
    const rec = allAdrs.get(ref);
    if (rec) records.push(rec);
  }
  return records;
}

/** Relationship tuple used in item templates. */
interface Relationship {
  label: string;
  target: string;
}

/**
 * Build the data object for an item template from a domain item
 * of any supported kind.
 */
function buildItemData(
  itemType: string,
  contextName: string,
  item: {
    name: string;
    description: string;
    fields?: Field[];
    adr_refs?: string[];
    examples?: Example[];
    // event-specific
    raised_by?: string;
    // command-specific
    actor?: string;
    handled_by?: string;
    // policy-specific (nested when/then)
    when?: { events?: string[] };
    then?: { commands?: string[] };
    emits?: { events?: string[] };
    // aggregate-specific (nested after schema refactor)
    handles?: string[] | { commands?: string[] };
    // read-model-specific
    subscribes_to?: string[];
    used_by?: string[];
    // glossary-specific
    aliases?: string[];
    definition?: string;
    // rules / invariants
    invariants?: string[];
    preconditions?: string[];
    rejections?: string[];
  },
) {
  const relationships: Relationship[] = [];

  if (item.raised_by) {
    relationships.push({ label: "Raised by", target: item.raised_by });
  }
  if (item.actor) {
    relationships.push({ label: "Actor", target: item.actor });
  }
  if (item.handled_by) {
    relationships.push({ label: "Handled by", target: item.handled_by });
  }
  for (const t of item.when?.events ?? []) {
    relationships.push({ label: "Triggered by", target: t });
  }
  if (itemType === "Aggregate") {
    // After schema refactor: aggregate handles/emits are nested objects
    const agg = item as unknown as { handles?: { commands?: string[] }; emits?: { events?: string[] } };
    for (const h of agg.handles?.commands ?? []) {
      relationships.push({ label: "Handles", target: h });
    }
    for (const e of agg.emits?.events ?? []) {
      relationships.push({ label: "Emits", target: e });
    }
  } else if (itemType === "Policy") {
    // Policy uses nested then.commands
    for (const e of item.then?.commands ?? []) {
      relationships.push({ label: "Emits", target: e });
    }
  } else {
    // Other types: emits/handles are flat string arrays (legacy)
    for (const e of (item.emits as unknown as string[] | undefined) ?? []) {
      relationships.push({ label: "Emits", target: e });
    }
    for (const h of (item.handles as string[] | undefined) ?? []) {
      relationships.push({ label: "Handles", target: h });
    }
  }
  for (const s of item.subscribes_to ?? []) {
    relationships.push({ label: "Subscribes to", target: s });
  }
  for (const u of item.used_by ?? []) {
    relationships.push({ label: "Used by", target: u });
  }

  return {
    name: item.name,
    itemType,
    context: contextName,
    description: item.description ?? item.definition ?? "",
    meaning: item.definition, // glossary entries carry a definition
    fields: item.fields,
    rules: [
      ...(item.invariants ?? []),
      ...(item.preconditions ?? []),
      ...(item.rejections ?? []),
    ].length > 0
      ? [
          ...(item.invariants ?? []),
          ...(item.preconditions ?? []),
          ...(item.rejections ?? []),
        ]
      : undefined,
    examples: item.examples,
    aliases: item.aliases,
    relationships: relationships.length > 0 ? relationships : undefined,
    adr_refs: item.adr_refs,
  };
}

// ── File writing helpers ──────────────────────────────────────────────

/** Ensure a directory exists, creating it recursively if needed. */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** Write rendered content to a file and track it. */
function writeOutput(
  filePath: string,
  content: string,
  written: string[],
): void {
  writeFileSync(filePath, content, "utf-8");
  written.push(filePath);
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Render the full domain model as Markdown documentation.
 *
 * 1. Compiles Handlebars templates
 * 2. Renders `.dkk/docs/index.md`
 * 3. For each bounded context renders `.dkk/docs/<ctx>/index.md`
 * 4. For each item in a context renders `.dkk/docs/<ctx>/<Item>.md`
 *
 * @returns A {@link RenderResult} with file count and paths.
 */
export function renderDocs(
  model: DomainModel,
  options: RendererOptions = {},
): RenderResult {
  const outDir = options.outputDir ?? docsDir(options.root);
  const tplDir = options.templateDir ?? templatesDir(options.root);
  const written: string[] = [];

  // Register helpers and compile templates
  registerHelpers(Handlebars);
  const tpl = loadTemplates(tplDir);

  // Clean stale output: remove the entire output directory so that files
  // from contexts/items that no longer exist in the YAML model are purged.
  // This mirrors the indexer's drop-and-recreate approach for a clean rebuild.
  rmSync(outDir, { recursive: true, force: true });
  ensureDir(outDir);

  // ── 1. Render top-level index ─────────────────────────────────────

  const flowsData = (model.index.flows ?? []).map((f) => ({
    ...f,
    steps: f.steps.map((s, i) => ({ ...s, stepNumber: i + 1 })),
  }));

  const indexData = {
    contexts: model.index.contexts,
    actors: model.actors,
    glossaryEntries: collectGlossary(model),
    flows: flowsData.length > 0 ? flowsData : undefined,
  };

  writeOutput(join(outDir, "index.md"), tpl.index(indexData), written);

  // ── 2. Render each bounded context ────────────────────────────────

  for (const [ctxName, ctx] of model.contexts) {
    const ctxDir = join(outDir, ctxName);
    ensureDir(ctxDir);

    // Context index page
    const ctxAdrs = collectContextAdrs(ctx, model.adrs);
    const ctxData = {
      ...ctx,
      adrs: ctxAdrs.length > 0 ? ctxAdrs : undefined,
    };
    writeOutput(join(ctxDir, "index.md"), tpl.context(ctxData), written);

    // ── 3. Per-item pages ─────────────────────────────────────────

    /** Map item type to the display label used in templates. */
    const typeLabel: Record<string, string> = {
      event: "Event",
      command: "Command",
      policy: "Policy",
      aggregate: "Aggregate",
      read_model: "Read Model",
      glossary: "Glossary",
    };

    forEachItem(ctx, (type, name, item) => {
      // Glossary entries need a synthetic `name` property for buildItemData.
      const dataItem = type === "glossary"
        ? { ...item, name: (item as { term: string }).term }
        : item;
      const data = buildItemData(
        typeLabel[type],
        ctxName,
        dataItem as unknown as Parameters<typeof buildItemData>[2],
      );
      writeOutput(
        join(ctxDir, `${name}.md`),
        tpl.item(data),
        written,
      );
    });
  }

  return { fileCount: written.length, files: written };
}
