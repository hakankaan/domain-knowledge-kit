/**
 * "Which decisions govern this?" — the ADR-first lookup.
 *
 * Answering that used to mean composing three calls (search for the
 * item, traverse for ADR neighbours, show each one) and then working
 * out by hand which of the results were still in effect. The pieces
 * were all there; the question wasn't.
 *
 * Two things this adds beyond a graph walk:
 *
 *  - **Provenance.** Each hit records *how* the decision reaches the
 *    subject — the item names it, the ADR names the item, the context
 *    it lives in is governed, or the ADR binds the file by glob. A
 *    context-level decision is real but weaker evidence than a direct
 *    link, and the caller should be able to tell them apart.
 *  - **Chain resolution.** A superseded ADR is the wrong answer to
 *    "what applies now?", so each one carries the head of its
 *    supersession chain and the binding set is computed after
 *    following it.
 */
import type { AdrRecord, DomainModel } from "../../shared/types/domain.js";
import { forEachItem, itemAdrRefs } from "../../shared/item-visitor.js";
import { ACTIVE_STATUSES, type AdrStatusName } from "./status.js";

/** How a decision was connected to the subject. */
export type DecisionVia =
  /** The subject's own `adr_refs` names it. */
  | "adr_refs"
  /** The ADR's `domain_refs` names the subject. */
  | "domain_refs"
  /** It governs the context the subject lives in. */
  | "context"
  /** Its `code_refs` glob matches the queried file. */
  | "code_refs";

/** Ranking used when the same ADR is reached more than one way. */
const VIA_PRECEDENCE: Record<DecisionVia, number> = {
  code_refs: 0,
  adr_refs: 1,
  domain_refs: 2,
  context: 3,
};

/** One decision that bears on the subject. */
export interface DecisionHit {
  id: string;
  title: string;
  status: string;
  date: string;
  /** Every route by which this decision reaches the subject. */
  via: DecisionVia[];
  /** Direct successor, when this ADR has been superseded. */
  supersededBy?: string;
  /**
   * Head of the supersession chain — the decision that actually
   * applies today. Absent when this ADR is itself the head.
   */
  currentId?: string;
}

/** Everything the lookup found. */
export interface DecisionsReport {
  /** What was asked about, echoed back. */
  subject: string;
  /** Owning context, when one could be determined. */
  context?: string;
  /** All decisions found, most direct provenance first. */
  decisions: DecisionHit[];
  /** Ids in effect right now (accepted, after chain resolution). */
  binding: string[];
  /** Ids kept as history: rejected, deprecated, or superseded. */
  retired: string[];
  /**
   * False when `subject` names nothing in the model. The report is
   * still returned — context-level decisions are real answers — but a
   * typo would otherwise look like a confident result.
   */
  subjectExists?: boolean;
  /** Guidance when the answer is empty or the subject is unknown. */
  note?: string;
}

/** Does this id name anything in the model? */
function subjectResolves(model: DomainModel, subject: string): boolean {
  if (subject.startsWith("actor.")) {
    return model.actors.some((a) => a.name === subject.slice("actor.".length));
  }
  if (subject.startsWith("flow.")) {
    return (model.index.flows ?? []).some((f) => f.name === subject.slice("flow.".length));
  }
  if (subject.startsWith("context.")) {
    return model.contexts.has(subject.slice("context.".length));
  }
  const dot = subject.indexOf(".");
  if (dot <= 0) return false;
  const ctx = model.contexts.get(subject.slice(0, dot));
  if (!ctx) return false;
  const itemName = subject.slice(dot + 1);
  let found = false;
  forEachItem(ctx, (_type, name) => {
    if (name === itemName) found = true;
  });
  return found;
}

/**
 * Follow `superseded_by` to the decision that replaced this one.
 *
 * Returns `undefined` when the ADR is already the head. Cycles and
 * dangling links stop the walk rather than hanging — the validator
 * reports both as findings.
 */
export function resolveCurrent(
  model: DomainModel,
  id: string,
): string | undefined {
  const seen = new Set<string>([id]);
  let cursor = model.adrs.get(id);
  let head: string | undefined;

  while (cursor?.superseded_by) {
    const next = cursor.superseded_by;
    if (seen.has(next)) break;
    seen.add(next);
    head = next;
    cursor = model.adrs.get(next);
    if (!cursor) break;
  }

  return head;
}

/** Accumulator that merges repeat hits instead of duplicating them. */
class HitSet {
  private readonly hits = new Map<string, Set<DecisionVia>>();

  add(id: string, via: DecisionVia): void {
    const set = this.hits.get(id) ?? new Set<DecisionVia>();
    set.add(via);
    this.hits.set(id, set);
  }

  build(model: DomainModel): DecisionHit[] {
    const out: DecisionHit[] = [];
    for (const [id, viaSet] of this.hits) {
      const adr = model.adrs.get(id);
      if (!adr) continue; // unresolved ref — the validator reports it
      const via = [...viaSet].sort((a, b) => VIA_PRECEDENCE[a] - VIA_PRECEDENCE[b]);
      const current = resolveCurrent(model, id);
      out.push({
        id,
        title: adr.title,
        status: adr.status,
        date: adr.date,
        via,
        ...(adr.superseded_by ? { supersededBy: adr.superseded_by } : {}),
        ...(current ? { currentId: current } : {}),
      });
    }
    return out.sort(
      (a, b) =>
        VIA_PRECEDENCE[a.via[0]] - VIA_PRECEDENCE[b.via[0]] || a.id.localeCompare(b.id),
    );
  }
}

/** Which context an id belongs to, when the id carries one. */
function contextOf(id: string): string | undefined {
  if (id.startsWith("actor.") || id.startsWith("flow.")) return undefined;
  if (id.startsWith("context.")) return id.slice("context.".length);
  const dot = id.indexOf(".");
  return dot > 0 ? id.slice(0, dot) : undefined;
}

/** Options for {@link collectDecisions}. */
export interface CollectDecisionsOptions {
  /**
   * ADR ids bound to a queried file by their own `code_refs`, plus the
   * context that file belongs to. Supplied by the caller because
   * resolving a path is the drift slice's job, not this one's.
   */
  fileBinding?: { context?: string | null; adrs?: string[] };
  /**
   * Include decisions that govern the subject's context. On by default
   * — a context-level decision does constrain everything inside it.
   */
  includeContext?: boolean;
}

/**
 * Collect every decision bearing on one subject.
 *
 * `subject` is a domain id (`ordering.Order`, `actor.Customer`,
 * `flow.Checkout`, `context.ordering`) or, when `fileBinding` is
 * supplied, a source path the caller has already resolved.
 */
export function collectDecisions(
  model: DomainModel,
  subject: string,
  options: CollectDecisionsOptions = {},
): DecisionsReport {
  const hits = new HitSet();
  // A path is not an id: when the subject is a file, the owning context
  // is whatever the caller resolved, or nothing. Falling back to
  // `contextOf` here would split "src/ordering/writer.ts" on its first
  // dot and report a context named "src/ordering/writer".
  const ctxName = options.fileBinding
    ? (options.fileBinding.context ?? undefined)
    : contextOf(subject);

  for (const id of options.fileBinding?.adrs ?? []) hits.add(id, "code_refs");

  // ── The subject's own adr_refs ────────────────────────────────────
  if (!options.fileBinding) {
    if (subject.startsWith("actor.")) {
      const actor = model.actors.find((a) => a.name === subject.slice("actor.".length));
      for (const ref of actor?.adr_refs ?? []) hits.add(ref, "adr_refs");
    } else if (subject.startsWith("flow.")) {
      const flow = (model.index.flows ?? []).find(
        (f) => f.name === subject.slice("flow.".length),
      );
      for (const ref of flow?.adr_refs ?? []) hits.add(ref, "adr_refs");
    } else if (subject.startsWith("context.")) {
      const ctx = model.contexts.get(subject.slice("context.".length));
      for (const ref of ctx?.adr_refs ?? []) hits.add(ref, "adr_refs");
      // A context's decisions include everything its items cite.
      if (ctx) {
        forEachItem(ctx, (_type, _name, item) => {
          for (const ref of itemAdrRefs(item) ?? []) hits.add(ref, "domain_refs");
        });
      }
    } else if (ctxName) {
      const ctx = model.contexts.get(ctxName);
      const itemName = subject.slice(ctxName.length + 1);
      if (ctx) {
        forEachItem(ctx, (_type, name, item) => {
          if (name !== itemName) return;
          for (const ref of itemAdrRefs(item) ?? []) hits.add(ref, "adr_refs");
        });
      }
    }
  }

  // ── ADRs naming the subject in domain_refs ────────────────────────
  for (const [id, adr] of model.adrs) {
    if ((adr.domain_refs ?? []).includes(subject)) hits.add(id, "domain_refs");
  }

  // ── Decisions governing the whole context ─────────────────────────
  if (options.includeContext !== false && ctxName && subject !== `context.${ctxName}`) {
    const ctx = model.contexts.get(ctxName);
    for (const ref of ctx?.adr_refs ?? []) hits.add(ref, "context");
    for (const [id, adr] of model.adrs) {
      if ((adr.domain_refs ?? []).includes(`context.${ctxName}`)) hits.add(id, "context");
    }
  }

  const decisions = hits.build(model);

  // Binding = in effect after following supersession. A superseded ADR
  // never binds; its successor does, whether or not the successor was
  // itself linked to the subject.
  const binding = new Set<string>();
  const retired: string[] = [];
  for (const hit of decisions) {
    const effective = hit.currentId ?? hit.id;
    const adr: AdrRecord | undefined = model.adrs.get(effective);
    if (adr && ACTIVE_STATUSES.includes(adr.status as AdrStatusName)) binding.add(effective);
    if (hit.id !== effective || !ACTIVE_STATUSES.includes(hit.status as AdrStatusName)) {
      retired.push(hit.id);
    }
  }

  const report: DecisionsReport = {
    subject,
    decisions,
    binding: [...binding].sort(),
    retired: retired.sort(),
  };
  if (ctxName) report.context = ctxName;

  // A path query is answered from globs, not from the model's id
  // space, so existence is not a meaningful question for it.
  if (!options.fileBinding) {
    const exists = subjectResolves(model, subject);
    report.subjectExists = exists;
    if (!exists) {
      report.note = `"${subject}" does not resolve to any item, context, actor, or flow in the model — check the id. Any decisions listed reach it only through the context named in the id.`;
    }
  }

  if (decisions.length === 0 && !report.note) {
    report.note =
      model.adrs.size === 0
        ? 'No ADRs exist in this pack yet. Record one with `dkk new adr "<title>"`.'
        : "No decision is linked to this subject. Link one with `dkk adr link <adr-id> <id>`, or search the decision log with dkk_search type=adr.";
  }
  return report;
}
