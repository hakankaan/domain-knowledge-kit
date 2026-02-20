/**
 * `domain show <id>` command — display the full YAML for a domain item.
 *
 * Looks up an item by its composite ID (e.g. "ordering.OrderPlaced",
 * "actor.Customer", "adr-0001") and prints its full YAML representation.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../core/loader.js";
import { stringifyYaml } from "../utils/yaml.js";
import type { DomainModel } from "../types/domain.js";

/**
 * Resolve an item by its composite ID and return the raw object
 * suitable for YAML serialisation.
 */
function resolveItem(model: DomainModel, id: string): { found: boolean; data?: unknown; label?: string } {
  // Actor: "actor.<Name>"
  if (id.startsWith("actor.")) {
    const name = id.slice("actor.".length);
    const actor = model.actors.find((a) => a.name === name);
    if (actor) return { found: true, data: actor, label: `Actor: ${name}` };
    return { found: false };
  }

  // ADR: "adr-NNNN"
  if (id.startsWith("adr-")) {
    const adr = model.adrs.get(id);
    if (adr) return { found: true, data: adr, label: `ADR: ${adr.title}` };
    return { found: false };
  }

  // Flow: "flow.<Name>"
  if (id.startsWith("flow.")) {
    const name = id.slice("flow.".length);
    const flow = (model.index.flows ?? []).find((f) => f.name === name);
    if (flow) return { found: true, data: flow, label: `Flow: ${name}` };
    return { found: false };
  }

  // Context: "context.<Name>"
  if (id.startsWith("context.")) {
    const name = id.slice("context.".length);
    const ctx = model.contexts.get(name);
    if (ctx) return { found: true, data: ctx, label: `Context: ${name}` };
    return { found: false };
  }

  // Context-scoped item: "<context>.<Name>"
  const dotIdx = id.indexOf(".");
  if (dotIdx > 0) {
    const ctxName = id.slice(0, dotIdx);
    const itemName = id.slice(dotIdx + 1);
    const ctx = model.contexts.get(ctxName);
    if (!ctx) return { found: false };

    // Search across all item types
    const event = (ctx.events ?? []).find((e) => e.name === itemName);
    if (event) return { found: true, data: event, label: `Event: ${ctxName}.${itemName}` };

    const command = (ctx.commands ?? []).find((c) => c.name === itemName);
    if (command) return { found: true, data: command, label: `Command: ${ctxName}.${itemName}` };

    const policy = (ctx.policies ?? []).find((p) => p.name === itemName);
    if (policy) return { found: true, data: policy, label: `Policy: ${ctxName}.${itemName}` };

    const aggregate = (ctx.aggregates ?? []).find((a) => a.name === itemName);
    if (aggregate) return { found: true, data: aggregate, label: `Aggregate: ${ctxName}.${itemName}` };

    const readModel = (ctx.read_models ?? []).find((r) => r.name === itemName);
    if (readModel) return { found: true, data: readModel, label: `Read Model: ${ctxName}.${itemName}` };

    const glossary = (ctx.glossary ?? []).find((g) => g.term === itemName);
    if (glossary) return { found: true, data: glossary, label: `Glossary: ${ctxName}.${itemName}` };
  }

  return { found: false };
}

/** Register the `show` subcommand. */
export function registerShow(program: Cmd): void {
  program
    .command("show <id>")
    .description("Show full YAML for a domain item by ID (e.g. ordering.OrderPlaced, actor.Customer, adr-0001)")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { root?: string }) => {
      const model = loadDomainModel({ root: opts.root });
      const result = resolveItem(model, id);

      if (!result.found || !result.data) {
        console.error(`Error: Item "${id}" not found.`);
        process.exit(1);
      }

      console.log(`\n# ${result.label}\n`);
      console.log(stringifyYaml(result.data));
    });
}
