/**
 * Search index record type for the deterministic search index.
 *
 * Each record represents a single searchable domain item that can be
 * looked up by keyword, type, or context.
 */

import type {
  AdrRef,
  DomainRef,
} from "./domain.js";

/** The kind of domain item stored in a search index record. */
export type SearchItemType =
  | "context"
  | "glossary"
  | "actor"
  | "event"
  | "command"
  | "policy"
  | "aggregate"
  | "read_model"
  | "adr"
  | "flow";

/**
 * A single record in the search index, representing one domain item
 * with enough metadata for keyword look-up and filtering.
 */
export interface SearchIndexRecord {
  /** Unique composite key: "<context>.<Name>" for context-scoped items,
   *  or the item's own id/name for top-level items (actors, ADRs, flows). */
  id: string;
  /** Kind of domain item. */
  type: SearchItemType;
  /** Human-readable display name. */
  name: string;
  /** Bounded-context name this item belongs to (if applicable). */
  context?: string;
  /** Short description (first sentence or full). */
  description: string;
  /** Searchable keywords extracted from name, aliases, fields, etc. */
  keywords: string[];
  /** Related ADR references. */
  adr_refs?: AdrRef[];
  /** Related domain item references. */
  domain_refs?: DomainRef[];
}

// Re-export all domain types for convenience.
export * from "./domain.js";
