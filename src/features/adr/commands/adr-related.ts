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
import { loadDomainModel } from "../../../shared/loader.js";
import type { AdrRef, DomainModel } from "../../../shared/types/domain.js";
import { forEachItem, itemAdrRefs } from "../../../shared/item-visitor.js";

/** Collect domain item IDs that reference a specific ADR. */
function domainItemsReferencingAdr(model: DomainModel, adrId: AdrRef): string[] {
  const refs: string[] = [];

  // Actors
  for (const actor of model.actors) {
    if (actor.adr_refs?.includes(adrId)) {
      refs.push(`actor.${actor.name}`);
    }
  }

  // Context items — use shared item visitor
  for (const [ctxName, ctx] of model.contexts) {
    forEachItem(ctx, (_type, name, item) => {
      if (itemAdrRefs(item)?.includes(adrId)) {
        refs.push(`${ctxName}.${name}`);
      }
    });
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

  // Context-scoped item — use shared item visitor
  const dotIdx = itemId.indexOf(".");
  if (dotIdx > 0) {
    const ctxName = itemId.slice(0, dotIdx);
    const itemNameStr = itemId.slice(dotIdx + 1);
    const ctx = model.contexts.get(ctxName);
    if (!ctx) return [];

    let result: string[] = [];
    forEachItem(ctx, (_type, name, item) => {
      if (name === itemNameStr) {
        result = (itemAdrRefs(item) ?? []) as string[];
      }
    });
    return result;
  }

  return [];
}

/** Register the `adr related` subcommand on an `adr` parent command. */
export function registerAdrRelated(adrCmd: Cmd): void {
  adrCmd
    .command("related <id>")
    .description("Show bidirectional domain-ADR links for an ADR or domain item")
    .option("--json", "Output as JSON")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { json?: boolean; root?: string }) => {
      const model = loadDomainModel({ root: opts.root });

      const isAdr = id.startsWith("adr-");

      if (isAdr) {
        // ADR → domain items
        if (!model.adrs.has(id)) {
          if (opts.json) {
            console.log(JSON.stringify({ error: `ADR "${id}" not found` }, null, 2));
          } else {
            console.error(`Error: ADR "${id}" not found.`);
          }
          process.exit(1);
        }

        const adr = model.adrs.get(id)!;
        const domainRefs = (adr.domain_refs ?? []) as string[];
        const itemsReferencing = domainItemsReferencingAdr(model, id as AdrRef);

        if (opts.json) {
          console.log(JSON.stringify({
            id,
            title: adr.title,
            domainRefs,
            referencedBy: itemsReferencing,
          }, null, 2));
          return;
        }

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

        if (opts.json) {
          console.log(JSON.stringify({
            id,
            ownAdrRefs: own,
            referencedByAdrs: referencing,
            allAdrs,
          }, null, 2));
          return;
        }

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
