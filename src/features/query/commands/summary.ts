/**
 * `domain summary <id>` command — concise overview of an item.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import { DomainGraph } from "../../../shared/graph.js";
import type { DomainModel } from "../../../shared/types/domain.js";

/** Resolve a plain description string for any domain item ID. */
function resolveDescription(model: DomainModel, id: string): string | undefined {
  if (id.startsWith("actor.")) {
    const name = id.slice("actor.".length);
    return model.actors.find((a) => a.name === name)?.description;
  }
  if (id.startsWith("adr-")) {
    const adr = model.adrs.get(id);
    return adr ? `${adr.status} — ${adr.date}` : undefined;
  }
  if (id.startsWith("flow.")) {
    const name = id.slice("flow.".length);
    return (model.index.flows ?? []).find((f) => f.name === name)
      ? `Flow with ${(model.index.flows ?? []).find((f) => f.name === name)!.steps.length} steps`
      : undefined;
  }
  if (id.startsWith("context.")) {
    const name = id.slice("context.".length);
    return model.contexts.get(name)?.description;
  }
  const dotIdx = id.indexOf(".");
  if (dotIdx > 0) {
    const ctxName = id.slice(0, dotIdx);
    const itemName = id.slice(dotIdx + 1);
    const ctx = model.contexts.get(ctxName);
    if (!ctx) return undefined;
    const candidates = [
      ...(ctx.events ?? []),
      ...(ctx.commands ?? []),
      ...(ctx.policies ?? []),
      ...(ctx.aggregates ?? []),
      ...(ctx.read_models ?? []),
    ] as Array<{ name: string; description?: string }>;
    return candidates.find((c) => c.name === itemName)?.description;
  }
  return undefined;
}

/** Register the `summary` subcommand. */
export function registerSummary(program: Cmd): void {
  program
    .command("summary <id>")
    .description("Show a concise summary of a domain item (useful for AI context)")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { json?: boolean; minify?: boolean; root?: string }) => {
      const model = loadDomainModel({ root: opts.root });
      const graph = DomainGraph.from(model);

      const node = graph.nodes.get(id);
      if (!node) {
        if (opts.json) {
          console.log(JSON.stringify({ error: `Item "${id}" not found` }, null, opts.minify ? 0 : 2));
        } else {
          console.error(`Error: Item "${id}" not found.`);
        }
        process.exit(1);
      }

      const description = resolveDescription(model, id);

      // Build related items with kind, name, and the connecting edge label
      const relatedIds = Array.from(graph.getRelated(id, 1));
      const nodeEdges = graph.edges.filter((e) => e.from === id || e.to === id);
      const related = relatedIds.map((relId) => {
        const relNode = graph.nodes.get(relId);
        const edge = nodeEdges.find((e) => (e.from === id && e.to === relId) || (e.from === relId && e.to === id));
        return {
          id: relId,
          kind: relNode?.kind,
          name: relNode?.name,
          label: edge?.label,
        };
      });

      if (opts.json) {
        const payload: Record<string, unknown> = {
          id: node.id,
          name: node.name,
          kind: node.kind,
          context: node.context,
        };
        if (description !== undefined) payload.description = description;
        payload.related = related;
        console.log(JSON.stringify(payload, null, opts.minify ? 0 : 2));
        return;
      }

      console.log(`\n# [${node.kind}] ${node.name}${node.context ? ` (Context: ${node.context})` : ""}\n`);
      if (description) console.log(`${description}\n`);
      console.log(`Related (${related.length}):`);
      for (const r of related) {
        console.log(`  - [${r.kind}] ${r.id}${r.label ? ` (${r.label})` : ""}`);
      }
      console.log();
    });
}
