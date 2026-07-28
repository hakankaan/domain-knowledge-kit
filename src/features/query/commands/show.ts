/**
 * `domain show <id>` command — display the full YAML for a domain item.
 *
 * Looks up an item by its composite ID (e.g. "ordering.OrderPlaced",
 * "actor.Customer", "adr-0001") and prints its full YAML representation.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import { stringifyYaml } from "../../../shared/yaml.js";
import { parseRef, type ParsedRef } from "../../../shared/refs.js";
import type { AdrRecord, DomainModel } from "../../../shared/types/domain.js";
import { adrFrontmatter } from "../../../shared/adr-parser.js";
import { adrView, renderAdrText } from "../../adr/present.js";

/** A resolved lookup: the raw item plus enough context to render it. */
export interface ResolvedItem {
  found: boolean;
  /**
   * Which id family matched. ADRs render differently from YAML items —
   * their body is Markdown, not a YAML field — so callers need to know.
   */
  kind?: ParsedRef["kind"];
  data?: unknown;
  label?: string;
}

/**
 * Resolve a parsed ref against a single DomainModel (local or peer).
 * Returns the raw item + a human-readable label, or `{ found: false }`.
 *
 * Service prefix on the parsed ref is intentionally ignored here —
 * callers route to the right model first, then invoke this helper.
 */
function resolveAgainst(
  model: DomainModel,
  parsed: ParsedRef,
  labelPrefix: string,
): ResolvedItem {
  switch (parsed.kind) {
    case "actor": {
      const actor = model.actors.find((a) => a.name === parsed.name);
      if (actor) return { found: true, kind: "actor", data: actor, label: `${labelPrefix}Actor: ${parsed.name}` };
      return { found: false };
    }
    case "adr": {
      const adr = model.adrs.get(parsed.id);
      if (adr) return { found: true, kind: "adr", data: adr, label: `${labelPrefix}ADR: ${adr.title}` };
      return { found: false };
    }
    case "flow": {
      const flow = (model.index.flows ?? []).find((f) => f.name === parsed.name);
      if (flow) return { found: true, kind: "flow", data: flow, label: `${labelPrefix}Flow: ${parsed.name}` };
      return { found: false };
    }
    case "context": {
      const ctx = model.contexts.get(parsed.name);
      if (ctx) return { found: true, kind: "context", data: ctx, label: `${labelPrefix}Context: ${parsed.name}` };
      return { found: false };
    }
    case "item": {
      // First try the explicit context; if the context is unknown but
      // the local repo has a service identity, treat the leading token
      // as a bare item name within one of its contexts. The bare-name
      // fallback supports the demo shorthand `dkk show ordering:OrderPlaced`
      // (where "ordering" is both the service AND the only exported
      // context, so the caller writes one identifier instead of
      // duplicating it as `ordering:ordering.OrderPlaced`).
      const tryContext = (ctxName: string, itemName: string) => {
        const ctx = model.contexts.get(ctxName);
        if (!ctx) return undefined;
        const event = (ctx.events ?? []).find((e) => e.name === itemName);
        if (event) return { data: event, kind: "Event", display: `${ctxName}.${itemName}` };
        const command = (ctx.commands ?? []).find((c) => c.name === itemName);
        if (command) return { data: command, kind: "Command", display: `${ctxName}.${itemName}` };
        const policy = (ctx.policies ?? []).find((p) => p.name === itemName);
        if (policy) return { data: policy, kind: "Policy", display: `${ctxName}.${itemName}` };
        const aggregate = (ctx.aggregates ?? []).find((a) => a.name === itemName);
        if (aggregate) return { data: aggregate, kind: "Aggregate", display: `${ctxName}.${itemName}` };
        const readModel = (ctx.read_models ?? []).find((r) => r.name === itemName);
        if (readModel) return { data: readModel, kind: "Read Model", display: `${ctxName}.${itemName}` };
        const glossary = (ctx.glossary ?? []).find((g) => g.term === itemName);
        if (glossary) return { data: glossary, kind: "Glossary", display: `${ctxName}.${itemName}` };
        return undefined;
      };

      const direct = tryContext(parsed.context, parsed.name);
      if (direct) {
        return { found: true, kind: "item", data: direct.data, label: `${labelPrefix}${direct.kind}: ${direct.display}` };
      }
      return { found: false };
    }
  }
}

/**
 * Resolve an item by its composite ID and return the raw object
 * suitable for YAML serialisation.
 *
 * Supports the federated grammar `<service>:<id>` — when the service
 * prefix matches `model.service?.name` (or is absent) the lookup
 * happens against the local model; when it names a peer, the lookup
 * happens against `model.peers.get(<service>)`.
 */
export function resolveItem(model: DomainModel, id: string): ResolvedItem {
  const parsed = parseRef(id);

  if (parsed) {
    // Route to peer model when the prefix names a different service.
    const target =
      parsed.service && parsed.service !== model.service?.name
        ? model.peers?.get(parsed.service)
        : model;
    if (!target) {
      return { found: false };
    }
    const labelPrefix =
      parsed.service && parsed.service !== model.service?.name
        ? `[peer: ${parsed.service}] `
        : "";
    const result = resolveAgainst(target, parsed, labelPrefix);
    if (result.found) return result;
  }

  // Fallback for the `<service>:<ItemName>` shorthand (no context),
  // used by demo flows like `dkk show ordering:OrderPlaced` where the
  // service publishes a single context of the same name.
  const colonIdx = id.indexOf(":");
  if (colonIdx > 0) {
    const service = id.slice(0, colonIdx);
    const bareName = id.slice(colonIdx + 1);
    if (/^[a-z][a-z0-9-]*$/.test(service) && /^[A-Za-z][A-Za-z0-9]*$/.test(bareName)) {
      const target =
        service === model.service?.name ? model : model.peers?.get(service);
      const targetService = target?.service;
      if (target && targetService) {
        // Try each exported context until one resolves the item.
        for (const ctxName of targetService.exports) {
          const synthetic: ParsedRef = { kind: "item", context: ctxName, name: bareName };
          const labelPrefix = target === model ? "" : `[peer: ${service}] `;
          const r = resolveAgainst(target, synthetic, labelPrefix);
          if (r.found) return r;
        }
      }
    }
  }

  return { found: false };
}

/** Register the `show` subcommand. */
export function registerShow(program: Cmd): void {
  program
    .command("show <id>")
    .description("Show the full definition of a domain item by ID")
    .option(
      "--section <name>",
      "ADRs only: show just one section of the body (e.g. decision, consequences, alternatives)",
    )
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { section?: string; json?: boolean; minify?: boolean; root?: string }) => {
      const model = loadDomainModel({ root: opts.root });
      const result = resolveItem(model, id);

      const fail = (message: string): never => {
        if (opts.json) {
          console.log(JSON.stringify({ error: message }, null, opts.minify ? 0 : 2));
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      };

      if (!result.found || !result.data) fail(`Item "${id}" not found.`);

      if (result.kind === "adr") {
        const adr = result.data as AdrRecord;
        const view = adrView(adr, opts.section);
        if (!view.ok) {
          fail(view.message);
          return;
        }
        const v = view.view;

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                id,
                label: result.label,
                // The Markdown body stays Markdown, and `sections`
                // lets a caller ask for one part next time instead of
                // paying for the whole document.
                data: opts.section ? { ...adrFrontmatter(adr), section: v.section, body: v.body } : adr,
                sections: v.availableSections,
              },
              null,
              opts.minify ? 0 : 2,
            ),
          );
          return;
        }

        console.log(`\n${renderAdrText(adr, v)}\n`);
        return;
      }

      if (opts.section) {
        fail(`--section applies to ADRs only; "${id}" is not an ADR.`);
      }

      if (opts.json) {
        console.log(JSON.stringify({ id, label: result.label, data: result.data }, null, opts.minify ? 0 : 2));
        return;
      }

      console.log(`\n# ${result.label}\n`);
      console.log(stringifyYaml(result.data));
    });
}
