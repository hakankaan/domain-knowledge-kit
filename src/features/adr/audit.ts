/**
 * Decision-freshness audit.
 *
 * `dkk validate` answers "is the model internally consistent?". It
 * cannot answer "are these decisions still worth trusting?" — an ADR
 * linked to nothing, a proposal nobody ever accepted or rejected, or a
 * decision whose own review date has passed are all perfectly valid and
 * all rotting. Orphan detection explicitly skipped ADRs, so the one
 * item type where staleness matters most had no staleness signal at all.
 */
import type { AdrRecord, DomainModel } from "../../shared/types/domain.js";
import { collectAdrRefTargets, findLinkGaps, type AdrLinkGap } from "./reciprocity.js";
import { RETIRED_STATUSES, type AdrStatusName } from "./status.js";

/** Default age, in days, at which a `proposed` ADR is considered stalled. */
export const DEFAULT_STALE_PROPOSAL_DAYS = 90;

/** An ADR flagged by the audit, with the reason attached. */
export interface AdrFinding {
  id: string;
  title: string;
  status: string;
  /** Human-readable explanation of why it was flagged. */
  detail: string;
}

/** Everything one audit run found. */
export interface AdrAuditReport {
  /** Total ADRs considered. */
  total: number;
  /** Counts per status. */
  byStatus: Record<string, number>;
  /** ADRs connected to no domain item, in either direction. */
  unlinked: AdrFinding[];
  /** `proposed` ADRs older than the staleness threshold. */
  stalledProposals: AdrFinding[];
  /** ADRs whose `review_by` date has passed. */
  overdueReview: AdrFinding[];
  /** Links recorded on only one of the two sides. */
  linkGaps: AdrLinkGap[];
  /** Supersession chains that do not hang together. */
  brokenChains: AdrFinding[];
  /** True when nothing was flagged. */
  clean: boolean;
}

/** Whole days between two ISO dates; negative when `date` is in the future. */
function daysSince(date: string, now: Date): number {
  const then = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(then)) return 0;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

function finding(adr: AdrRecord, detail: string): AdrFinding {
  return { id: adr.id, title: adr.title, status: adr.status, detail };
}

/** Options controlling audit thresholds. */
export interface AdrAuditOptions {
  /** Age in days past which a `proposed` ADR is reported. */
  staleProposalDays?: number;
  /** "Now" — injectable so tests are not clock-dependent. */
  now?: Date;
}

/**
 * Audit every ADR in the model for rot.
 *
 * Retired decisions (rejected/deprecated/superseded) are exempt from
 * the link and staleness checks: they are history, and history is
 * supposed to sit there unlinked.
 */
export function auditAdrs(
  model: DomainModel,
  options: AdrAuditOptions = {},
): AdrAuditReport {
  const now = options.now ?? new Date();
  const staleDays = options.staleProposalDays ?? DEFAULT_STALE_PROPOSAL_DAYS;

  const byStatus: Record<string, number> = {};
  const unlinked: AdrFinding[] = [];
  const stalledProposals: AdrFinding[] = [];
  const overdueReview: AdrFinding[] = [];
  const brokenChains: AdrFinding[] = [];

  // Inbound edges: which ADRs are named by some target's `adr_refs`.
  const referenced = new Set<string>();
  for (const [, refs] of collectAdrRefTargets(model)) {
    for (const r of refs) referenced.add(r);
  }

  for (const [id, adr] of model.adrs) {
    byStatus[adr.status] = (byStatus[adr.status] ?? 0) + 1;
    const retired = RETIRED_STATUSES.includes(adr.status as AdrStatusName);

    if (!retired && !(adr.domain_refs?.length || referenced.has(id))) {
      unlinked.push(
        finding(
          adr,
          "not linked to any domain item — it cannot surface from `dkk related`, the rendered docs, or an item-side lookup. Link it with `dkk adr link`, or accept that it is a project-level decision with no domain footprint.",
        ),
      );
    }

    if (adr.status === "proposed") {
      const age = daysSince(adr.date, now);
      if (age > staleDays) {
        stalledProposals.push(
          finding(adr, `proposed ${age} days ago and still undecided — accept, reject, or drop it`),
        );
      }
    }

    if (adr.review_by && daysSince(adr.review_by, now) > 0) {
      overdueReview.push(
        finding(adr, `review_by ${adr.review_by} has passed (${daysSince(adr.review_by, now)} days ago)`),
      );
    }

    if (adr.status === "superseded" && !adr.superseded_by) {
      brokenChains.push(finding(adr, "status superseded but no superseded_by — the successor is unrecorded"));
    }
    if (adr.superseded_by && adr.status !== "superseded") {
      brokenChains.push(
        finding(adr, `superseded_by "${adr.superseded_by}" but status is "${adr.status}"`),
      );
    }
    for (const old of adr.supersedes ?? []) {
      if (old.includes(":")) continue;
      const target = model.adrs.get(old);
      if (!target) {
        brokenChains.push(finding(adr, `supersedes "${old}", which does not exist`));
      } else if (target.superseded_by !== id) {
        brokenChains.push(
          finding(
            adr,
            `supersedes "${old}", but ${old} does not point back (superseded_by is ${
              target.superseded_by ?? "unset"
            })`,
          ),
        );
      }
    }
  }

  const linkGaps = findLinkGaps(model);

  return {
    total: model.adrs.size,
    byStatus,
    unlinked,
    stalledProposals,
    overdueReview,
    linkGaps,
    brokenChains,
    clean:
      unlinked.length === 0 &&
      stalledProposals.length === 0 &&
      overdueReview.length === 0 &&
      linkGaps.length === 0 &&
      brokenChains.length === 0,
  };
}
