/**
 * ADR lifecycle statuses and the transitions between them.
 *
 * `rejected` exists because a proposal that was declined has to go
 * somewhere, and `deprecated` is the wrong home for it: deprecated
 * reads as "was in effect, no longer is", which is a false history for
 * a decision that never took effect. Keeping the two apart is what
 * makes "what have we already turned down?" answerable.
 */

/** Every valid ADR status, in rough lifecycle order. */
export const ADR_STATUSES = [
  "proposed",
  "accepted",
  "rejected",
  "deprecated",
  "superseded",
] as const;

/** Union of the valid status strings. */
export type AdrStatusName = (typeof ADR_STATUSES)[number];

/** Statuses whose decision is currently binding on new code. */
export const ACTIVE_STATUSES: readonly AdrStatusName[] = ["accepted"];

/** Statuses that record a decision no longer in effect. */
export const RETIRED_STATUSES: readonly AdrStatusName[] = [
  "rejected",
  "deprecated",
  "superseded",
];

/** One-line meaning of each status, shown in CLI help and audit output. */
export const STATUS_MEANING: Record<AdrStatusName, string> = {
  proposed: "under discussion — not in effect yet",
  accepted: "in effect — new code must comply",
  rejected: "considered and declined — kept so it is not relitigated",
  deprecated: "was in effect, no longer applies",
  superseded: "replaced by a later ADR (see superseded_by)",
};

/**
 * Transitions that are normal. Anything else still goes through, but
 * with a warning: reviving a superseded decision in place, for
 * instance, usually means a new ADR was wanted instead.
 */
const EXPECTED: Record<AdrStatusName, readonly AdrStatusName[]> = {
  proposed: ["accepted", "rejected", "deprecated"],
  accepted: ["deprecated", "superseded"],
  rejected: ["proposed", "accepted"],
  deprecated: ["accepted", "superseded"],
  superseded: ["accepted", "deprecated"],
};

/**
 * Explain why a transition is unusual, or `null` when it is routine.
 */
export function transitionWarning(
  from: AdrStatusName,
  to: AdrStatusName,
): string | null {
  if (from === to) return null;
  if (EXPECTED[from]?.includes(to)) return null;
  return `"${from}" → "${to}" is an unusual transition (${STATUS_MEANING[from]} → ${STATUS_MEANING[to]}). If the direction of the decision changed, a new ADR that supersedes this one is usually the better record.`;
}

/** Title-case label for prose (`**Status:** Accepted`). */
export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
