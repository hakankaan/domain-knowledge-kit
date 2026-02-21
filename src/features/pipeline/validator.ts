/**
 * Domain model validator.
 *
 * Validates the loaded {@link DomainModel} in two phases:
 *
 * 1. **Schema validation** — Each YAML file is checked against its
 *    corresponding JSON Schema (via ajv).
 * 2. **Cross-reference validation** — All inter-item references are
 *    resolved: context names, adr_refs, domain_refs, handles/emits,
 *    triggers, subscribes_to, used_by, raised_by, handled_by, actor.
 *
 * Results are returned as arrays of errors (blocking, should exit 1)
 * and warnings (non-blocking, informational).
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  DomainModel,
  DomainContext,
  AdrRecord,
  Actor,
  DomainEvent,
  Command,
  Policy,
  Aggregate,
  ReadModel,
} from "../../shared/types/domain.js";
import { forEachItem, itemAdrRefs } from "../../shared/item-visitor.js";
import type { ItemType, AnyDomainItem } from "../../shared/item-visitor.js";

// ajv & ajv-formats are CJS packages; use createRequire for clean interop
// under both tsc (Node16 resolution) and tsx (ESM runtime).
const require = createRequire(import.meta.url);
const Ajv = require("ajv").default as typeof import("ajv").default;
const addFormats = require("ajv-formats").default as typeof import("ajv-formats").default;

// ── Types ─────────────────────────────────────────────────────────────

/** Severity of a validation finding. */
export type Severity = "error" | "warning";

/** A single validation finding. */
export interface ValidationIssue {
  /** error = blocking (fail), warning = informational. */
  severity: Severity;
  /** Human-readable problem description. */
  message: string;
  /** Location hint (e.g. "context:ordering", "adr:adr-0001"). */
  path?: string;
}

/** Complete validation result. */
export interface ValidationResult {
  /** True when there are zero errors (warnings are OK). */
  valid: boolean;
  /** All findings grouped for convenience. */
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** Options that control validator behaviour. */
export interface ValidatorOptions {
  /**
   * Absolute path to the schema directory.
   * Defaults to `<repoRoot>/tools/domain-pack/schema`.
   */
  schemaDir?: string;

  /**
   * When true, emit warnings for events and commands that have no
   * `fields` array defined. Default: `false`.
   */
  warnMissingFields?: boolean;
}

// ── Schema bootstrap ──────────────────────────────────────────────────

/** Load all `*.schema.json` files from a directory into an Ajv instance. */
function buildAjv(schemaDir: string): InstanceType<typeof Ajv> {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);

  const files = readdirSync(schemaDir).filter((f) => f.endsWith(".schema.json"));
  for (const file of files) {
    const schema = JSON.parse(readFileSync(join(schemaDir, file), "utf-8"));
    ajv.addSchema(schema, schema.$id);
  }
  return ajv;
}

// ── Helper: push issue ────────────────────────────────────────────────

function err(issues: ValidationIssue[], message: string, path?: string): void {
  issues.push({ severity: "error", message, path });
}

function warn(issues: ValidationIssue[], message: string, path?: string): void {
  issues.push({ severity: "warning", message, path });
}

// ── Phase 1: Schema validation ────────────────────────────────────────

function validateSchemas(
  model: DomainModel,
  ajv: InstanceType<typeof Ajv>,
  issues: ValidationIssue[],
): void {
  // Helper: validate a single value against a schema id
  function check(schemaId: string, data: unknown, path: string): void {
    const validate = ajv.getSchema(schemaId);
    if (!validate) {
      err(issues, `Schema "${schemaId}" not found in ajv`, path);
      return;
    }
    if (!validate(data)) {
      for (const e of validate.errors ?? []) {
        const loc = e.instancePath ? ` ${e.instancePath}` : "";
        err(issues, `Schema "${schemaId}"${loc}: ${e.message}`, path);
      }
    }
  }

  // Index
  check("index.schema.json", model.index, "index");

  // Actors
  check("actors.schema.json", { actors: model.actors }, "actors");

  // Bounded contexts (validate the full context object)
  for (const [name, ctx] of model.contexts) {
    check("context.schema.json", ctx, `context:${name}`);
  }

  // ADR frontmatter (strip runtime-only `body` field before validation)
  for (const [id, adr] of model.adrs) {
    const { body: _, ...frontmatter } = adr;
    check("adr-frontmatter.schema.json", frontmatter, `adr:${id}`);
  }
}

// ── Phase 2: Cross-reference validation ───────────────────────────────

function validateCrossRefs(
  model: DomainModel,
  options: ValidatorOptions,
  issues: ValidationIssue[],
): void {
  // ─ Build lookup sets ────────────────────────────────────────────────

  /** All ADR ids (e.g. "adr-0001"). */
  const adrIds = new Set(model.adrs.keys());

  /** All context names. */
  const contextNames = new Set(model.contexts.keys());

  /** All actor names. */
  const actorNames = new Set(model.actors.map((a) => a.name));

  /**
   * All named domain items keyed as "context.Name".
   * Used to verify domain_refs from ADRs and flow step refs.
   */
  const domainItemIds = new Set<string>();

  /**
   * Per-context lookup sets for events, commands, aggregates,
   * read models, policies, and glossary terms.
   */
  const perContext = new Map<
    string,
    {
      events: Set<string>;
      commands: Set<string>;
      aggregates: Set<string>;
      readModels: Set<string>;
      policies: Set<string>;
      glossaryTerms: Set<string>;
    }
  >();

  for (const [ctxName, ctx] of model.contexts) {
    const sets = {
      events: new Set<string>(),
      commands: new Set<string>(),
      aggregates: new Set<string>(),
      readModels: new Set<string>(),
      policies: new Set<string>(),
      glossaryTerms: new Set<string>(),
    };

    const typeToSet: Record<ItemType, Set<string>> = {
      event: sets.events,
      command: sets.commands,
      aggregate: sets.aggregates,
      read_model: sets.readModels,
      policy: sets.policies,
      glossary: sets.glossaryTerms,
    };

    forEachItem(ctx, (type, name) => {
      typeToSet[type].add(name);
      domainItemIds.add(`${ctxName}.${name}`);
    });

    perContext.set(ctxName, sets);
  }

  // ─ 1. Global ID uniqueness ─────────────────────────────────────────
  // Check for duplicate names within a context (e.g. an event and command
  // with the same name). Glossary terms share the same ID namespace
  // (context.Name), so they must also be unique.
  for (const [ctxName, ctx] of model.contexts) {
    const seen = new Map<string, string>(); // name → first-seen kind
    forEachItem(ctx, (kind, name) => {
      if (seen.has(name)) {
        err(
          issues,
          `Duplicate name "${name}" in context "${ctxName}" (first seen as ${seen.get(name)}, duplicate as ${kind})`,
          `context:${ctxName}`,
        );
      } else {
        seen.set(name, kind);
      }
    });
  }

  // ─ 2. Context references in index ──────────────────────────────────
  for (const entry of model.index.contexts) {
    if (!contextNames.has(entry.name)) {
      err(
        issues,
        `Index references context "${entry.name}" but no context file was loaded`,
        "index",
      );
    }
  }

  // ─ 3. ADR ref resolution ───────────────────────────────────────────
  // Every adr_refs entry on any domain item must resolve to an ADR.
  function checkAdrRefs(refs: string[] | undefined, path: string): void {
    for (const ref of refs ?? []) {
      if (!adrIds.has(ref)) {
        err(issues, `adr_ref "${ref}" does not resolve to any ADR`, path);
      }
    }
  }

  for (const actor of model.actors) {
    checkAdrRefs(actor.adr_refs, `actor:${actor.name}`);
  }

  for (const [ctxName, ctx] of model.contexts) {
    forEachItem(ctx, (type, name, item) => {
      checkAdrRefs(itemAdrRefs(item), `context:${ctxName}.${type}:${name}`);
    });
  }

  // ─ 4. ADR domain_refs resolution ───────────────────────────────────
  for (const [id, adr] of model.adrs) {
    for (const ref of adr.domain_refs ?? []) {
      if (!domainItemIds.has(ref)) {
        err(issues, `ADR domain_ref "${ref}" does not resolve to any domain item`, `adr:${id}`);
      }
    }
    // superseded_by must resolve
    if (adr.superseded_by && !adrIds.has(adr.superseded_by)) {
      err(issues, `ADR superseded_by "${adr.superseded_by}" does not resolve to any ADR`, `adr:${id}`);
    }
  }

  // ─ 5. Intra-context reference resolution ───────────────────────────
  for (const [ctxName, ctx] of model.contexts) {
    const sets = perContext.get(ctxName)!;
    const path = (kind: string, name: string) => `context:${ctxName}.${kind}:${name}`;

    forEachItem(ctx, (type, name, item) => {
      switch (type) {
        case "event": {
          const e = item as DomainEvent;
          if (e.raised_by && !sets.aggregates.has(e.raised_by)) {
            err(
              issues,
              `Event "${e.name}" raised_by "${e.raised_by}" does not match any aggregate in context "${ctxName}"`,
              path("event", e.name),
            );
          }
          break;
        }
        case "command": {
          const c = item as Command;
          if (c.handled_by && !sets.aggregates.has(c.handled_by)) {
            err(
              issues,
              `Command "${c.name}" handled_by "${c.handled_by}" does not match any aggregate in context "${ctxName}"`,
              path("command", c.name),
            );
          }
          if (c.actor && !actorNames.has(c.actor)) {
            err(
              issues,
              `Command "${c.name}" actor "${c.actor}" does not match any actor`,
              path("command", c.name),
            );
          }
          break;
        }
        case "aggregate": {
          const a = item as Aggregate;
          for (const h of a.handles?.commands ?? []) {
            if (!sets.commands.has(h)) {
              err(
                issues,
                `Aggregate "${a.name}" handles "${h}" but no such command in context "${ctxName}"`,
                path("aggregate", a.name),
              );
            }
          }
          for (const e of a.emits?.events ?? []) {
            if (!sets.events.has(e)) {
              err(
                issues,
                `Aggregate "${a.name}" emits "${e}" but no such event in context "${ctxName}"`,
                path("aggregate", a.name),
              );
            }
          }
          break;
        }
        case "policy": {
          const p = item as Policy;
          for (const t of p.triggers ?? []) {
            if (!sets.events.has(t)) {
              err(
                issues,
                `Policy "${p.name}" triggers on "${t}" but no such event in context "${ctxName}"`,
                path("policy", p.name),
              );
            }
          }
          for (const e of p.emits ?? []) {
            if (!sets.commands.has(e)) {
              err(
                issues,
                `Policy "${p.name}" emits "${e}" but no such command in context "${ctxName}"`,
                path("policy", p.name),
              );
            }
          }
          break;
        }
        case "read_model": {
          const r = item as ReadModel;
          for (const s of r.subscribes_to ?? []) {
            if (!sets.events.has(s)) {
              err(
                issues,
                `ReadModel "${r.name}" subscribes_to "${s}" but no such event in context "${ctxName}"`,
                path("read_model", r.name),
              );
            }
          }
          for (const u of r.used_by ?? []) {
            if (!actorNames.has(u)) {
              err(
                issues,
                `ReadModel "${r.name}" used_by "${u}" but no such actor`,
                path("read_model", r.name),
              );
            }
          }
          break;
        }
        case "glossary":
          // Glossary entries have no intra-context references to validate.
          break;
      }
    });
  }

  // ─ 6. Flow step resolution ─────────────────────────────────────────
  for (const flow of model.index.flows ?? []) {
    for (const step of flow.steps) {
      if (!domainItemIds.has(step.ref)) {
        err(
          issues,
          `Flow "${flow.name}" step ref "${step.ref}" does not resolve to any domain item`,
          `flow:${flow.name}`,
        );
      }
    }
  }

  // ─ 7. Configurable warnings ────────────────────────────────────────
  if (options.warnMissingFields) {
    for (const [ctxName, ctx] of model.contexts) {
      forEachItem(ctx, (type, name, item) => {
        if (type === "event" || type === "command") {
          const typed = item as DomainEvent | Command;
          if (!typed.fields || typed.fields.length === 0) {
            warn(
              issues,
              `${type === "event" ? "Event" : "Command"} "${name}" has no fields defined`,
              `context:${ctxName}.${type}:${name}`,
            );
          }
        }
      });
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Default schema directory, resolved relative to this module.
 * Works both from source (`src/core/`) and compiled (`dist/core/`).
 */
function defaultSchemaDir(): string {
  return join(import.meta.dirname, "../../../tools/domain-pack/schema");
}

/**
 * Validate a loaded {@link DomainModel}.
 *
 * Runs JSON Schema validation followed by cross-reference checks.
 * Returns a {@link ValidationResult} containing errors and warnings.
 *
 * @param model - The domain model to validate (from `loadDomainModel()`).
 * @param options - Optional validator configuration.
 */
export function validateDomainModel(
  model: DomainModel,
  options: ValidatorOptions = {},
): ValidationResult {
  const schemaDir = options.schemaDir ?? defaultSchemaDir();
  const ajv = buildAjv(schemaDir);
  const issues: ValidationIssue[] = [];

  validateSchemas(model, ajv, issues);
  validateCrossRefs(model, options, issues);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
