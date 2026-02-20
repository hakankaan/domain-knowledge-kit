/**
 * `domain list` command — list domain items with optional filters.
 *
 * Displays a table of domain items filtered by bounded context
 * and/or item type.
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../core/loader.js";
import type { DomainContext, Actor } from "../types/domain.js";

/** A row in the list output table. */
interface ListRow {
  id: string;
  type: string;
  context: string;
  name: string;
  description: string;
}

/** Collect all domain items into flat rows. */
function collectRows(root?: string): ListRow[] {
  const model = loadDomainModel({ root });
  const rows: ListRow[] = [];

  // Actors
  for (const actor of model.actors) {
    rows.push({
      id: `actor.${actor.name}`,
      type: "actor",
      context: "",
      name: actor.name,
      description: actor.description,
    });
  }

  // Bounded contexts and their items
  for (const [ctxName, ctx] of model.contexts) {
    rows.push({
      id: `context.${ctxName}`,
      type: "context",
      context: ctxName,
      name: ctxName,
      description: ctx.description,
    });

    for (const e of ctx.events ?? []) {
      rows.push({
        id: `${ctxName}.${e.name}`,
        type: "event",
        context: ctxName,
        name: e.name,
        description: e.description,
      });
    }

    for (const c of ctx.commands ?? []) {
      rows.push({
        id: `${ctxName}.${c.name}`,
        type: "command",
        context: ctxName,
        name: c.name,
        description: c.description,
      });
    }

    for (const p of ctx.policies ?? []) {
      rows.push({
        id: `${ctxName}.${p.name}`,
        type: "policy",
        context: ctxName,
        name: p.name,
        description: p.description,
      });
    }

    for (const a of ctx.aggregates ?? []) {
      rows.push({
        id: `${ctxName}.${a.name}`,
        type: "aggregate",
        context: ctxName,
        name: a.name,
        description: a.description,
      });
    }

    for (const r of ctx.read_models ?? []) {
      rows.push({
        id: `${ctxName}.${r.name}`,
        type: "read_model",
        context: ctxName,
        name: r.name,
        description: r.description,
      });
    }

    for (const g of ctx.glossary ?? []) {
      rows.push({
        id: `${ctxName}.${g.term}`,
        type: "glossary",
        context: ctxName,
        name: g.term,
        description: g.definition,
      });
    }
  }

  // ADRs
  for (const [id, adr] of model.adrs) {
    rows.push({
      id,
      type: "adr",
      context: "",
      name: adr.title,
      description: `[${adr.status}] ${adr.date}`,
    });
  }

  // Flows
  for (const flow of model.index.flows ?? []) {
    rows.push({
      id: `flow.${flow.name}`,
      type: "flow",
      context: "",
      name: flow.name,
      description: flow.description ?? `${flow.steps.length} steps`,
    });
  }

  return rows;
}

/** Truncate a string to `max` characters, adding "…" if truncated. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Pad a string to exactly `width` characters. */
function pad(s: string, width: number): string {
  return s.padEnd(width);
}

/** Print rows as an aligned text table. */
function printTable(rows: ListRow[]): void {
  if (rows.length === 0) {
    console.log("No items found.");
    return;
  }

  const maxDesc = 60;
  const header = { id: "ID", type: "TYPE", context: "CONTEXT", name: "NAME", description: "DESCRIPTION" };
  const allRows = [header, ...rows.map((r) => ({ ...r, description: truncate(r.description, maxDesc) }))];

  const widths = {
    id: Math.max(...allRows.map((r) => r.id.length)),
    type: Math.max(...allRows.map((r) => r.type.length)),
    context: Math.max(...allRows.map((r) => r.context.length), 7),
    name: Math.max(...allRows.map((r) => r.name.length)),
    description: Math.max(...allRows.map((r) => r.description.length)),
  };

  for (const row of allRows) {
    const line = [
      pad(row.id, widths.id),
      pad(row.type, widths.type),
      pad(row.context, widths.context),
      pad(row.name, widths.name),
      row.description,
    ].join("  ");
    console.log(line);
  }
}

/** Register the `list` subcommand. */
export function registerList(program: Cmd): void {
  program
    .command("list")
    .description("List domain items with optional filters")
    .option("-c, --context <name>", "Filter by bounded context")
    .option("-t, --type <type>", "Filter by item type (event, command, policy, aggregate, read_model, glossary, actor, adr, flow, context)")
    .option("--json", "Output as JSON")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: { context?: string; type?: string; json?: boolean; root?: string }) => {
      let rows = collectRows(opts.root);

      if (opts.context) {
        const ctx = opts.context.toLowerCase();
        rows = rows.filter((r) => r.context.toLowerCase() === ctx);
      }
      if (opts.type) {
        const t = opts.type.toLowerCase();
        rows = rows.filter((r) => r.type.toLowerCase() === t);
      }

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      console.log(`\n${rows.length} item(s) found:\n`);
      printTable(rows);
      console.log();
    });
}
