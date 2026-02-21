/**
 * SQLite FTS5 indexer for domain items.
 *
 * Creates / rebuilds an SQLite database at `.domain-pack/index.db`
 * with an FTS5 virtual table `domain_fts` for full-text search across
 * all items in the loaded {@link DomainModel}.
 *
 * The `text` column is a concatenation of description, when/intent,
 * invariants, examples, glossary terms + synonyms — providing a rich
 * body for keyword matching.
 *
 * The rebuild is idempotent: the FTS table is dropped and re-created
 * on every call to {@link buildIndex}.
 */
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import type { DomainModel, DomainContext, AdrRecord, Actor, DomainEvent, Command, Policy, Aggregate, ReadModel, GlossaryEntry } from "../../shared/types/domain.js";
import { forEachItem, itemAdrRefs } from "../../shared/item-visitor.js";
import type { ItemType, AnyDomainItem } from "../../shared/item-visitor.js";
import { repoRoot } from "../../shared/paths.js";

// better-sqlite3 is a CJS package; use createRequire for ESM interop.
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

// ── Types ─────────────────────────────────────────────────────────────

/** Shape of a row in the `domain_fts` virtual table. */
export interface IndexRow {
  /** Unique composite key (e.g. "ordering.OrderPlaced", "actor.Customer"). */
  id: string;
  /** Item kind: context | glossary | actor | event | command | policy | aggregate | read_model | adr | flow. */
  type: string;
  /** Bounded-context name or empty string for top-level items. */
  context: string;
  /** Human-readable display name. */
  name: string;
  /** Space-separated tags / keywords. */
  tags: string;
  /** Concatenated searchable body text. */
  text: string;
  /** JSON-encoded array of relation ids (neighbours). */
  relations: string;
  /** JSON-encoded array of ADR references. */
  adrRefs: string;
}

/** Options for the indexer. */
export interface IndexerOptions {
  /** Override repository root. */
  root?: string;
  /** Override output path (default: `<root>/.domain-pack/index.db`). */
  dbPath?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Join strings with a space, filtering out falsy values. */
function joinText(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Turn an array of field objects into searchable text. */
function fieldsText(fields?: { name: string; type: string; description?: string }[]): string {
  if (!fields?.length) return "";
  return fields.map((f) => `${f.name} ${f.type}${f.description ? " " + f.description : ""}`).join(" ");
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Build (or rebuild) the FTS5 search index from a {@link DomainModel}.
 *
 * The operation is idempotent — the index is fully replaced on each call.
 *
 * @returns The absolute path to the created database file.
 */
export function buildIndex(model: DomainModel, options: IndexerOptions = {}): string {
  const root = options.root ?? repoRoot();
  const dbPath = options.dbPath ?? join(root, ".domain-pack", "index.db");

  // Ensure the parent directory exists.
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  try {
    // Drop previous tables for a clean rebuild.
    db.exec("DROP TABLE IF EXISTS domain_fts;");
    db.exec("DROP TABLE IF EXISTS domain_meta;");

    // Create FTS5 virtual table.
    db.exec(`
      CREATE VIRTUAL TABLE domain_fts USING fts5(
        id,
        type,
        context,
        name,
        tags,
        text,
        relations,
        adrRefs,
        tokenize='porter unicode61'
      );
    `);

    // Metadata table for rebuild timestamps.
    db.exec(`
      CREATE TABLE domain_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO domain_meta (key, value) VALUES (?, ?)").run(
      "built_at",
      new Date().toISOString(),
    );

    // Prepare the insert statement.
    const insert = db.prepare(`
      INSERT INTO domain_fts (id, type, context, name, tags, text, relations, adrRefs)
      VALUES (@id, @type, @context, @name, @tags, @text, @relations, @adrRefs)
    `);

    // Wrap all inserts in a single transaction for performance.
    const insertAll = db.transaction((rows: IndexRow[]) => {
      for (const row of rows) {
        insert.run(row);
      }
    });

    const rows = collectRows(model);
    insertAll(rows);

    return dbPath;
  } finally {
    db.close();
  }
}

// ── Row collection ────────────────────────────────────────────────────

/**
 * Walk the entire domain model and produce one {@link IndexRow} per
 * searchable item.
 */
function collectRows(model: DomainModel): IndexRow[] {
  const rows: IndexRow[] = [];

  // ── Actors ────────────────────────────────────────────────────────

  for (const actor of model.actors) {
    rows.push({
      id: `actor.${actor.name}`,
      type: "actor",
      context: "",
      name: actor.name,
      tags: actor.type,
      text: joinText(actor.description),
      relations: "[]",
      adrRefs: JSON.stringify(actor.adr_refs ?? []),
    });
  }

  // ── Bounded contexts & their items ──────────────────────────────

  for (const [ctxName, ctx] of model.contexts) {
    // Context itself
    rows.push({
      id: `context.${ctxName}`,
      type: "context",
      context: ctxName,
      name: ctxName,
      tags: "",
      text: joinText(ctx.description),
      relations: "[]",
      adrRefs: "[]",
    });

    // Glossary, events, commands, policies, aggregates, read models
    forEachItem(ctx, (type, name, item) => {
      const id = `${ctxName}.${name}`;
      const adrRefs = JSON.stringify(itemAdrRefs(item) ?? []);

      switch (type) {
        case "glossary": {
          const entry = item as GlossaryEntry;
          const aliases = entry.aliases ?? [];
          rows.push({
            id,
            type: "glossary",
            context: ctxName,
            name: entry.term,
            tags: aliases.join(" "),
            text: joinText(entry.definition, ...aliases),
            relations: "[]",
            adrRefs,
          });
          break;
        }
        case "event": {
          const evt = item as DomainEvent;
          const relIds: string[] = [];
          if (evt.raised_by) relIds.push(`${ctxName}.${evt.raised_by}`);
          rows.push({
            id,
            type: "event",
            context: ctxName,
            name: evt.name,
            tags: "",
            text: joinText(evt.description, fieldsText(evt.fields)),
            relations: JSON.stringify(relIds),
            adrRefs,
          });
          break;
        }
        case "command": {
          const cmd = item as Command;
          const relIds: string[] = [];
          if (cmd.handled_by) relIds.push(`${ctxName}.${cmd.handled_by}`);
          if (cmd.actor) relIds.push(`actor.${cmd.actor}`);
          rows.push({
            id,
            type: "command",
            context: ctxName,
            name: cmd.name,
            tags: "",
            text: joinText(cmd.description, fieldsText(cmd.fields)),
            relations: JSON.stringify(relIds),
            adrRefs,
          });
          break;
        }
        case "policy": {
          const pol = item as Policy;
          const relIds: string[] = [];
          for (const t of pol.triggers ?? []) relIds.push(`${ctxName}.${t}`);
          for (const e of pol.emits ?? []) relIds.push(`${ctxName}.${e}`);
          rows.push({
            id,
            type: "policy",
            context: ctxName,
            name: pol.name,
            tags: "",
            text: joinText(pol.description),
            relations: JSON.stringify(relIds),
            adrRefs,
          });
          break;
        }
        case "aggregate": {
          const agg = item as Aggregate;
          const relIds: string[] = [];
          for (const h of agg.handles ?? []) relIds.push(`${ctxName}.${h}`);
          for (const e of agg.emits ?? []) relIds.push(`${ctxName}.${e}`);
          rows.push({
            id,
            type: "aggregate",
            context: ctxName,
            name: agg.name,
            tags: "",
            text: joinText(agg.description),
            relations: JSON.stringify(relIds),
            adrRefs,
          });
          break;
        }
        case "read_model": {
          const rm = item as ReadModel;
          const relIds: string[] = [];
          for (const sub of rm.subscribes_to ?? []) relIds.push(`${ctxName}.${sub}`);
          for (const user of rm.used_by ?? []) relIds.push(`actor.${user}`);
          rows.push({
            id,
            type: "read_model",
            context: ctxName,
            name: rm.name,
            tags: "",
            text: joinText(rm.description),
            relations: JSON.stringify(relIds),
            adrRefs,
          });
          break;
        }
      }
    });
  }

  // ── ADRs ──────────────────────────────────────────────────────────

  for (const [adrId, adr] of model.adrs) {
    const relIds: string[] = [];
    for (const ref of adr.domain_refs ?? []) relIds.push(ref);
    if (adr.superseded_by) relIds.push(adr.superseded_by);
    rows.push({
      id: adrId,
      type: "adr",
      context: "",
      name: adr.title,
      tags: adr.status,
      text: joinText(
        adr.title,
        adr.status,
        adr.deciders?.join(" "),
        adr.body,
      ),
      relations: JSON.stringify(relIds),
      adrRefs: "[]",
    });
  }

  // ── Flows ─────────────────────────────────────────────────────────

  for (const flow of model.index.flows ?? []) {
    const stepRefs = flow.steps.map((s) => s.ref as string);
    rows.push({
      id: `flow.${flow.name}`,
      type: "flow",
      context: "",
      name: flow.name,
      tags: "",
      text: joinText(flow.description, ...flow.steps.map((s) => s.ref as string)),
      relations: JSON.stringify(stepRefs),
      adrRefs: "[]",
    });
  }

  return rows;
}
