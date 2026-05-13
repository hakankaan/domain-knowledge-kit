/**
 * Domain model validator.
 *
 * Validates the loaded {@link DomainModel} in two phases:
 *
 * 1. **Schema validation** — Each YAML file is checked against its
 *    corresponding JSON Schema (via ajv).
 * 2. **Cross-reference validation** — All inter-item references are
 *    resolved: context names, adr_refs, domain_refs, handles/emits,
 *    when/then (policy), subscribes_to, used_by, raised_by, handled_by, actor.
 *
 * Results are returned as arrays of errors (blocking, should exit 1)
 * and warnings (non-blocking, informational).
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  DomainModel,
  DomainEvent,
  Command,
  Policy,
  Aggregate,
  ReadModel,
} from "../../shared/types/domain.js";
import { forEachItem, itemAdrRefs } from "../../shared/item-visitor.js";
import type { ItemType } from "../../shared/item-visitor.js";
import { didYouMean } from "../../shared/similarity.js";
import { parseRef } from "../../shared/refs.js";

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
   * Defaults to `<repoRoot>/tools/dkk/schema`.
   */
  schemaDir?: string;

  /**
   * When true, emit warnings for events and commands that have no
   * `fields` array defined. Default: `false`.
   */
  warnMissingFields?: boolean;

  /**
   * Federation strictness for cross-service refs.
   *
   *  - `"lenient"` (default): unreachable peers and refs to
   *    non-exported items are warnings, not errors. Suitable for the
   *    inner dev loop where a peer may not yet be cloned/pulled.
   *  - `"strict"`: those become errors instead. Suitable for CI
   *    gates that must guarantee every cross-service ref resolves.
   */
  federation?: "lenient" | "strict";
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

  // ─ Federation: parallel peer index sets ────────────────────────────
  // Built ONLY for service-prefixed refs. Local (bare) refs MUST NOT
  // fall through to peer sets — that would silently match same-named
  // items across services. The `resolveForeignRef` helper below enforces
  // this separation by routing on `parsed.service !== undefined`.

  const localServiceName = model.service?.name;
  const strictFederation = options.federation === "strict";
  const peerStrictness = strictFederation ? err : warn;

  /** Service name → its ADR id set. */
  const peerAdrIds = new Map<string, Set<string>>();
  /** Service name → its "ctx.Name" item id set. */
  const peerDomainItemIds = new Map<string, Set<string>>();
  /** Service name → its `service.exports[]` set (for non-exported warnings). */
  const peerExports = new Map<string, Set<string>>();

  for (const [peerName, peerModel] of model.peers ?? []) {
    peerAdrIds.set(peerName, new Set(peerModel.adrs.keys()));
    const ids = new Set<string>();
    for (const [ctxName, ctx] of peerModel.contexts) {
      forEachItem(ctx, (_type, name) => {
        ids.add(`${ctxName}.${name}`);
      });
    }
    peerDomainItemIds.set(peerName, ids);
    peerExports.set(peerName, new Set(peerModel.service?.exports ?? []));
  }

  /**
   * Reverse-direction routing for inter-item refs.
   *
   * Returns a tagged result so callers know what to do next:
   *
   *  - `{ kind: "foreign" }` — the raw ref names a different service.
   *    Diagnostics for the peer lookup are emitted as a side effect.
   *    Caller skips its local resolution path entirely.
   *  - `{ kind: "local", key }` — the raw ref is bare OR self-prefixed
   *    (i.e. names this service via prefix). `key` is the un-prefixed
   *    form the caller should look up in its local sets. Bare inputs
   *    return themselves; `<localService>:foo.Bar` returns `foo.Bar`;
   *    `<localService>:adr-0001` returns `adr-0001`. The caller's
   *    existing `set.has(key)` check picks up the local resolution
   *    cleanly without having to special-case the self-prefix form.
   *  - `{ kind: "unparseable" }` — the ref contains a colon (so the
   *    author clearly intended a federated form) but parsing failed.
   *    An error is emitted here; caller skips its local check to
   *    avoid a confusing "name not found" second error.
   *
   * `expected` describes the item kind the caller expects to find,
   * used only for error messages.
   */
  type ForeignVerdict =
    | { kind: "foreign" }
    | { kind: "local"; key: string }
    | { kind: "unparseable" };
  function resolveForeignRef(
    raw: string,
    expected: "adr" | "item",
    path: string,
  ): ForeignVerdict {
    const colonIdx = raw.indexOf(":");
    const looksFederated = colonIdx > 0;
    const parsed = parseRef(raw);

    // Self-prefix is harmless: `ordering:ordering.Foo` from inside
    // service `ordering` is treated as a local ref. Strip the prefix
    // so the caller's set.has() lookup matches the bare-key index.
    if (parsed && parsed.service && parsed.service === localServiceName) {
      return { kind: "local", key: bareKeyOf(parsed) };
    }

    if (parsed && parsed.service) {
      // True foreign ref.
      const svc = parsed.service;
      const peer = model.peers?.get(svc);
      if (!peer) {
        peerStrictness(
          issues,
          `peer ref "${raw}" — service "${svc}" is not loaded (peer unreachable or not declared in federation.yml)`,
          path,
        );
        return { kind: "foreign" };
      }

      // Lookup against the right peer index.
      if (expected === "adr" && parsed.kind === "adr") {
        const ids = peerAdrIds.get(svc)!;
        if (!ids.has(parsed.id)) {
          err(
            issues,
            `peer ref "${raw}" — ADR "${parsed.id}" not found in service "${svc}".${didYouMean(parsed.id, ids)}`,
            path,
          );
        }
        return { kind: "foreign" };
      }

      if (expected === "item") {
        // For item refs, the parsed form is either `{kind:'item'}` or
        // a name-only ref expressed as `<svc>:Name`. The fully-qualified
        // form (`<svc>:ctx.Name`) is what we look up. Name-only foreign
        // refs (`<svc>:Name`) are intentionally rejected at the
        // validator boundary — too ambiguous when a peer exports more
        // than one context. Force callers to write the full form.
        if (parsed.kind === "item") {
          const fqid = `${parsed.context}.${parsed.name}`;
          const ids = peerDomainItemIds.get(svc)!;
          if (!ids.has(fqid)) {
            err(
              issues,
              `peer ref "${raw}" — item "${fqid}" not found in service "${svc}".${didYouMean(fqid, ids)}`,
              path,
            );
            return { kind: "foreign" };
          }
          const exports = peerExports.get(svc)!;
          if (exports.size > 0 && !exports.has(parsed.context)) {
            warn(
              issues,
              `peer ref "${raw}" — context "${parsed.context}" is not in service "${svc}".exports (peer may not intend to publish it)`,
              path,
            );
          }
          return { kind: "foreign" };
        }
        // Other kinds (actor/flow/context) with a service prefix are
        // valid forms but not what caller asked for.
        err(
          issues,
          `peer ref "${raw}" — expected an item ref but got a ${parsed.kind} ref`,
          path,
        );
        return { kind: "foreign" };
      }
    }

    // Looks federated but failed to parse — surface and skip local.
    if (looksFederated && !parsed) {
      err(
        issues,
        `ref "${raw}" looks federated (contains ":") but does not match the expected format (\`<service>:<context>.<Name>\` or \`<service>:adr-NNNN\`)`,
        path,
      );
      return { kind: "unparseable" };
    }

    // Bare ref (or unparseable but no colon — also "bare" from the
    // caller's perspective, will fail its own set.has() lookup).
    return { kind: "local", key: raw };
  }

  /**
   * Produce the bare local-key form of a parsed ref — the string that
   * the global-id sets (`adrIds`, `domainItemIds`) are expected to
   * contain. Used to strip a self-prefix so `set.has(key)` matches
   * the bare-name index.
   *
   * Item refs strip down to `<ctx>.<Name>`; ADR refs strip to
   * `adr-NNNN`; actor/flow/context refs strip to their bare form.
   */
  function bareKeyOf(parsed: ReturnType<typeof parseRef> & object): string {
    switch (parsed.kind) {
      case "item":
        return `${parsed.context}.${parsed.name}`;
      case "adr":
        return parsed.id;
      case "actor":
        return `actor.${parsed.name}`;
      case "flow":
        return `flow.${parsed.name}`;
      case "context":
        return `context.${parsed.name}`;
    }
  }

  /**
   * Federation-aware resolver for actor refs.
   *
   * Actor refs appear as bare PascalCase names (`Customer`,
   * `PaymentGateway`) inside `command.actor` and `read_model.used_by`.
   * The federated form is `<service>:actor.<Name>` (matching the
   * `actor.X` shape elsewhere). Returns the same tagged result as
   * {@link resolveForeignRef} so callers can use a uniform pattern.
   *
   * For local lookups, `key` is the bare PascalCase name (which is
   * what `actorNames` contains).
   */
  function resolveActorRef(
    raw: string,
    path: string,
  ): ForeignVerdict {
    if (!raw.includes(":")) {
      // Bare actor name — local lookup against `actorNames`.
      return { kind: "local", key: raw };
    }

    const parsed = parseRef(raw);
    if (!parsed) {
      err(
        issues,
        `actor ref "${raw}" looks federated (contains ":") but does not match \`<service>:actor.<Name>\``,
        path,
      );
      return { kind: "unparseable" };
    }

    // Self-prefix to an actor: `<localSvc>:actor.Customer` resolves
    // locally to bare `Customer`.
    if (parsed.kind === "actor" && parsed.service === localServiceName) {
      return { kind: "local", key: parsed.name };
    }

    // Foreign actor ref.
    if (parsed.kind === "actor" && parsed.service) {
      const svc = parsed.service;
      const peer = model.peers?.get(svc);
      if (!peer) {
        peerStrictness(
          issues,
          `peer ref "${raw}" — service "${svc}" is not loaded (peer unreachable or not declared in federation.yml)`,
          path,
        );
        return { kind: "foreign" };
      }
      const peerActors = new Set(peer.actors.map((a) => a.name));
      if (!peerActors.has(parsed.name)) {
        err(
          issues,
          `peer ref "${raw}" — actor "${parsed.name}" not found in service "${svc}".${didYouMean(parsed.name, peerActors)}`,
          path,
        );
      }
      return { kind: "foreign" };
    }

    // It's a valid ref but not an actor ref. Treat the colon as
    // malformed for the actor context.
    err(
      issues,
      `actor ref "${raw}" — expected an actor ref but got a ${parsed.kind} ref`,
      path,
    );
    return { kind: "unparseable" };
  }

  /**
   * Strip a self-prefix from an intra-context name-only ref (the
   * format used by `raised_by`, `handled_by`, `when.events`, etc.).
   *
   * For these fields the local set is keyed by **name only** (no
   * context), and the YAML normally carries a bare PascalCase name
   * like `OrderPlaced`. A self-prefixed form `ordering:ordering.Foo`
   * inside the `ordering` service is also valid; strip down to
   * `Foo` so the existing `sets.events.has(name)` lookup succeeds
   * — but only when the parsed context matches the caller's
   * current context. A self-prefix to a *different* context within
   * the same service (`ordering:billing.Foo` from inside `ordering`)
   * would not be a local-context ref and should fail.
   *
   * Returns the bare name on success, or `null` when the self-prefix
   * names a different context than the caller's (caller should
   * report "no such X in context C").
   */
  function selfPrefixedNameKey(raw: string, currentCtx: string): string | null {
    const parsed = parseRef(raw);
    if (!parsed || parsed.kind !== "item") return null;
    if (parsed.service !== localServiceName) return null;
    if (parsed.context !== currentCtx) return null;
    return parsed.name;
  }

  /**
   * Resolve a name-only intra-context ref to the bare-name key the
   * local context's set expects. Handles three input shapes:
   *
   *  - Bare PascalCase name (`Foo`) → returns `"Foo"`.
   *  - Self-prefixed full ref (`<localSvc>:<currentCtx>.Foo`)
   *    → returns `"Foo"`.
   *  - Anything else (foreign, malformed, or self-prefixed-but-
   *    wrong-context) → returns `null`. Caller skips local lookup.
   */
  function localNameKey(raw: string, currentCtx: string): string | null {
    if (!raw.includes(":")) return raw;
    return selfPrefixedNameKey(raw, currentCtx);
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
  const indexedContextNames = new Set(model.index.contexts.map((e) => e.name));

  for (const entry of model.index.contexts) {
    if (!contextNames.has(entry.name)) {
      err(
        issues,
        `Index references context "${entry.name}" but no context file was loaded.${didYouMean(entry.name, contextNames)}`,
        "index",
      );
    }
  }

  // Reverse: context on disk but not registered in the index
  for (const name of contextNames) {
    if (!indexedContextNames.has(name)) {
      err(
        issues,
        `Context "${name}" is present on disk but not registered in the domain index`,
        `context:${name}`,
      );
    }
  }

  // ─ 3. ADR ref resolution ───────────────────────────────────────────
  // Every adr_refs entry on any domain item must resolve to an ADR.
  function checkAdrRefs(refs: string[] | undefined, path: string): void {
    for (const ref of refs ?? []) {
      const verdict = resolveForeignRef(ref, "adr", path);
      if (verdict.kind !== "local") continue;
      if (!adrIds.has(verdict.key)) {
        err(issues, `adr_ref "${ref}" does not resolve to any ADR.${didYouMean(verdict.key, adrIds)}`, path);
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
      const verdict = resolveForeignRef(ref, "item", `adr:${id}`);
      if (verdict.kind !== "local") continue;
      if (!domainItemIds.has(verdict.key)) {
        err(issues, `ADR domain_ref "${ref}" does not resolve to any domain item.${didYouMean(verdict.key, domainItemIds)}`, `adr:${id}`);
      }
    }
    // superseded_by must resolve
    if (adr.superseded_by) {
      const verdict = resolveForeignRef(adr.superseded_by, "adr", `adr:${id}`);
      if (verdict.kind === "local" && !adrIds.has(verdict.key)) {
        err(issues, `ADR superseded_by "${adr.superseded_by}" does not resolve to any ADR.${didYouMean(verdict.key, adrIds)}`, `adr:${id}`);
      }
    }
  }

  // ─ 5. Intra-context reference resolution ───────────────────────────
  for (const [ctxName, ctx] of model.contexts) {
    const sets = perContext.get(ctxName)!;
    const path = (kind: string, name: string) => `context:${ctxName}.${kind}:${name}`;

    forEachItem(ctx, (type, _name, item) => {
      switch (type) {
        case "event": {
          const e = item as DomainEvent;
          if (e.raised_by) {
            const verdict = resolveForeignRef(e.raised_by, "item", path("event", e.name));
            if (verdict.kind === "local") {
              const key = localNameKey(e.raised_by, ctxName);
              if (key === null || !sets.aggregates.has(key)) {
                err(
                  issues,
                  `Event "${e.name}" raised_by "${e.raised_by}" does not match any aggregate in context "${ctxName}".${didYouMean(key ?? e.raised_by, sets.aggregates)}`,
                  path("event", e.name),
                );
              }
            }
          }
          break;
        }
        case "command": {
          const c = item as Command;
          if (c.handled_by) {
            const verdict = resolveForeignRef(c.handled_by, "item", path("command", c.name));
            if (verdict.kind === "local") {
              const key = localNameKey(c.handled_by, ctxName);
              if (key === null || !sets.aggregates.has(key)) {
                err(
                  issues,
                  `Command "${c.name}" handled_by "${c.handled_by}" does not match any aggregate in context "${ctxName}".${didYouMean(key ?? c.handled_by, sets.aggregates)}`,
                  path("command", c.name),
                );
              }
            }
          }
          if (c.actor) {
            const verdict = resolveActorRef(c.actor, path("command", c.name));
            if (verdict.kind === "local" && !actorNames.has(verdict.key)) {
              err(
                issues,
                `Command "${c.name}" actor "${c.actor}" does not match any actor.${didYouMean(verdict.key, actorNames)}`,
                path("command", c.name),
              );
            }
          }
          break;
        }
        case "aggregate": {
          const a = item as Aggregate;
          for (const h of a.handles?.commands ?? []) {
            const verdict = resolveForeignRef(h, "item", path("aggregate", a.name));
            if (verdict.kind === "local") {
              const key = localNameKey(h, ctxName);
              if (key === null || !sets.commands.has(key)) {
                err(
                  issues,
                  `Aggregate "${a.name}" handles "${h}" but no such command in context "${ctxName}".${didYouMean(key ?? h, sets.commands)}`,
                  path("aggregate", a.name),
                );
              }
            }
          }
          for (const e of a.emits?.events ?? []) {
            const verdict = resolveForeignRef(e, "item", path("aggregate", a.name));
            if (verdict.kind === "local") {
              const key = localNameKey(e, ctxName);
              if (key === null || !sets.events.has(key)) {
                err(
                  issues,
                  `Aggregate "${a.name}" emits "${e}" but no such event in context "${ctxName}".${didYouMean(key ?? e, sets.events)}`,
                  path("aggregate", a.name),
                );
              }
            }
          }
          break;
        }
        case "policy": {
          const p = item as Policy;
          for (const t of p.when?.events ?? []) {
            const verdict = resolveForeignRef(t, "item", path("policy", p.name));
            if (verdict.kind === "local") {
              const key = localNameKey(t, ctxName);
              if (key === null || !sets.events.has(key)) {
                err(
                  issues,
                  `Policy "${p.name}" when.events "${t}" but no such event in context "${ctxName}".${didYouMean(key ?? t, sets.events)}`,
                  path("policy", p.name),
                );
              }
            }
          }
          for (const e of p.then?.commands ?? []) {
            const verdict = resolveForeignRef(e, "item", path("policy", p.name));
            if (verdict.kind === "local") {
              const key = localNameKey(e, ctxName);
              if (key === null || !sets.commands.has(key)) {
                err(
                  issues,
                  `Policy "${p.name}" then.commands "${e}" but no such command in context "${ctxName}".${didYouMean(key ?? e, sets.commands)}`,
                  path("policy", p.name),
                );
              }
            }
          }
          break;
        }
        case "read_model": {
          const r = item as ReadModel;
          for (const s of r.subscribes_to ?? []) {
            const verdict = resolveForeignRef(s, "item", path("read_model", r.name));
            if (verdict.kind === "local") {
              const key = localNameKey(s, ctxName);
              if (key === null || !sets.events.has(key)) {
                err(
                  issues,
                  `ReadModel "${r.name}" subscribes_to "${s}" but no such event in context "${ctxName}".${didYouMean(key ?? s, sets.events)}`,
                  path("read_model", r.name),
                );
              }
            }
          }
          for (const u of r.used_by ?? []) {
            const verdict = resolveActorRef(u, path("read_model", r.name));
            if (verdict.kind === "local" && !actorNames.has(verdict.key)) {
              err(
                issues,
                `ReadModel "${r.name}" used_by "${u}" but no such actor.${didYouMean(verdict.key, actorNames)}`,
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
      const verdict = resolveForeignRef(step.ref, "item", `flow:${flow.name}`);
      if (verdict.kind !== "local") continue;
      if (!domainItemIds.has(verdict.key)) {
        err(
          issues,
          `Flow "${flow.name}" step ref "${step.ref}" does not resolve to any domain item.${didYouMean(verdict.key, domainItemIds)}`,
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
  return join(import.meta.dirname, "../../../tools/dkk/schema");
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
