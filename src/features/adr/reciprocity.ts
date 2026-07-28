/**
 * ADR ↔ domain link reciprocity.
 *
 * The link is stored twice — `domain_refs` on the ADR, `adr_refs` on
 * the target — and the two halves are not equivalent to consumers.
 * The rendered docs, `dkk story`, and the search index's `adrRefs`
 * column all read the *item* side, so an ADR that lists an item the
 * item does not list back is a link nobody sees.
 *
 * Nothing checked this, even though the ADR guide advertised
 * bidirectional linking as enforced. This module computes the gaps;
 * the validator reports them as warnings and `dkk adr audit` lists them.
 */
import type { DomainModel } from "../../shared/types/domain.js";
import { forEachItem, itemAdrRefs } from "../../shared/item-visitor.js";

/** One half of a link that has no matching other half. */
export interface AdrLinkGap {
  /** The ADR id involved. */
  adr: string;
  /** The referenced target id (e.g. "ordering.Order", "actor.Customer"). */
  target: string;
  /**
   * `adr-only`  — the ADR lists the target; the target does not list back.
   * `item-only` — the target lists the ADR; the ADR does not list back.
   */
  direction: "adr-only" | "item-only";
}

/** Every id an ADR `domain_refs` entry can point at, with its `adr_refs`. */
export function collectAdrRefTargets(model: DomainModel): Map<string, string[]> {
  const targets = new Map<string, string[]>();

  for (const [ctxName, ctx] of model.contexts) {
    targets.set(`context.${ctxName}`, [...(ctx.adr_refs ?? [])]);
    forEachItem(ctx, (_type, name, item) => {
      targets.set(`${ctxName}.${name}`, [...(itemAdrRefs(item) ?? [])]);
    });
  }
  for (const actor of model.actors) {
    targets.set(`actor.${actor.name}`, [...(actor.adr_refs ?? [])]);
  }
  for (const flow of model.index.flows ?? []) {
    targets.set(`flow.${flow.name}`, [...(flow.adr_refs ?? [])]);
  }

  return targets;
}

/**
 * Find links recorded on only one side.
 *
 * Cross-service refs are skipped in both directions: the peer's files
 * live in another repository, so the reciprocal half is not ours to
 * write and its absence is not a defect here.
 *
 * Refs that do not resolve at all are also skipped — those are already
 * reported as hard errors by the validator, and repeating them here as
 * reciprocity warnings would just double the noise.
 */
export function findLinkGaps(model: DomainModel): AdrLinkGap[] {
  const targets = collectAdrRefTargets(model);
  const gaps: AdrLinkGap[] = [];

  for (const [adrId, adr] of model.adrs) {
    for (const ref of adr.domain_refs ?? []) {
      if (ref.includes(":")) continue;
      const back = targets.get(ref);
      if (back === undefined) continue; // unresolved — validator's job
      if (!back.includes(adrId)) {
        gaps.push({ adr: adrId, target: ref, direction: "adr-only" });
      }
    }
  }

  for (const [target, refs] of targets) {
    for (const ref of refs) {
      if (ref.includes(":")) continue;
      const adr = model.adrs.get(ref);
      if (!adr) continue; // unresolved — validator's job
      if (!(adr.domain_refs ?? []).includes(target)) {
        gaps.push({ adr: ref, target, direction: "item-only" });
      }
    }
  }

  return gaps.sort(
    (a, b) => a.adr.localeCompare(b.adr) || a.target.localeCompare(b.target),
  );
}
