/**
 * `dkk consumers <id>` — reverse lookup across federated peers.
 *
 * Given a local item id (e.g. `ordering.OrderPlaced`), walk every
 * loaded peer model and report references back to that item. This is
 * the producer-side answer to "who breaks if I rename this?".
 *
 * The walk inspects the ref-bearing fields that the validator already
 * understands: events.raised_by, commands.handled_by / actor,
 * aggregates.handles / emits, policies.when / then, read_models.subscribes_to
 * / used_by, ADR domain_refs / superseded_by, and flow step refs.
 *
 * Both fully-qualified peer refs (`<localService>:<ctx>.<Name>`) and
 * the same-service bare form (when a peer happens to have a local
 * service named the same as ours — rare) are matched.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import { parseRef } from "../../../shared/refs.js";
import type { DomainModel } from "../../../shared/types/domain.js";
// Side-effect import: registers the peer-hydration hook with the
// shared loader so `loadDomainModel` populates `model.peers`.
import "../loader.js";

interface ConsumerHit {
  /** Peer service that references the queried item. */
  service: string;
  /** Reference path describing where in the peer model the match was found. */
  source: string;
  /** The relation kind (e.g. "when.events", "subscribes_to", "domain_refs"). */
  relation: string;
  /** The raw ref string as written in the peer's YAML. */
  ref: string;
}

interface ConsumersOpts {
  root?: string;
  json?: boolean;
  minify?: boolean;
}

export function registerConsumers(program: Cmd): void {
  program
    .command("consumers <id>")
    .description("List peers that reference this local item (reverse lookup across federation)")
    .option("-r, --root <path>", "Override repository root")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .action((id: string, opts: ConsumersOpts) => {
      const model = loadDomainModel({ root: opts.root });
      const localService = model.service?.name;

      const hits = findConsumers(model, id, localService);

      if (opts.json) {
        console.log(
          JSON.stringify(
            { item: id, service: localService ?? null, consumers: hits },
            null,
            opts.minify ? 0 : 2,
          ),
        );
        return;
      }

      if (hits.length === 0) {
        console.log(`No peer consumers of "${id}" found in ${model.peers?.size ?? 0} federated peer(s).`);
        return;
      }

      console.log(`${hits.length} reference(s) to "${id}":`);
      for (const h of hits) {
        console.log(`  ${h.service}  ${h.source}  [${h.relation}]  → ${h.ref}`);
      }
    });
}

/**
 * Walk every loaded peer model and collect references back to the
 * queried item. Matches both the fully-qualified peer form
 * (`<localService>:<ctx>.<Name>`) and bare names — the latter handles
 * the case where a peer references the same item via shorthand
 * inside its own walk (uncommon, but possible).
 */
export function findConsumers(
  model: DomainModel,
  rawId: string,
  localService: string | undefined,
): ConsumerHit[] {
  const hits: ConsumerHit[] = [];
  if (!model.peers || model.peers.size === 0) return hits;

  const parsed = parseRef(rawId);
  if (!parsed) return hits;

  // The forms a peer might use to reference our local item:
  //  - Full federated: `<localService>:<ctx>.<Name>` (or `:<ItemName>` shorthand)
  //  - Bare: only valid when peer happens to share our service name (rare)
  // We pre-compute the candidate strings to match.
  const matches = new Set<string>();
  if (parsed.kind === "item") {
    if (localService) {
      matches.add(`${localService}:${parsed.context}.${parsed.name}`);
      matches.add(`${localService}:${parsed.name}`);
    }
    matches.add(`${parsed.context}.${parsed.name}`);
  } else if (parsed.kind === "adr") {
    if (localService) matches.add(`${localService}:${parsed.id}`);
    matches.add(parsed.id);
  } else if (parsed.kind === "actor") {
    if (localService) matches.add(`${localService}:actor.${parsed.name}`);
    matches.add(`actor.${parsed.name}`);
  }

  for (const [peerName, peerModel] of model.peers) {
    walkRefs(peerModel, peerName, (relation, source, ref) => {
      if (matches.has(ref)) {
        hits.push({ service: peerName, source, relation, ref });
      }
    });
  }

  return hits;
}

/**
 * Visit every ref-bearing field in a model, invoking `visit` with
 * (relation, source-path, raw-ref) per occurrence.
 *
 * Intentionally narrow — covers the validator's lookup sites so the
 * reverse view stays consistent with the forward view.
 */
function walkRefs(
  model: DomainModel,
  modelName: string,
  visit: (relation: string, source: string, ref: string) => void,
): void {
  for (const [ctxName, ctx] of model.contexts) {
    for (const e of ctx.events ?? []) {
      if (e.raised_by) visit("raised_by", `${modelName}:${ctxName}.${e.name}`, e.raised_by);
    }
    for (const c of ctx.commands ?? []) {
      if (c.handled_by) visit("handled_by", `${modelName}:${ctxName}.${c.name}`, c.handled_by);
      if (c.actor) visit("actor", `${modelName}:${ctxName}.${c.name}`, c.actor);
    }
    for (const a of ctx.aggregates ?? []) {
      for (const h of a.handles?.commands ?? []) visit("handles.commands", `${modelName}:${ctxName}.${a.name}`, h);
      for (const ev of a.emits?.events ?? []) visit("emits.events", `${modelName}:${ctxName}.${a.name}`, ev);
    }
    for (const p of ctx.policies ?? []) {
      for (const t of p.when?.events ?? []) visit("when.events", `${modelName}:${ctxName}.${p.name}`, t);
      for (const t of p.then?.commands ?? []) visit("then.commands", `${modelName}:${ctxName}.${p.name}`, t);
    }
    for (const r of ctx.read_models ?? []) {
      for (const s of r.subscribes_to ?? []) visit("subscribes_to", `${modelName}:${ctxName}.${r.name}`, s);
      for (const u of r.used_by ?? []) visit("used_by", `${modelName}:${ctxName}.${r.name}`, u);
    }
  }
  for (const [adrId, adr] of model.adrs) {
    for (const ref of adr.domain_refs ?? []) visit("domain_refs", `${modelName}:${adrId}`, ref);
    if (adr.superseded_by) visit("superseded_by", `${modelName}:${adrId}`, adr.superseded_by);
  }
  for (const flow of model.index.flows ?? []) {
    for (const step of flow.steps) {
      visit("flow.steps.ref", `${modelName}:flow.${flow.name}`, step.ref);
    }
  }
}
