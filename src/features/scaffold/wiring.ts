/**
 * Bidirectional relationship wiring for domain item scaffolding.
 *
 * After creating a new item or ADR, these helpers mutate the referenced
 * counterpart YAML files so that relationships stay consistent in both
 * directions. All operations are idempotent — they will never insert a
 * duplicate entry, and they are a no-op when the target file does not
 * exist (a skip is recorded in the result instead).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, stringifyYaml } from "../../shared/yaml.js";
import { contextsDir } from "../../shared/paths.js";

// ── Internals ─────────────────────────────────────────────────────────

const TYPE_DIR_MAP: Record<string, string> = {
  event: "events",
  command: "commands",
  aggregate: "aggregates",
  policy: "policies",
  "read-model": "read-models",
};

function readYamlObj(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  return parseYaml<Record<string, unknown>>(readFileSync(filePath, "utf-8"));
}

function writeYamlObj(filePath: string, obj: Record<string, unknown>): void {
  writeFileSync(filePath, stringifyYaml(obj), "utf-8");
}

/** Add `value` to `obj[outerKey][innerKey]` (string array), idempotently. Returns true if modified. */
function addToNestedArray(
  obj: Record<string, unknown>,
  outerKey: string,
  innerKey: string,
  value: string,
): boolean {
  if (!obj[outerKey] || typeof obj[outerKey] !== "object" || Array.isArray(obj[outerKey])) {
    obj[outerKey] = {};
  }
  const outer = obj[outerKey] as Record<string, unknown>;
  if (!Array.isArray(outer[innerKey])) {
    outer[innerKey] = [];
  }
  const arr = outer[innerKey] as string[];
  if (arr.includes(value)) return false;
  arr.push(value);
  return true;
}

/** Add `value` to `obj[key]` (string array), idempotently. Returns true if modified. */
function addToArray(obj: Record<string, unknown>, key: string, value: string): boolean {
  if (!Array.isArray(obj[key])) {
    obj[key] = [];
  }
  const arr = obj[key] as string[];
  if (arr.includes(value)) return false;
  arr.push(value);
  return true;
}

/** Set `obj[key] = value` only if the key is not already present. Returns true if modified. */
function setIfAbsent(obj: Record<string, unknown>, key: string, value: string): boolean {
  if (obj[key] !== undefined) return false;
  obj[key] = value;
  return true;
}

// ── Public API ────────────────────────────────────────────────────────

export interface WireNewItemOpts {
  type: string;
  name: string;
  context: string;
  raisedBy?: string;
  handledBy?: string;
  handles?: string[];
  emits?: string[];
  root?: string;
}

export interface WireResult {
  wired: string[];
  skipped: string[];
}

/**
 * Wire bidirectional relationships after creating a new domain item.
 *
 * Covered relationship pairs:
 *   - event.raised_by   ↔  aggregate.emits.events
 *   - command.handled_by ↔  aggregate.handles.commands
 */
export function wireNewItem(opts: WireNewItemOpts): WireResult {
  const result: WireResult = { wired: [], skipped: [] };
  const ctxDir = join(contextsDir(opts.root), opts.context);

  if (opts.type === "event" && opts.raisedBy) {
    const aggPath = join(ctxDir, "aggregates", `${opts.raisedBy}.yml`);
    const agg = readYamlObj(aggPath);
    if (agg) {
      if (addToNestedArray(agg, "emits", "events", opts.name)) {
        writeYamlObj(aggPath, agg);
        result.wired.push(`${opts.raisedBy}.emits.events ← ${opts.name}`);
      } else {
        result.skipped.push(`${opts.raisedBy}.emits.events already contains ${opts.name}`);
      }
    } else {
      result.skipped.push(`aggregate ${opts.raisedBy} not found — skipping emits wiring`);
    }
  }

  if (opts.type === "command" && opts.handledBy) {
    const aggPath = join(ctxDir, "aggregates", `${opts.handledBy}.yml`);
    const agg = readYamlObj(aggPath);
    if (agg) {
      if (addToNestedArray(agg, "handles", "commands", opts.name)) {
        writeYamlObj(aggPath, agg);
        result.wired.push(`${opts.handledBy}.handles.commands ← ${opts.name}`);
      } else {
        result.skipped.push(`${opts.handledBy}.handles.commands already contains ${opts.name}`);
      }
    } else {
      result.skipped.push(`aggregate ${opts.handledBy} not found — skipping handles wiring`);
    }
  }

  if (opts.type === "aggregate") {
    for (const eventName of opts.emits ?? []) {
      const evtPath = join(ctxDir, "events", `${eventName}.yml`);
      const evt = readYamlObj(evtPath);
      if (evt) {
        if (setIfAbsent(evt, "raised_by", opts.name)) {
          writeYamlObj(evtPath, evt);
          result.wired.push(`${eventName}.raised_by ← ${opts.name}`);
        } else {
          result.skipped.push(`${eventName}.raised_by already set to "${evt.raised_by}"`);
        }
      } else {
        result.skipped.push(`event ${eventName} not found — skipping raised_by wiring`);
      }
    }

    for (const cmdName of opts.handles ?? []) {
      const cmdPath = join(ctxDir, "commands", `${cmdName}.yml`);
      const cmd = readYamlObj(cmdPath);
      if (cmd) {
        if (setIfAbsent(cmd, "handled_by", opts.name)) {
          writeYamlObj(cmdPath, cmd);
          result.wired.push(`${cmdName}.handled_by ← ${opts.name}`);
        } else {
          result.skipped.push(`${cmdName}.handled_by already set to "${cmd.handled_by}"`);
        }
      } else {
        result.skipped.push(`command ${cmdName} not found — skipping handled_by wiring`);
      }
    }
  }

  return result;
}

/**
 * Wire ADR refs: after creating an ADR, add the ADR id to each referenced
 * domain item's `adr_refs` array. `domainRefs` entries must be in the
 * "context.ItemName" format (e.g. "ordering.OrderPlaced").
 */
export function wireAdrRefs(
  adrId: string,
  domainRefs: string[],
  root?: string,
): WireResult {
  const result: WireResult = { wired: [], skipped: [] };
  const ctxBase = contextsDir(root);

  for (const ref of domainRefs) {
    const dotIdx = ref.indexOf(".");
    if (dotIdx < 0) {
      result.skipped.push(`invalid domain ref "${ref}" — expected context.Name format`);
      continue;
    }

    const ctx = ref.slice(0, dotIdx);
    const itemName = ref.slice(dotIdx + 1);
    const ctxDir = join(ctxBase, ctx);

    let found = false;
    for (const dir of Object.values(TYPE_DIR_MAP)) {
      const itemPath = join(ctxDir, dir, `${itemName}.yml`);
      const item = readYamlObj(itemPath);
      if (item) {
        if (addToArray(item, "adr_refs", adrId)) {
          writeYamlObj(itemPath, item);
          result.wired.push(`${ref}.adr_refs ← ${adrId}`);
        } else {
          result.skipped.push(`${ref}.adr_refs already contains ${adrId}`);
        }
        found = true;
        break;
      }
    }

    if (!found) {
      result.skipped.push(`domain item "${ref}" not found — skipping adr_refs wiring`);
    }
  }

  return result;
}
