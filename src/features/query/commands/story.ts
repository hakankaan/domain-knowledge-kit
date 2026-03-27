/**
 * `dkk story <flow-id>` command — aggregate a flow's full domain context
 * into a story-ready output for AI-assisted user story generation.
 *
 * Walks the ordered steps of a flow, resolves each referenced item from
 * the domain model, and collects actors, policies, BDD examples, ADRs,
 * and downstream effects into a single structured document.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import { DomainGraph } from "../../../shared/graph.js";
import type {
  DomainModel,
  Flow,
  Policy,
  ReadModel,
  Actor,
  AdrRecord,
  Example,
  Field,
} from "../../../shared/types/domain.js";

// ── Types ─────────────────────────────────────────────────────────────

interface ResolvedStep {
  ref: string;
  type: string;
  note?: string;
  name: string;
  description: string;
  actor?: string;
  handled_by?: string;
  raised_by?: string;
  fields?: Field[];
  preconditions?: string[];
  rejections?: string[];
  invariants?: string[];
  examples?: Example[];
  when?: { events?: string[] };
  then?: { commands?: string[] };
  subscribes_to?: string[];
  used_by?: string[];
}

interface StoryContext {
  flow: { name: string; description?: string; stepCount: number };
  actors: Array<{ name: string; type: string; description: string }>;
  steps: ResolvedStep[];
  policies: Array<{ id: string; name: string; when?: { events?: string[] }; then?: { commands?: string[] } }>;
  examples: Array<{ source: string; example: Example }>;
  adrs: Array<{ id: string; title: string; status: string }>;
  downstreamReadModels: Array<{ id: string; name: string; subscribes_to?: string[]; used_by?: string[] }>;
}

// ── Resolution helpers ────────────────────────────────────────────────

function resolveStep(model: DomainModel, ref: string, type: string): Omit<ResolvedStep, "ref" | "type" | "note"> | null {
  const dotIdx = ref.indexOf(".");
  if (dotIdx < 0) return null;

  const ctxName = ref.slice(0, dotIdx);
  const itemName = ref.slice(dotIdx + 1);
  const ctx = model.contexts.get(ctxName);
  if (!ctx) return null;

  switch (type) {
    case "command": {
      const cmd = (ctx.commands ?? []).find((c) => c.name === itemName);
      if (!cmd) return null;
      return {
        name: cmd.name,
        description: cmd.description,
        actor: cmd.actor,
        handled_by: cmd.handled_by,
        fields: cmd.fields,
        preconditions: cmd.preconditions,
        rejections: cmd.rejections,
        invariants: cmd.invariants,
        examples: cmd.examples,
      };
    }
    case "event": {
      const evt = (ctx.events ?? []).find((e) => e.name === itemName);
      if (!evt) return null;
      return {
        name: evt.name,
        description: evt.description,
        raised_by: evt.raised_by,
        fields: evt.fields,
        invariants: evt.invariants,
        examples: evt.examples,
      };
    }
    case "policy": {
      const pol = (ctx.policies ?? []).find((p) => p.name === itemName);
      if (!pol) return null;
      return {
        name: pol.name,
        description: pol.description,
        when: pol.when,
        then: pol.then,
      };
    }
    case "read_model": {
      const rm = (ctx.read_models ?? []).find((r) => r.name === itemName);
      if (!rm) return null;
      return {
        name: rm.name,
        description: rm.description,
        subscribes_to: rm.subscribes_to,
        used_by: rm.used_by,
      };
    }
    default:
      return null;
  }
}

/**
 * Build the full story context for a given flow by resolving all steps
 * and collecting secondary relationships through the domain model.
 */
function buildStoryContext(model: DomainModel, graph: DomainGraph, flow: Flow): StoryContext {
  const resolvedSteps: ResolvedStep[] = [];
  const actorMap = new Map<string, Actor>();
  const policyMap = new Map<string, { id: string; name: string; when?: { events?: string[] }; then?: { commands?: string[] } }>();
  const adrMap = new Map<string, AdrRecord>();
  const readModelMap = new Map<string, { id: string; name: string; subscribes_to?: string[]; used_by?: string[] }>();
  const allExamples: Array<{ source: string; example: Example }> = [];

  for (const step of flow.steps) {
    const resolved = resolveStep(model, step.ref, step.type);
    if (!resolved) {
      resolvedSteps.push({ ref: step.ref, type: step.type, note: step.note, name: step.ref, description: "(unresolved)" });
      continue;
    }

    resolvedSteps.push({ ref: step.ref, type: step.type, note: step.note, ...resolved });

    // Collect actors from commands
    if (step.type === "command" && resolved.actor) {
      const actor = model.actors.find((a) => a.name === resolved.actor);
      if (actor) actorMap.set(actor.name, actor);
    }

    // Collect BDD examples from commands and events
    if (resolved.examples) {
      for (const ex of resolved.examples) {
        allExamples.push({ source: step.ref, example: ex });
      }
    }

    // Collect ADRs from item adr_refs
    const dotIdx = step.ref.indexOf(".");
    if (dotIdx > 0) {
      const ctxName = step.ref.slice(0, dotIdx);
      const itemName = step.ref.slice(dotIdx + 1);
      const ctx = model.contexts.get(ctxName);
      if (ctx) {
        const allItems = [
          ...(ctx.commands ?? []),
          ...(ctx.events ?? []),
          ...(ctx.policies ?? []),
          ...(ctx.aggregates ?? []),
          ...(ctx.read_models ?? []),
        ] as Array<{ name: string; adr_refs?: string[] }>;
        const item = allItems.find((i) => i.name === itemName);
        if (item?.adr_refs) {
          for (const adrRef of item.adr_refs) {
            const adr = model.adrs.get(adrRef);
            if (adr) adrMap.set(adrRef, adr);
          }
        }
      }
    }

    // For event steps, discover triggered policies and subscribing read models
    // via graph neighbor traversal
    if (step.type === "event") {
      const neighbors = graph.getNeighbours(step.ref);
      for (const neighborId of neighbors) {
        const node = graph.nodes.get(neighborId);
        if (!node) continue;

        if (node.kind === "policy") {
          // Resolve the policy item for when/then data
          const pdotIdx = neighborId.indexOf(".");
          if (pdotIdx > 0) {
            const pCtxName = neighborId.slice(0, pdotIdx);
            const pItemName = neighborId.slice(pdotIdx + 1);
            const pCtx = model.contexts.get(pCtxName);
            const pol = pCtx ? (pCtx.policies ?? []).find((p: Policy) => p.name === pItemName) : undefined;
            if (pol) {
              policyMap.set(neighborId, { id: neighborId, name: pol.name, when: pol.when, then: pol.then });
              // Also collect ADRs from the policy
              if (pol.adr_refs) {
                for (const adrRef of pol.adr_refs) {
                  const adr = model.adrs.get(adrRef);
                  if (adr) adrMap.set(adrRef, adr);
                }
              }
            }
          }
        }

        if (node.kind === "read_model") {
          const rmdotIdx = neighborId.indexOf(".");
          if (rmdotIdx > 0) {
            const rmCtxName = neighborId.slice(0, rmdotIdx);
            const rmItemName = neighborId.slice(rmdotIdx + 1);
            const rmCtx = model.contexts.get(rmCtxName);
            const rm = rmCtx ? (rmCtx.read_models ?? []).find((r: ReadModel) => r.name === rmItemName) : undefined;
            if (rm) {
              readModelMap.set(neighborId, { id: neighborId, name: rm.name, subscribes_to: rm.subscribes_to, used_by: rm.used_by });
            }
          }
        }
      }
    }
  }

  // Also collect actor ADRs
  for (const actor of actorMap.values()) {
    if (actor.adr_refs) {
      for (const adrRef of actor.adr_refs) {
        const adr = model.adrs.get(adrRef);
        if (adr) adrMap.set(adrRef, adr);
      }
    }
  }

  return {
    flow: { name: flow.name, description: flow.description, stepCount: flow.steps.length },
    actors: Array.from(actorMap.values()).map((a) => ({ name: a.name, type: a.type, description: a.description })),
    steps: resolvedSteps,
    policies: Array.from(policyMap.values()),
    examples: allExamples,
    adrs: Array.from(adrMap.values()).map((a) => ({ id: a.id, title: a.title, status: a.status })),
    downstreamReadModels: Array.from(readModelMap.values()),
  };
}

// ── Markdown renderer ─────────────────────────────────────────────────

function renderMarkdown(ctx: StoryContext): string {
  const lines: string[] = [];

  lines.push(`# Flow: ${ctx.flow.name}\n`);
  if (ctx.flow.description) {
    lines.push(`${ctx.flow.description}\n`);
  }

  // ── Actors ──
  if (ctx.actors.length > 0) {
    lines.push(`## Actors\n`);
    for (const a of ctx.actors) {
      lines.push(`- **${a.name}** (${a.type}): ${a.description}`);
    }
    lines.push("");
  }

  // ── Steps ──
  lines.push(`## Steps\n`);
  for (let i = 0; i < ctx.steps.length; i++) {
    const s = ctx.steps[i];
    lines.push(`### ${i + 1}. [${s.type}] ${s.ref}`);
    lines.push(s.description);
    if (s.note) lines.push(`> ${s.note}`);
    if (s.actor) lines.push(`- **Actor:** ${s.actor}`);
    if (s.handled_by) lines.push(`- **Handled by:** ${s.handled_by} (aggregate)`);
    if (s.raised_by) lines.push(`- **Raised by:** ${s.raised_by} (aggregate)`);
    if (s.fields && s.fields.length > 0) {
      const fieldList = s.fields.map((f) => `${f.name} (${f.type})`).join(", ");
      lines.push(`- **Fields:** ${fieldList}`);
    }
    if (s.preconditions && s.preconditions.length > 0) {
      lines.push(`- **Preconditions:**`);
      for (const p of s.preconditions) lines.push(`  - ${p}`);
    }
    if (s.rejections && s.rejections.length > 0) {
      lines.push(`- **Rejections:**`);
      for (const r of s.rejections) lines.push(`  - ${r}`);
    }
    if (s.invariants && s.invariants.length > 0) {
      lines.push(`- **Invariants:**`);
      for (const inv of s.invariants) lines.push(`  - ${inv}`);
    }
    if (s.when || s.then) {
      if (s.when?.events?.length) lines.push(`- **When:** ${s.when.events.join(", ")}`);
      if (s.then?.commands?.length) lines.push(`- **Then:** ${s.then.commands.join(", ")}`);
    }
    if (s.subscribes_to && s.subscribes_to.length > 0) {
      lines.push(`- **Subscribes to:** ${s.subscribes_to.join(", ")}`);
    }
    if (s.used_by && s.used_by.length > 0) {
      lines.push(`- **Used by:** ${s.used_by.join(", ")}`);
    }
    lines.push("");
  }

  // ── Policies triggered by events in this flow ──
  if (ctx.policies.length > 0) {
    lines.push(`## Policies (triggered by events in this flow)\n`);
    for (const p of ctx.policies) {
      const whenStr = p.when?.events?.join(", ") ?? "—";
      const thenStr = p.then?.commands?.join(", ") ?? "—";
      lines.push(`- **${p.name}** (${p.id}): When [${whenStr}] → Then [${thenStr}]`);
    }
    lines.push("");
  }

  // ── BDD Examples from domain model ──
  if (ctx.examples.length > 0) {
    lines.push(`## BDD Examples (from domain model)\n`);
    for (const { source, example } of ctx.examples) {
      lines.push(`### ${example.description} (${source})`);
      if (example.given && example.given.length > 0) {
        lines.push(`- **Given:**`);
        for (const g of example.given) lines.push(`  - ${g}`);
      }
      if (example.when && example.when.length > 0) {
        lines.push(`- **When:**`);
        for (const w of example.when) lines.push(`  - ${w}`);
      }
      if (example.then && example.then.length > 0) {
        lines.push(`- **Then:**`);
        for (const t of example.then) lines.push(`  - ${t}`);
      }
      lines.push("");
    }
  }

  // ── Architectural Constraints ──
  if (ctx.adrs.length > 0) {
    lines.push(`## Architectural Constraints\n`);
    for (const adr of ctx.adrs) {
      lines.push(`- **${adr.id}**: ${adr.title} [${adr.status}]`);
    }
    lines.push("");
  }

  // ── Downstream Effects ──
  if (ctx.downstreamReadModels.length > 0) {
    lines.push(`## Downstream Effects\n`);
    for (const rm of ctx.downstreamReadModels) {
      const subStr = rm.subscribes_to?.join(", ") ?? "—";
      const usedByStr = rm.used_by?.join(", ") ?? "—";
      lines.push(`- **Read Model ${rm.name}** (${rm.id}): subscribes to [${subStr}], used by [${usedByStr}]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Registration ──────────────────────────────────────────────────────

/** Register the `story` subcommand. */
export function registerStory(program: Cmd): void {
  program
    .command("story <flow-id>")
    .description(
      "Aggregate a flow's full domain context (actors, steps, policies, BDD examples, ADRs, downstream effects) for AI-assisted user story generation",
    )
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action((flowId: string, opts: { json?: boolean; minify?: boolean; root?: string }) => {
      const model = loadDomainModel({ root: opts.root });
      const graph = DomainGraph.from(model);

      // Accept both "flow.Name" and bare "Name"
      const normalizedId = flowId.startsWith("flow.") ? flowId : `flow.${flowId}`;
      const flowName = normalizedId.slice("flow.".length);
      const flow = (model.index.flows ?? []).find((f: Flow) => f.name === flowName);

      if (!flow) {
        const available = (model.index.flows ?? []).map((f: Flow) => `flow.${f.name}`);
        const hint = available.length > 0 ? ` Available flows: ${available.join(", ")}` : " No flows are defined in this domain model.";
        if (opts.json) {
          console.log(JSON.stringify({ error: `Flow "${normalizedId}" not found.${hint}` }, null, opts.minify ? 0 : 2));
        } else {
          console.error(`Error: Flow "${normalizedId}" not found.${hint}`);
        }
        process.exit(1);
      }

      const ctx = buildStoryContext(model, graph, flow);

      if (opts.json) {
        console.log(JSON.stringify(ctx, null, opts.minify ? 0 : 2));
        return;
      }

      process.stdout.write(renderMarkdown(ctx));
    });
}
