/**
 * SQLite FTS5 indexer for domain items.
 *
 * Creates / rebuilds an SQLite database at `.dkk/index.db`
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
import type { DomainModel, DomainEvent, Command, Policy, Aggregate, ReadModel, GlossaryEntry } from "../../shared/types/domain.js";
import { forEachItem, itemAdrRefs } from "../../shared/item-visitor.js";
import { repoRoot } from "../../shared/paths.js";
import { qualifyItemRef, qualifyActorRef } from "../../shared/refs.js";

// better-sqlite3 is a CJS package; use createRequire for ESM interop.
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

// ── Types ─────────────────────────────────────────────────────────────

/** Shape of a row in the `domain_fts` virtual table. */
export interface IndexRow {
  /**
   * Unique composite key. For local rows: `<ctx>.<Name>` / `actor.X` /
   * `adr-NNNN` / `flow.X` / `context.X`. For peer rows: prefixed with
   * `<service>:` so that two services sharing an item name don't
   * collide in FTS.
   */
  id: string;
  /** Item kind: context | glossary | actor | event | command | policy | aggregate | read_model | adr | flow. */
  type: string;
  /** Bounded-context name or empty string for top-level items. */
  context: string;
  /** Human-readable display name. */
  name: string;
  /**
   * Source service. Empty string for local rows in unfederated repos.
   * Equals `model.service.name` for local rows when federation is
   * configured. For peer rows: the peer's service name.
   */
  service: string;
  /** Space-separated tags / keywords. */
  tags: string;
  /** Concatenated searchable body text. */
  text: string;
  /** JSON-encoded array of relation ids (neighbours), each prefixed when foreign. */
  relations: string;
  /** JSON-encoded array of ADR references. */
  adrRefs: string;
}

/** Options for the indexer. */
export interface IndexerOptions {
  /** Override repository root. */
  root?: string;
  /** Override output path (default: `<root>/.dkk/index.db`). */
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
  const dbPath = options.dbPath ?? join(root, ".dkk", "index.db");

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
        service,
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
      INSERT INTO domain_fts (id, type, context, name, service, tags, text, relations, adrRefs)
      VALUES (@id, @type, @context, @name, @service, @tags, @text, @relations, @adrRefs)
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
 * Walk the domain model (local + any loaded peers) and produce one
 * {@link IndexRow} per searchable item.
 *
 * Local rows keep the existing id grammar (`<ctx>.<Name>`, `actor.X`,
 * `adr-NNNN`, `flow.X`, `context.X`). Peer rows are prefixed with
 * `<peerService>:` everywhere — including in the `relations` array —
 * so two services sharing an item name don't collide in FTS, and a
 * peer's relations remain traceable as foreign refs.
 *
 * Peer collection is wrapped per-peer; an error in one peer is
 * logged and that peer's rows are skipped rather than aborting the
 * whole index build.
 */
export function collectRows(model: DomainModel): IndexRow[] {
  const localServiceName = model.service?.name ?? "";
  const rows: IndexRow[] = collectModelRows(model, undefined, localServiceName);

  for (const [peerName, peerModel] of model.peers ?? []) {
    try {
      const peerRows = collectModelRows(peerModel, peerName, peerName);
      rows.push(...peerRows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`dkk: skipped indexing peer "${peerName}": ${msg}`);
    }
  }

  return rows;
}

/**
 * Collect rows for a single domain model. When `peerPrefix` is set,
 * every emitted `id` (including relation ids) is prefixed with
 * `<peerPrefix>:`. `service` records the source service on each row.
 */
function collectModelRows(
  model: DomainModel,
  peerPrefix: string | undefined,
  service: string,
): IndexRow[] {
  const rows: IndexRow[] = [];
  const pfx = peerPrefix ? `${peerPrefix}:` : "";

  /** Qualify an intra-context name-only ref against this walk's prefix. */
  const rel = (ref: string, ctxName: string): string =>
    qualifyItemRef(ref, pfx, ctxName).id;
  /** Qualify a bare actor-name ref against this walk's prefix. */
  const actorRel = (ref: string): string =>
    qualifyActorRef(ref, pfx).id;

  // ── Actors ────────────────────────────────────────────────────────

  for (const actor of model.actors) {
    rows.push({
      id: `${pfx}actor.${actor.name}`,
      type: "actor",
      context: "",
      name: actor.name,
      service,
      tags: actor.type,
      text: joinText(actor.description, ...(actor.capabilities ?? []), ...(actor.failure_modes ?? [])),
      relations: "[]",
      adrRefs: JSON.stringify((actor.adr_refs ?? []).map((r) => `${pfx}${r}`)),
    });
  }

  // ── Bounded contexts & their items ──────────────────────────────

  for (const [ctxName, ctx] of model.contexts) {
    // Context itself
    rows.push({
      id: `${pfx}context.${ctxName}`,
      type: "context",
      context: ctxName,
      name: ctxName,
      service,
      tags: "",
      text: joinText(ctx.description),
      relations: "[]",
      adrRefs: "[]",
    });

    // Glossary, events, commands, policies, aggregates, read models
    forEachItem(ctx, (type, name, item) => {
      const id = `${pfx}${ctxName}.${name}`;
      const adrRefs = JSON.stringify((itemAdrRefs(item) ?? []).map((r) => `${pfx}${r}`));

      switch (type) {
        case "glossary": {
          const entry = item as GlossaryEntry;
          const aliases = entry.aliases ?? [];
          rows.push({
            id,
            type: "glossary",
            context: ctxName,
            name: entry.term,
            service,
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
          if (evt.raised_by) relIds.push(rel(evt.raised_by, ctxName));
          rows.push({
            id,
            type: "event",
            context: ctxName,
            name: evt.name,
            service,
            tags: "",
            text: joinText(evt.description, fieldsText(evt.fields), ...(evt.invariants ?? [])),
            relations: JSON.stringify(relIds),
            adrRefs,
          });
          break;
        }
        case "command": {
          const cmd = item as Command;
          const relIds: string[] = [];
          if (cmd.handled_by) relIds.push(rel(cmd.handled_by, ctxName));
          if (cmd.actor) relIds.push(actorRel(cmd.actor));
          rows.push({
            id,
            type: "command",
            context: ctxName,
            name: cmd.name,
            service,
            tags: "",
            text: joinText(cmd.description, fieldsText(cmd.fields), ...(cmd.preconditions ?? []), ...(cmd.rejections ?? [])),
            relations: JSON.stringify(relIds),
            adrRefs,
          });
          break;
        }
        case "policy": {
          const pol = item as Policy;
          const relIds: string[] = [];
          for (const t of pol.when?.events ?? []) relIds.push(rel(t, ctxName));
          for (const e of pol.then?.commands ?? []) relIds.push(rel(e, ctxName));
          rows.push({
            id,
            type: "policy",
            context: ctxName,
            name: pol.name,
            service,
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
          for (const h of agg.handles?.commands ?? []) relIds.push(rel(h, ctxName));
          for (const e of agg.emits?.events ?? []) relIds.push(rel(e, ctxName));
          rows.push({
            id,
            type: "aggregate",
            context: ctxName,
            name: agg.name,
            service,
            tags: "",
            text: joinText(agg.description, ...(agg.invariants ?? [])),
            relations: JSON.stringify(relIds),
            adrRefs,
          });
          break;
        }
        case "read_model": {
          const rm = item as ReadModel;
          const relIds: string[] = [];
          for (const sub of rm.subscribes_to ?? []) relIds.push(rel(sub, ctxName));
          for (const user of rm.used_by ?? []) relIds.push(actorRel(user));
          rows.push({
            id,
            type: "read_model",
            context: ctxName,
            name: rm.name,
            service,
            tags: "",
            text: joinText(rm.description, fieldsText(rm.fields)),
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
    // domain_refs may already be service-qualified by the author; only
    // add the peer prefix when they are not. (A peer's ADR with a
    // cross-service ref keeps its original form.)
    for (const ref of adr.domain_refs ?? []) {
      relIds.push(ref.includes(":") || !pfx ? ref : `${pfx}${ref}`);
    }
    if (adr.superseded_by) {
      relIds.push(adr.superseded_by.includes(":") || !pfx ? adr.superseded_by : `${pfx}${adr.superseded_by}`);
    }
    rows.push({
      id: `${pfx}${adrId}`,
      type: "adr",
      context: "",
      name: adr.title,
      service,
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
    const stepRefs = flow.steps.map((s) => {
      const r = s.ref as string;
      return r.includes(":") || !pfx ? r : `${pfx}${r}`;
    });
    rows.push({
      id: `${pfx}flow.${flow.name}`,
      type: "flow",
      context: "",
      name: flow.name,
      service,
      tags: "",
      text: joinText(flow.description, ...stepRefs),
      relations: JSON.stringify(stepRefs),
      adrRefs: "[]",
    });
  }

  return rows;
}
