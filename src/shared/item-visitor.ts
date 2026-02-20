/**
 * Item visitor utility — encapsulates the 'iterate over all item types
 * in a bounded context' pattern.
 *
 * Before this utility, the sequence
 *   `ctx.events ?? [] → ctx.commands ?? [] → ctx.policies ?? [] →
 *    ctx.aggregates ?? [] → ctx.read_models ?? [] → ctx.glossary ?? []`
 * was copy-pasted in 5+ locations. Adding a new domain item type
 * required modifying every one of those sites.
 *
 * Two entry points are provided:
 *
 * - {@link forEachItem} — iterate with a callback (side-effects).
 * - {@link mapItems}    — collect mapped results into an array.
 */

import type {
  DomainContext,
  DomainEvent,
  Command,
  Policy,
  Aggregate,
  ReadModel,
  GlossaryEntry,
  AdrRef,
} from "./types/domain.js";

// ── Types ─────────────────────────────────────────────────────────────

/** The six domain item categories that live inside a bounded context. */
export type ItemType =
  | "event"
  | "command"
  | "policy"
  | "aggregate"
  | "read_model"
  | "glossary";

/** Union of every domain item interface. */
export type AnyDomainItem =
  | DomainEvent
  | Command
  | Policy
  | Aggregate
  | ReadModel
  | GlossaryEntry;

/**
 * Canonical item types in their standard iteration order.
 * Matches the order used historically across the codebase.
 */
export const ITEM_TYPES: readonly ItemType[] = [
  "event",
  "command",
  "policy",
  "aggregate",
  "read_model",
  "glossary",
] as const;

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Get the canonical display name of any domain item.
 *
 * Most items use `.name`; glossary entries use `.term`.
 */
export function itemName(item: AnyDomainItem): string {
  return "term" in item && typeof (item as GlossaryEntry).term === "string"
    ? (item as GlossaryEntry).term
    : (item as Exclude<AnyDomainItem, GlossaryEntry>).name;
}

/**
 * Get the description text of any domain item.
 *
 * Most items use `.description`; glossary entries use `.definition`.
 */
export function itemDescription(item: AnyDomainItem): string {
  return "definition" in item && typeof (item as GlossaryEntry).definition === "string"
    ? (item as GlossaryEntry).definition
    : (item as Exclude<AnyDomainItem, GlossaryEntry>).description;
}

/**
 * Get `adr_refs` from any domain item (all types carry this optional field).
 */
export function itemAdrRefs(item: AnyDomainItem): AdrRef[] | undefined {
  return (item as { adr_refs?: AdrRef[] }).adr_refs;
}

// ── Entry points ──────────────────────────────────────────────────────

/**
 * Iterate every domain item in a bounded context, calling `fn` once
 * per item. Items are visited in canonical type order (events, commands,
 * policies, aggregates, read models, glossary).
 *
 * @param ctx - The bounded context to visit.
 * @param fn  - Callback receiving the item type, its canonical name,
 *              and the item object itself.
 */
export function forEachItem(
  ctx: DomainContext,
  fn: (type: ItemType, name: string, item: AnyDomainItem) => void,
): void {
  for (const e of ctx.events ?? []) fn("event", e.name, e);
  for (const c of ctx.commands ?? []) fn("command", c.name, c);
  for (const p of ctx.policies ?? []) fn("policy", p.name, p);
  for (const a of ctx.aggregates ?? []) fn("aggregate", a.name, a);
  for (const r of ctx.read_models ?? []) fn("read_model", r.name, r);
  for (const g of ctx.glossary ?? []) fn("glossary", g.term, g);
}

/**
 * Map every domain item in a bounded context to a value, collecting
 * all results into an array. Items are visited in canonical type order.
 *
 * @param ctx - The bounded context to visit.
 * @param fn  - Mapping function receiving the item type, its canonical
 *              name, and the item object itself.
 * @returns An array of mapped values, one per item.
 */
export function mapItems<R>(
  ctx: DomainContext,
  fn: (type: ItemType, name: string, item: AnyDomainItem) => R,
): R[] {
  const results: R[] = [];
  forEachItem(ctx, (type, name, item) => {
    results.push(fn(type, name, item));
  });
  return results;
}
