/**
 * Bidirectional ADR ↔ domain-item linking.
 *
 * An ADR link has two halves that must agree: `domain_refs` in the ADR
 * frontmatter, and `adr_refs` on each referenced item. Writing only one
 * of them produces a link that resolves (so the validator was happy)
 * but is invisible to the rendered docs and to anything reading the
 * item side — which is most of what an agent looks at.
 *
 * Every mutation in DKK goes through the CLI, so this module owns the
 * "write both halves" operation and `dkk adr link` / `dkk new adr
 * --domain-refs` share it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adrDir, contextsDir, indexFile, actorsFile } from "../../shared/paths.js";
import { parseYaml, stringifyYaml } from "../../shared/yaml.js";
import { updateAdrFrontmatter } from "../refactor/refactor-helpers.js";
import { resolveItemPath } from "../query/commands/locate.js";
import type { ActorsFile, DomainIndex, ContextMetaFile } from "../../shared/types/domain.js";

/** What happened to one half of a link operation. */
export interface LinkOutcome {
  /** The id whose file was touched (item id or ADR id). */
  id: string;
  /** Absolute path of the file, when one was found. */
  file?: string;
  /** True when the file's content actually changed. */
  changed: boolean;
  /** Set when the half could not be written. */
  error?: string;
}

/** Sort ADR ids so a rewritten `adr_refs` list stays stable across runs. */
function sortRefs(refs: string[]): string[] {
  return [...new Set(refs)].sort();
}

/**
 * Add or remove an ADR id in a plain `adr_refs` array, returning the new
 * array or `null` when nothing would change.
 */
function applyRef(
  current: string[] | undefined,
  adrId: string,
  op: "add" | "remove",
): string[] | null | undefined {
  const has = current?.includes(adrId) ?? false;
  if (op === "add") {
    if (has) return null;
    return sortRefs([...(current ?? []), adrId]);
  }
  if (!has) return null;
  const next = (current ?? []).filter((r) => r !== adrId);
  // `undefined` means "delete the key" — an empty list is noise.
  return next.length > 0 ? next : undefined;
}

/**
 * Write an `adr_refs` change into a top-level YAML item file
 * (events/commands/policies/aggregates/read-models).
 */
function updateItemFile(file: string, adrId: string, op: "add" | "remove"): boolean {
  const content = readFileSync(file, "utf-8");
  const data = parseYaml<{ adr_refs?: string[] }>(content);
  const next = applyRef(data.adr_refs, adrId, op);
  if (next === null) return false;
  if (next === undefined) delete data.adr_refs;
  else data.adr_refs = next;
  writeFileSync(file, stringifyYaml(data), "utf-8");
  return true;
}

/** Write an `adr_refs` change into one actor entry in actors.yml. */
function updateActor(root: string | undefined, name: string, adrId: string, op: "add" | "remove"): LinkOutcome {
  const file = actorsFile(root);
  if (!existsSync(file)) return { id: `actor.${name}`, changed: false, error: "actors.yml not found" };
  const content = readFileSync(file, "utf-8");
  const data = parseYaml<ActorsFile>(content);
  const actor = (data.actors ?? []).find((a) => a.name === name);
  if (!actor) return { id: `actor.${name}`, file, changed: false, error: `actor "${name}" not found` };
  const next = applyRef(actor.adr_refs, adrId, op);
  if (next === null) return { id: `actor.${name}`, file, changed: false };
  if (next === undefined) delete actor.adr_refs;
  else actor.adr_refs = next as ActorsFile["actors"][number]["adr_refs"];
  writeFileSync(file, stringifyYaml(data), "utf-8");
  return { id: `actor.${name}`, file, changed: true };
}

/** Write an `adr_refs` change into one flow entry in index.yml. */
function updateFlow(root: string | undefined, name: string, adrId: string, op: "add" | "remove"): LinkOutcome {
  const file = indexFile(root);
  if (!existsSync(file)) return { id: `flow.${name}`, changed: false, error: "index.yml not found" };
  const content = readFileSync(file, "utf-8");
  const data = parseYaml<DomainIndex>(content);
  const flow = (data.flows ?? []).find((f) => f.name === name);
  if (!flow) return { id: `flow.${name}`, file, changed: false, error: `flow "${name}" not found` };
  const next = applyRef(flow.adr_refs, adrId, op);
  if (next === null) return { id: `flow.${name}`, file, changed: false };
  if (next === undefined) delete flow.adr_refs;
  else flow.adr_refs = next as NonNullable<typeof flow.adr_refs>;
  writeFileSync(file, stringifyYaml(data), "utf-8");
  return { id: `flow.${name}`, file, changed: true };
}

/** Write an `adr_refs` change into a context.yml (context-level link). */
function updateContext(root: string | undefined, name: string, adrId: string, op: "add" | "remove"): LinkOutcome {
  const file = join(contextsDir(root), name, "context.yml");
  const id = `context.${name}`;
  if (!existsSync(file)) return { id, changed: false, error: `context "${name}" not found` };
  const content = readFileSync(file, "utf-8");
  const data = parseYaml<ContextMetaFile>(content);
  const next = applyRef(data.adr_refs, adrId, op);
  if (next === null) return { id, file, changed: false };
  if (next === undefined) delete data.adr_refs;
  else data.adr_refs = next as NonNullable<ContextMetaFile["adr_refs"]>;
  writeFileSync(file, stringifyYaml(data), "utf-8");
  return { id, file, changed: true };
}

/** Write an `adr_refs` change into one glossary term inside context.yml. */
function updateGlossary(
  file: string,
  term: string,
  adrId: string,
  op: "add" | "remove",
): boolean {
  const content = readFileSync(file, "utf-8");
  const data = parseYaml<ContextMetaFile>(content);
  const entry = data.glossary?.find((g) => g.term === term);
  if (!entry) return false;
  const next = applyRef(entry.adr_refs, adrId, op);
  if (next === null) return false;
  if (next === undefined) delete entry.adr_refs;
  else entry.adr_refs = next as NonNullable<typeof entry.adr_refs>;
  writeFileSync(file, stringifyYaml(data), "utf-8");
  return true;
}

/**
 * Set (or clear) the `adr_refs` entry on one referenced target.
 *
 * Handles every shape an ADR `domain_refs` entry can take: a domain
 * item, an actor, a flow, a context, or a glossary term.
 */
export function setItemAdrRef(
  itemId: string,
  adrId: string,
  op: "add" | "remove",
  root?: string,
): LinkOutcome {
  // Cross-service refs are read-only from here: the peer's files live in
  // another repository (or a gitignored cache) and are not ours to edit.
  if (itemId.includes(":")) {
    return {
      id: itemId,
      changed: false,
      error: "cross-service ref — the peer owns that file; add the adr_ref in the peer repo",
    };
  }

  if (itemId.startsWith("actor.")) {
    return updateActor(root, itemId.slice("actor.".length), adrId, op);
  }
  if (itemId.startsWith("flow.")) {
    return updateFlow(root, itemId.slice("flow.".length), adrId, op);
  }
  if (itemId.startsWith("context.")) {
    return updateContext(root, itemId.slice("context.".length), adrId, op);
  }

  const paths = resolveItemPath(itemId, root);
  if (paths.length === 0) {
    return { id: itemId, changed: false, error: "no file defines this id" };
  }
  if (paths.length > 1) {
    return {
      id: itemId,
      changed: false,
      error: `ambiguous — ${paths.length} files define it (${paths.join(", ")})`,
    };
  }

  const file = paths[0];
  const term = itemId.slice(itemId.indexOf(".") + 1);
  const changed = file.endsWith("context.yml")
    ? updateGlossary(file, term, adrId, op)
    : updateItemFile(file, adrId, op);
  return { id: itemId, file, changed };
}

/**
 * Add or remove entries in an ADR's `domain_refs` frontmatter list.
 */
export function setAdrDomainRefs(
  adrId: string,
  itemIds: string[],
  op: "add" | "remove",
  root?: string,
): LinkOutcome {
  const file = join(adrDir(root), `${adrId}.md`);
  if (!existsSync(file)) return { id: adrId, changed: false, error: `${adrId}.md not found` };

  const changed = updateAdrFrontmatter(file, (fm) => {
    const current = Array.isArray(fm.domain_refs) ? (fm.domain_refs as string[]) : [];
    const next =
      op === "add"
        ? [...new Set([...current, ...itemIds])].sort()
        : current.filter((r) => !itemIds.includes(r));
    if (next.length === current.length && next.every((r, i) => r === current[i])) return false;
    // Keep the key present-but-empty rather than deleting it: the
    // scaffold writes `domain_refs: []` as a visible slot to fill.
    fm.domain_refs = next;
    return true;
  });

  return { id: adrId, file, changed };
}

/** The result of linking or unlinking an ADR against a set of targets. */
export interface LinkReport {
  adr: LinkOutcome;
  items: LinkOutcome[];
}

/**
 * Link (or unlink) an ADR and a set of domain targets, writing **both**
 * halves. Targets that cannot be written are reported rather than
 * silently skipped; the ADR half is still written for the rest.
 */
export function linkAdr(
  adrId: string,
  itemIds: string[],
  op: "add" | "remove",
  root?: string,
): LinkReport {
  const items = itemIds.map((id) => setItemAdrRef(id, adrId, op, root));
  // Only record refs on the ADR side for targets we could resolve —
  // otherwise a typo becomes a dangling domain_ref that fails validate.
  const writable = items.filter((o) => !o.error).map((o) => o.id);
  const adr = writable.length
    ? setAdrDomainRefs(adrId, writable, op, root)
    : { id: adrId, changed: false };
  return { adr, items };
}
