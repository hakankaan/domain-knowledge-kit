/**
 * FTS5 searcher for domain items.
 *
 * Accepts a query string and optional filters (context, type, tag,
 * status, service), performs an FTS5 MATCH query against the index
 * built by the indexer,
 * applies boost scoring, post-FTS filters, and graph expansion for
 * top-N results. Returns a ranked list of search results.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DomainGraph } from "../../shared/graph.js";
import { repoRoot } from "../../shared/paths.js";
import { parseRef } from "../../shared/refs.js";

// better-sqlite3 CJS interop
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

// ── Types ─────────────────────────────────────────────────────────────

/** A single search result. */
export interface SearchResult {
  /**
   * Unique identifier. Local items use `<ctx>.<Name>` / `actor.X` /
   * `adr-NNNN` / `flow.X` / `context.X`. Peer items are prefixed with
   * `<service>:` so that two services sharing an item name don't
   * collide in FTS.
   */
  id: string;
  /** Item kind. */
  type: string;
  /** Bounded-context name (empty for top-level items). */
  context: string;
  /** Human-readable display name. */
  name: string;
  /**
   * Source service. Empty string for local rows in unfederated repos;
   * the local service name when federation is configured; the peer
   * service name for peer rows.
   */
  service: string;
  /** Short excerpt with matching text. */
  excerpt: string;
  /** Computed relevance score (higher = more relevant). */
  score: number;
  /** Related item ids (direct relations from the index). */
  relatedIds: string[];
  /** ADR references attached to this item. */
  adrIds: string[];
  /** Lifecycle status, for item types that have one (ADRs). */
  status?: string;
}

/** Filters that narrow search results. */
export interface SearchFilters {
  /** Only include items in this bounded context. */
  context?: string;
  /** Only include items of this type. */
  type?: string;
  /** Only include items whose tags contain this value. */
  tag?: string;
  /**
   * Only include items with this lifecycle status (ADRs today).
   * Exact match — `proposed` does not also return `superseded`.
   */
  status?: string;
  /**
   * Only include items from this service. Use the empty string to
   * match local rows in unfederated repos. Useful for narrowing to
   * "what does service X publish?" or "what's only local?".
   */
  service?: string;
}

/** Options for the searcher. */
export interface SearcherOptions {
  /** Override repository root. */
  root?: string;
  /** Override database path. */
  dbPath?: string;
  /** Maximum number of results to return (default: 20). */
  limit?: number;
  /** When provided, expand top results with graph neighbours. */
  graph?: DomainGraph;
  /** Number of top results to expand with graph neighbours (default: 5). */
  expandTopN?: number;
  /** BFS depth for graph expansion (default: 1). */
  expandDepth?: number;
}

// ── Score boosts ──────────────────────────────────────────────────────

/** Boost multipliers for different match locations. */
const BOOST = {
  /** Query matches item id exactly. */
  exactId: 10,
  /** Query appears in item name. */
  name: 5,
  /** Query appears in tags. */
  tag: 3,
  /** Query appears in text body. */
  text: 1,
} as const;

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Sanitise a user query for FTS5.
 *
 * FTS5 treats certain chars as operators. We escape double-quotes and
 * wrap each token in quotes so special chars are treated literally.
 * Empty queries are returned as-is (the caller should handle that).
 */
function sanitiseQuery(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Split on whitespace, wrap each token in double-quotes, join with spaces.
  // This produces an implicit AND query.
  const tokens = trimmed.split(/\s+/).map((t) => `"${t.replace(/"/g, '""')}"`);
  return tokens.join(" ");
}

/**
 * Build an excerpt centred on the first place a query term appears.
 *
 * Taking the head of the text column instead — the previous behaviour —
 * meant a document whose match lived halfway down showed an excerpt of
 * its own preamble: technically an excerpt, useless as evidence that
 * the result is the one you wanted.
 */
export function makeExcerpt(text: string, query = "", maxLen: number = 200): string {
  if (text.length <= maxLen) return text;

  const haystack = text.toLowerCase();
  const hit = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => haystack.indexOf(token))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b)[0];

  if (hit === undefined || hit < maxLen / 2) {
    return text.slice(0, maxLen).trimEnd() + "…";
  }

  // Centre the window on the match, then snap to word boundaries so
  // the excerpt does not start or end mid-token.
  let start = Math.max(0, hit - Math.floor(maxLen / 3));
  const spaceBefore = text.lastIndexOf(" ", start);
  if (spaceBefore > 0 && start - spaceBefore < 20) start = spaceBefore + 1;

  const end = Math.min(text.length, start + maxLen);
  const slice = text.slice(start, end).trimEnd();
  return `…${slice}${end < text.length ? "…" : ""}`;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Search the FTS5 index for domain items matching `query`.
 *
 * Steps:
 * 1. Run FTS5 MATCH query to get candidate rows + BM25 scores.
 * 2. Apply boost scoring (exact-id, name, tag, glossary).
 * 3. Apply post-FTS filters (context, type, tag, status, service).
 * 4. Sort by final score descending.
 * 5. If a {@link DomainGraph} is provided, expand top-N results with
 *    graph neighbours and include linked ADRs.
 * 6. Return the capped result list.
 */
export function search(
  query: string,
  filters: SearchFilters = {},
  options: SearcherOptions = {},
): SearchResult[] {
  const root = options.root ?? repoRoot();
  const dbPath = options.dbPath ?? join(root, ".dkk", "index.db");
  const limit = options.limit ?? 20;
  const expandTopN = options.expandTopN ?? 5;
  const expandDepth = options.expandDepth ?? 1;

  if (!existsSync(dbPath)) {
    throw new Error(`Search index not found at ${dbPath}. Run 'render' first.`);
  }

  const ftsQuery = sanitiseQuery(query);
  if (!ftsQuery) return [];

  const db = new Database(dbPath, { readonly: true });

  try {
    // ── Step 1: FTS5 MATCH ────────────────────────────────────────

    const stmt = db.prepare(`
      SELECT
        id,
        type,
        context,
        name,
        service,
        tags,
        status,
        text,
        relations,
        adrRefs,
        rank
      FROM domain_fts
      WHERE domain_fts MATCH ?
      ORDER BY rank
      LIMIT 200
    `);

    type FtsRow = {
      id: string;
      type: string;
      context: string;
      name: string;
      service: string;
      tags: string;
      status: string;
      text: string;
      relations: string;
      adrRefs: string;
      rank: number;
    };

    const rows = stmt.all(ftsQuery) as FtsRow[];

    // ── Step 2: Boost scoring ─────────────────────────────────────

    const queryLower = query.toLowerCase();

    const scored: { row: FtsRow; score: number }[] = rows.map((row) => {
      // BM25 rank is negative (closer to 0 = better); invert to positive.
      let score = -row.rank;

      // Exact ID match
      if (row.id.toLowerCase() === queryLower) {
        score += BOOST.exactId;
      }

      // Name match
      if (row.name.toLowerCase().includes(queryLower)) {
        score += BOOST.name;
      }

      // Tag match
      if (row.tags.toLowerCase().includes(queryLower)) {
        score += BOOST.tag;
      }

      return { row, score };
    });

    // ── Step 3: Post-FTS filters ──────────────────────────────────

    let filtered = scored;

    if (filters.context) {
      const ctx = filters.context.toLowerCase();
      filtered = filtered.filter((s) => s.row.context.toLowerCase() === ctx);
    }
    if (filters.type) {
      const t = filters.type.toLowerCase();
      filtered = filtered.filter((s) => s.row.type.toLowerCase() === t);
    }
    if (filters.tag) {
      const tag = filters.tag.toLowerCase();
      filtered = filtered.filter((s) => s.row.tags.toLowerCase().includes(tag));
    }
    if (filters.status) {
      const st = filters.status.toLowerCase();
      filtered = filtered.filter((s) => (s.row.status ?? "").toLowerCase() === st);
    }
    if (filters.service !== undefined) {
      const svc = filters.service.toLowerCase();
      filtered = filtered.filter((s) => s.row.service.toLowerCase() === svc);
    }

    // ── Step 4: Sort ──────────────────────────────────────────────

    filtered.sort((a, b) => b.score - a.score);

    // ── Step 5: Graph expansion ───────────────────────────────────

    const results: SearchResult[] = [];
    const seenIds = new Set<string>();

    for (const { row, score } of filtered.slice(0, limit)) {
      seenIds.add(row.id);

      const relatedIds: string[] = safeParse(row.relations);
      const adrIds: string[] = safeParse(row.adrRefs);

      // Graph expansion for top-N items
      if (options.graph && results.length < expandTopN) {
        const expanded = options.graph.getRelated(row.id, expandDepth);
        for (const nId of expanded) {
          relatedIds.push(nId);
        }
        // Collect ADR ids from graph neighbours (federation-aware:
        // `adr-NNNN` and `<service>:adr-NNNN` both count).
        for (const nId of expanded) {
          const parsed = parseRef(nId);
          if (parsed?.kind === "adr" && !adrIds.includes(nId)) {
            adrIds.push(nId);
          }
        }
      }

      // Deduplicate
      const uniqueRelated = [...new Set(relatedIds)];
      const uniqueAdrs = [...new Set(adrIds)];

      results.push({
        id: row.id,
        type: row.type,
        context: row.context,
        name: row.name,
        service: row.service ?? "",
        excerpt: makeExcerpt(row.text, query),
        score: Math.round(score * 1000) / 1000,
        relatedIds: uniqueRelated,
        adrIds: uniqueAdrs,
        ...(row.status ? { status: row.status } : {}),
      });
    }

    return results;
  } finally {
    db.close();
  }
}

// ── Internal ──────────────────────────────────────────────────────────

/** Safely parse a JSON array, returning [] on failure. */
function safeParse(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
