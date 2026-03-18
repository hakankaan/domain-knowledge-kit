/**
 * Shared helpers for refactor commands (rm, rename, move).
 *
 * Provides YAML-aware manipulation functions for domain items, actors,
 * ADR frontmatter, flows, and context indexes.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import {
  parseYaml,
  stringifyYaml,
} from "../../shared/yaml.js";
import {
  contextsDir,
  indexFile,
  actorsFile as actorsFilePath,
  adrDir,
} from "../../shared/paths.js";
import type {
  DomainIndex,
  ContextMetaFile,
  ActorsFile,
  DomainEvent,
  Command,
  Policy,
  Aggregate,
  ReadModel,
} from "../../shared/types/domain.js";
import type { NodeKind } from "../../shared/graph.js";

// ── Constants ────────────────────────────────────────────────────────

export const KIND_TO_DIR: Record<string, string> = {
  event: "events",
  command: "commands",
  aggregate: "aggregates",
  policy: "policies",
  read_model: "read-models",
};

// ── ID classification ────────────────────────────────────────────────

export type IdKind = "actor" | "flow" | "adr" | "context" | "domain";

export interface ParsedId {
  kind: IdKind;
  /** Simple name (actor name, flow name, ADR id, context name, or item name). */
  name: string;
  /** Context portion for domain items (e.g. "ordering" from "ordering.PlaceOrder"). */
  ctx?: string;
  /** Full original id string. */
  raw: string;
}

/**
 * Classify a user-supplied item id into its kind and component parts.
 *
 * Supported formats:
 *   actor.ActorName   → actor
 *   flow.FlowName     → flow
 *   adr-NNNN          → adr
 *   context.ctxName   → context
 *   ctxName           → context (bare, no dot)
 *   ctx.ItemName      → domain item
 */
export function classifyId(id: string): ParsedId {
  if (id.startsWith("actor.")) {
    return { kind: "actor", name: id.slice("actor.".length), raw: id };
  }
  if (id.startsWith("flow.")) {
    return { kind: "flow", name: id.slice("flow.".length), raw: id };
  }
  if (/^adr-/.test(id)) {
    return { kind: "adr", name: id, raw: id };
  }
  if (id.startsWith("context.")) {
    return { kind: "context", name: id.slice("context.".length), raw: id };
  }
  if (!id.includes(".")) {
    return { kind: "context", name: id, raw: id };
  }
  const dot = id.indexOf(".");
  return {
    kind: "domain",
    name: id.slice(dot + 1),
    ctx: id.slice(0, dot),
    raw: id,
  };
}

// ── Diff helper ──────────────────────────────────────────────────────

export function printDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
): void {
  console.log(`\n--- a/${filePath}\n+++ b/${filePath}`);
  const oLines = oldContent.split("\n");
  const nLines = newContent.split("\n");
  const maxLines = Math.max(oLines.length, nLines.length);
  for (let i = 0; i < maxLines; i++) {
    const o = oLines[i] ?? "";
    const n = nLines[i] ?? "";
    if (o !== n) {
      if (o) console.log(`- ${o}`);
      if (n) console.log(`+ ${n}`);
    }
  }
}

// ── File discovery ───────────────────────────────────────────────────

/**
 * List all YAML item files under a context directory (including context.yml).
 */
export function listContextFiles(ctxPath: string): string[] {
  const files: string[] = [];
  const meta = join(ctxPath, "context.yml");
  if (existsSync(meta)) files.push(meta);
  for (const subDir of Object.values(KIND_TO_DIR)) {
    const dirPath = join(ctxPath, subDir);
    if (!existsSync(dirPath)) continue;
    for (const f of readdirSync(dirPath)) {
      if (f.endsWith(".yml") || f.endsWith(".yaml")) {
        files.push(join(dirPath, f));
      }
    }
  }
  return files;
}

/**
 * Collect all YAML item files across all contexts.
 */
export function allDomainFiles(root?: string): string[] {
  const files: string[] = [];
  const base = contextsDir(root);
  if (!existsSync(base)) return files;
  for (const ent of readdirSync(base, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || !ent.isDirectory()) continue;
    files.push(...listContextFiles(join(base, ent.name)));
  }
  return files;
}

/**
 * Collect all ADR markdown files.
 */
export function allAdrFiles(root?: string): string[] {
  const dir = adrDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(
      (f) =>
        f.endsWith(".md") &&
        f.toLowerCase() !== "readme.md" &&
        !f.startsWith("."),
    )
    .sort()
    .map((f) => join(dir, f));
}

// ── Regex-based file rewrite ─────────────────────────────────────────

/**
 * Rewrite all occurrences of oldId → newId in a file using word-boundary
 * regex. Returns true if any changes were made.
 *
 * Safe for scoped IDs like "ordering.OrderPlaced" and "adr-0001".
 */
export function rewriteFile(
  filePath: string,
  oldId: string,
  newId: string,
  showDiff = false,
): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, "utf-8");
  const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?<![\\w.-])${escaped}(?![\\w.-])`, "g");
  if (!regex.test(content)) return false;
  const newContent = content.replace(
    new RegExp(`(?<![\\w.-])${escaped}(?![\\w.-])`, "g"),
    newId,
  );
  writeFileSync(filePath, newContent, "utf-8");
  if (showDiff) printDiff(filePath, content, newContent);
  return true;
}

// ── ADR frontmatter manipulation ─────────────────────────────────────

/**
 * Update an ADR markdown file's YAML frontmatter in-place.
 * The mutator `fn` receives the parsed frontmatter object.
 * Returns true if any changes were made.
 */
export function updateAdrFrontmatter(
  filePath: string,
  fn: (fm: Record<string, unknown>) => boolean,
  showDiff = false,
): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, "utf-8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (!match) return false;

  const fm = parseYaml<Record<string, unknown>>(match[1]);
  if (!fn(fm)) return false;

  const newFm = stringifyYaml(fm).trimEnd();
  const afterFm = content.slice(match.index + match[0].length);
  const newContent = `---\n${newFm}\n---${afterFm}`;
  writeFileSync(filePath, newContent, "utf-8");
  if (showDiff) printDiff(filePath, content, newContent);
  return true;
}

// ── Glossary (YAML-aware) ────────────────────────────────────────────

/**
 * Remove a glossary entry (by term) from context.yml.
 * Returns true if the entry was found and removed.
 */
export function removeGlossaryEntry(
  ctxPath: string,
  term: string,
  showDiff = false,
): boolean {
  const metaPath = join(ctxPath, "context.yml");
  if (!existsSync(metaPath)) return false;
  const content = readFileSync(metaPath, "utf-8");
  const meta = parseYaml<ContextMetaFile>(content);
  if (!meta.glossary?.length) return false;
  const before = meta.glossary.length;
  meta.glossary = meta.glossary.filter((e) => e.term !== term);
  if (meta.glossary.length === before) return false;
  if (meta.glossary.length === 0)
    delete (meta as Partial<ContextMetaFile>).glossary;
  const newContent = stringifyYaml(meta);
  if (showDiff) printDiff(metaPath, content, newContent);
  writeFileSync(metaPath, newContent, "utf-8");
  return true;
}

/**
 * Rename a glossary term in context.yml.
 * Returns true if the entry was found and renamed.
 */
export function renameGlossaryEntry(
  ctxPath: string,
  oldTerm: string,
  newTerm: string,
  showDiff = false,
): boolean {
  const metaPath = join(ctxPath, "context.yml");
  if (!existsSync(metaPath)) return false;
  const content = readFileSync(metaPath, "utf-8");
  const meta = parseYaml<ContextMetaFile>(content);
  const entry = meta.glossary?.find((e) => e.term === oldTerm);
  if (!entry) return false;
  entry.term = newTerm;
  const newContent = stringifyYaml(meta);
  if (showDiff) printDiff(metaPath, content, newContent);
  writeFileSync(metaPath, newContent, "utf-8");
  return true;
}

// ── Actors ───────────────────────────────────────────────────────────

/**
 * Remove an actor from actors.yml. Returns true if removed.
 */
export function removeActorEntry(
  root: string | undefined,
  actorName: string,
  showDiff = false,
): boolean {
  const path = actorsFilePath(root);
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  const data = parseYaml<ActorsFile>(content);
  const before = data.actors?.length ?? 0;
  data.actors = (data.actors ?? []).filter((a) => a.name !== actorName);
  if (data.actors.length === before) return false;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(path, content, newContent);
  writeFileSync(path, newContent, "utf-8");
  return true;
}

/**
 * Rename an actor in actors.yml. Returns true if renamed.
 */
export function renameActorEntry(
  root: string | undefined,
  oldName: string,
  newName: string,
  showDiff = false,
): boolean {
  const path = actorsFilePath(root);
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  const data = parseYaml<ActorsFile>(content);
  const entry = data.actors?.find((a) => a.name === oldName);
  if (!entry) return false;
  entry.name = newName;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(path, content, newContent);
  writeFileSync(path, newContent, "utf-8");
  return true;
}

// ── Domain item field cleanup (YAML-aware) ────────────────────────────

/**
 * Remove a reference to `targetName` from the appropriate YAML fields
 * of a domain item file, based on the item's kind.
 *
 * `targetName` is the simple (unscoped) name used in within-context refs.
 * `targetScopedId` is the full scoped id, used here only for actor removal
 * from read_models where the actor name equals the `targetName`.
 *
 * Returns true if any changes were made.
 */
export function cleanDomainItemRef(
  filePath: string,
  depKind: NodeKind,
  targetName: string,
  showDiff = false,
): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, "utf-8");

  let changed = false;

  if (depKind === "aggregate") {
    const agg = parseYaml<Aggregate>(content);
    if (agg.handles?.commands?.includes(targetName)) {
      agg.handles.commands = agg.handles.commands.filter(
        (c) => c !== targetName,
      );
      if (agg.handles.commands.length === 0) delete agg.handles;
      changed = true;
    }
    if (agg.emits?.events?.includes(targetName)) {
      agg.emits.events = agg.emits.events.filter((e) => e !== targetName);
      if (agg.emits.events.length === 0) delete agg.emits;
      changed = true;
    }
    if (!changed) return false;
    const newContent = stringifyYaml(agg);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  if (depKind === "event") {
    const evt = parseYaml<DomainEvent>(content);
    if (evt.raised_by !== targetName) return false;
    delete evt.raised_by;
    const newContent = stringifyYaml(evt);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  if (depKind === "command") {
    const cmd = parseYaml<Command>(content);
    if (cmd.handled_by === targetName) {
      delete cmd.handled_by;
      changed = true;
    }
    if (cmd.actor === targetName) {
      delete cmd.actor;
      changed = true;
    }
    if (!changed) return false;
    const newContent = stringifyYaml(cmd);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  if (depKind === "policy") {
    const pol = parseYaml<Policy>(content);
    if (pol.when?.events?.includes(targetName)) {
      pol.when.events = pol.when.events.filter((e) => e !== targetName);
      if (pol.when.events.length === 0) delete pol.when;
      changed = true;
    }
    if (pol.then?.commands?.includes(targetName)) {
      pol.then.commands = pol.then.commands.filter((c) => c !== targetName);
      if (pol.then.commands.length === 0) delete pol.then;
      changed = true;
    }
    if (!changed) return false;
    const newContent = stringifyYaml(pol);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  if (depKind === "read_model") {
    const rm = parseYaml<ReadModel>(content);
    if (rm.subscribes_to?.includes(targetName)) {
      rm.subscribes_to = rm.subscribes_to.filter((e) => e !== targetName);
      if (rm.subscribes_to.length === 0) delete rm.subscribes_to;
      changed = true;
    }
    if (rm.used_by?.includes(targetName)) {
      rm.used_by = rm.used_by.filter((a) => a !== targetName);
      if (rm.used_by.length === 0) delete rm.used_by;
      changed = true;
    }
    if (!changed) return false;
    const newContent = stringifyYaml(rm);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  return false;
}

/**
 * Update a reference to `oldName` → `newName` in a domain item's YAML fields.
 * Returns true if any changes were made.
 */
export function renameDomainItemRef(
  filePath: string,
  depKind: NodeKind,
  oldName: string,
  newName: string,
  showDiff = false,
): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, "utf-8");

  let changed = false;

  if (depKind === "aggregate") {
    const agg = parseYaml<Aggregate>(content);
    if (agg.handles?.commands) {
      const idx = agg.handles.commands.indexOf(oldName);
      if (idx !== -1) {
        agg.handles.commands[idx] = newName;
        changed = true;
      }
    }
    if (agg.emits?.events) {
      const idx = agg.emits.events.indexOf(oldName);
      if (idx !== -1) {
        agg.emits.events[idx] = newName;
        changed = true;
      }
    }
    if (!changed) return false;
    const newContent = stringifyYaml(agg);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  if (depKind === "event") {
    const evt = parseYaml<DomainEvent>(content);
    if (evt.raised_by !== oldName) return false;
    evt.raised_by = newName;
    const newContent = stringifyYaml(evt);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  if (depKind === "command") {
    const cmd = parseYaml<Command>(content);
    if (cmd.handled_by === oldName) {
      cmd.handled_by = newName;
      changed = true;
    }
    if (cmd.actor === oldName) {
      cmd.actor = newName;
      changed = true;
    }
    if (!changed) return false;
    const newContent = stringifyYaml(cmd);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  if (depKind === "policy") {
    const pol = parseYaml<Policy>(content);
    if (pol.when?.events) {
      const idx = pol.when.events.indexOf(oldName);
      if (idx !== -1) {
        pol.when.events[idx] = newName;
        changed = true;
      }
    }
    if (pol.then?.commands) {
      const idx = pol.then.commands.indexOf(oldName);
      if (idx !== -1) {
        pol.then.commands[idx] = newName;
        changed = true;
      }
    }
    if (!changed) return false;
    const newContent = stringifyYaml(pol);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  if (depKind === "read_model") {
    const rm = parseYaml<ReadModel>(content);
    if (rm.subscribes_to) {
      const idx = rm.subscribes_to.indexOf(oldName);
      if (idx !== -1) {
        rm.subscribes_to[idx] = newName;
        changed = true;
      }
    }
    if (rm.used_by) {
      const idx = rm.used_by.indexOf(oldName);
      if (idx !== -1) {
        rm.used_by[idx] = newName;
        changed = true;
      }
    }
    if (!changed) return false;
    const newContent = stringifyYaml(rm);
    if (showDiff) printDiff(filePath, content, newContent);
    writeFileSync(filePath, newContent, "utf-8");
    return true;
  }

  return false;
}

// ── Flow helpers ─────────────────────────────────────────────────────

/**
 * Remove a flow from index.yml by name. Returns true if removed.
 */
export function removeFlowFromIndex(
  root: string | undefined,
  flowName: string,
  showDiff = false,
): boolean {
  const path = indexFile(root);
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  const data = parseYaml<DomainIndex>(content);
  if (!data.flows?.length) return false;
  const before = data.flows.length;
  data.flows = data.flows.filter((f) => f.name !== flowName);
  if (data.flows.length === before) return false;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(path, content, newContent);
  writeFileSync(path, newContent, "utf-8");
  return true;
}

/**
 * Rename a flow in index.yml. Returns true if renamed.
 */
export function renameFlowInIndex(
  root: string | undefined,
  oldName: string,
  newName: string,
  showDiff = false,
): boolean {
  const path = indexFile(root);
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  const data = parseYaml<DomainIndex>(content);
  const flow = data.flows?.find((f) => f.name === oldName);
  if (!flow) return false;
  flow.name = newName;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(path, content, newContent);
  writeFileSync(path, newContent, "utf-8");
  return true;
}

/**
 * Remove all flow steps that reference a given scoped domain item id.
 * Flows that become empty (0 steps) are removed entirely.
 * Returns the number of steps removed.
 */
export function removeFlowStepsForItem(
  root: string | undefined,
  scopedId: string,
  showDiff = false,
): number {
  const path = indexFile(root);
  if (!existsSync(path)) return 0;
  const content = readFileSync(path, "utf-8");
  const data = parseYaml<DomainIndex>(content);
  if (!data.flows?.length) return 0;

  let removed = 0;
  data.flows = data.flows
    .map((flow) => {
      const before = flow.steps.length;
      flow.steps = flow.steps.filter((s) => s.ref !== scopedId);
      removed += before - flow.steps.length;
      return flow;
    })
    .filter((flow) => flow.steps.length > 0);

  if (removed === 0) return 0;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(path, content, newContent);
  writeFileSync(path, newContent, "utf-8");
  return removed;
}

/**
 * Remove all flow steps that reference any item in a given context.
 * Flows that become empty are removed entirely.
 */
export function removeFlowStepsForContext(
  root: string | undefined,
  ctxName: string,
  showDiff = false,
): number {
  const path = indexFile(root);
  if (!existsSync(path)) return 0;
  const content = readFileSync(path, "utf-8");
  const data = parseYaml<DomainIndex>(content);
  if (!data.flows?.length) return 0;

  let removed = 0;
  data.flows = data.flows
    .map((flow) => {
      const before = flow.steps.length;
      flow.steps = flow.steps.filter((s) => !s.ref.startsWith(`${ctxName}.`));
      removed += before - flow.steps.length;
      return flow;
    })
    .filter((flow) => flow.steps.length > 0);

  if (removed === 0) return 0;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(path, content, newContent);
  writeFileSync(path, newContent, "utf-8");
  return removed;
}

/**
 * Update flow steps that reference an old scoped id to use a new scoped id.
 * Returns the number of steps updated.
 */
export function updateFlowStepsForItem(
  root: string | undefined,
  oldScopedId: string,
  newScopedId: string,
  showDiff = false,
): number {
  const path = indexFile(root);
  if (!existsSync(path)) return 0;
  const content = readFileSync(path, "utf-8");
  const data = parseYaml<DomainIndex>(content);
  if (!data.flows?.length) return 0;

  let updated = 0;
  for (const flow of data.flows) {
    for (const step of flow.steps) {
      if (step.ref === oldScopedId) {
        step.ref = newScopedId as typeof step.ref;
        updated++;
      }
    }
  }

  if (updated === 0) return 0;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(path, content, newContent);
  writeFileSync(path, newContent, "utf-8");
  return updated;
}

// ── Context index helpers ─────────────────────────────────────────────

/**
 * Remove a context entry from index.yml. Returns true if removed.
 */
export function removeContextFromIndex(
  root: string | undefined,
  ctxName: string,
  showDiff = false,
): boolean {
  const path = indexFile(root);
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  const data = parseYaml<DomainIndex>(content);
  const before = data.contexts.length;
  data.contexts = data.contexts.filter((c) => c.name !== ctxName);
  if (data.contexts.length === before) return false;
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(path, content, newContent);
  writeFileSync(path, newContent, "utf-8");
  return true;
}

/**
 * Rename a context entry in index.yml. Returns true if renamed.
 */
export function renameContextInIndex(
  root: string | undefined,
  oldName: string,
  newName: string,
  showDiff = false,
): boolean {
  const path = indexFile(root);
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  const data = parseYaml<DomainIndex>(content);
  const entry = data.contexts.find((c) => c.name === oldName);
  if (!entry) return false;
  entry.name = newName;
  // Also update any flow step refs that use old context prefix
  if (data.flows?.length) {
    for (const flow of data.flows) {
      for (const step of flow.steps) {
        if (step.ref.startsWith(`${oldName}.`)) {
          step.ref = (newName + step.ref.slice(oldName.length)) as typeof step.ref;
        }
      }
    }
  }
  const newContent = stringifyYaml(data);
  if (showDiff) printDiff(path, content, newContent);
  writeFileSync(path, newContent, "utf-8");
  return true;
}
