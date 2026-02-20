/**
 * `domain adr related <id>` command — bidirectional domain-ADR links.
 *
 * For a given ADR or domain item, finds all linked items in the
 * opposite direction:
 *
 * - ADR → domain items that reference it (via adr_refs)
 * - Domain item → ADRs that reference it (via domain_refs) + ADRs
 *   listed in its own adr_refs
 */
import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../core/loader.js";
import type { AdrRef, DomainModel } from "../types/domain.js";

/** Collect domain item IDs that reference a specific ADR. */
function domainItemsReferencingAdr(model: DomainModel, adrId: AdrRef): string[] {
  const refs: string[] = [];

  // Actors
  for (const actor of model.actors) {
    if (actor.adr_refs?.includes(adrId)) {
      refs.push(`actor.${actor.name}`);
    }
  }

  // Context items
  for (const [ctxName, ctx] of model.contexts) {
    for (const e of ctx.events ?? []) {
      if (e.adr_refs?.includes(adrId)) refs.push(`${ctxName}.${e.name}`);
    }
    for (const c of ctx.commands ?? []) {
      if (c.adr_refs?.includes(adrId)) refs.push(`${ctxName}.${c.name}`);
    }
    for (const p of ctx.policies ?? []) {
      if (p.adr_refs?.includes(adrId)) refs.push(`${ctxName}.${p.name}`);
    }
    for (const a of ctx.aggregates ?? []) {
      if (a.adr_refs?.includes(adrId)) refs.push(`${ctxName}.${a.name}`);
    }
    for (const r of ctx.read_models ?? []) {
      if (r.adr_refs?.includes(adrId)) refs.push(`${ctxName}.${r.name}`);
    }
    for (const g of ctx.glossary ?? []) {
      if (g.adr_refs?.includes(adrId)) refs.push(`${ctxName}.${g.term}`);
    }
  }

  return refs.sort();
}

/** Collect ADR IDs that reference a specific domain item via domain_refs. */
function adrsReferencingItem(model: DomainModel, itemId: string): string[] {
  const refs: string[] = [];
  for (const [adrId, adr] of model.adrs) {
    if (adr.domain_refs?.includes(itemId as `${string}.${string}`)) {
      refs.push(adrId);
    }
  }
  return refs.sort();
}

/** Collect ADR IDs listed in a domain item's own adr_refs field. */
function ownAdrRefs(model: DomainModel, itemId: string): string[] {
  // Actor
  if (itemId.startsWith("actor.")) {
    const name = itemId.slice("actor.".length);
    const actor = model.actors.find((a) => a.name === name);
    return (actor?.adr_refs ?? []) as string[];
  }

  // Context-scoped item
  const dotIdx = itemId.indexOf(".");
  if (dotIdx > 0) {
    const ctxName = itemId.slice(0, dotIdx);
    const itemName = itemId.slice(dotIdx + 1);
    const ctx = model.contexts.get(ctxName);
    if (!ctx) return [];

    for (const e of ctx.events ?? []) if (e.name === itemName) return (e.adr_refs ?? []) as string[];
    for (const c of ctx.commands ?? []) if (c.name === itemName) return (c.adr_refs ?? []) as string[];
    for (const p of ctx.policies ?? []) if (p.name === itemName) return (p.adr_refs ?? []) as string[];
    for (const a of ctx.aggregates ?? []) if (a.name === itemName) return (a.adr_refs ?? []) as string[];
    for (const r of ctx.read_models ?? []) if (r.name === itemName) return (r.adr_refs ?? []) as string[];
    for (const g of ctx.glossary ?? []) if (g.term === itemName) return (g.adr_refs ?? []) as string[];
  }

  return [];
}

/** Register the `adr related` subcommand on an `adr` parent command. */
export function registerAdrRelated(adrCmd: Cmd): void {
  adrCmd
    .command("related <id>")
    .description("Show bidirectional domain-ADR links for an ADR or domain item")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { root?: string }) => {
      const model = loadDomainModel({ root: opts.root });

      const isAdr = id.startsWith("adr-");

      if (isAdr) {
        // ADR → domain items
        if (!model.adrs.has(id)) {
          console.error(`Error: ADR "${id}" not found.`);
          process.exit(1);
        }

        const adr = model.adrs.get(id)!;
        const domainRefs = (adr.domain_refs ?? []) as string[];
        const itemsReferencing = domainItemsReferencingAdr(model, id);

        console.log(`\n# Related items for ${id} (${adr.title})\n`);

        if (domainRefs.length > 0) {
          console.log("  ADR → Domain (domain_refs from ADR frontmatter):");
          for (const ref of domainRefs) {
            console.log(`    - ${ref}`);
          }
        }

        if (itemsReferencing.length > 0) {
          console.log("  Domain → ADR (items with adr_refs pointing here):");
          for (const ref of itemsReferencing) {
            console.log(`    - ${ref}`);
          }
        }

        if (domainRefs.length === 0 && itemsReferencing.length === 0) {
          console.log("  No related items found.");
        }
      } else {
        // Domain item → ADRs
        const own = ownAdrRefs(model, id);
        const referencing = adrsReferencingItem(model, id);
        const allAdrs = [...new Set([...own, ...referencing])].sort();

        console.log(`\n# Related ADRs for ${id}\n`);

        if (own.length > 0) {
          console.log("  Item → ADR (adr_refs declared on this item):");
          for (const ref of own) {
            const adr = model.adrs.get(ref);
            const title = adr ? ` — ${adr.title}` : "";
            console.log(`    - ${ref}${title}`);
          }
        }

        if (referencing.length > 0) {
          console.log("  ADR → Item (ADRs with domain_refs pointing here):");
          for (const ref of referencing) {
            const adr = model.adrs.get(ref);
            const title = adr ? ` — ${adr.title}` : "";
            console.log(`    - ${ref}${title}`);
          }
        }

        if (allAdrs.length === 0) {
          console.log("  No related ADRs found.");
        }
      }

      console.log();
    });
}
