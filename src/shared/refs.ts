/**
 * Reference parsing — single source of truth for DKK item-id grammar.
 *
 * IDs identify domain items, actors, ADRs, flows, and contexts. The
 * grammar is additive: an optional `<service>:` prefix may be attached
 * to any id to federate it across repos. Bare refs stay local-only.
 *
 * Forms:
 *   <ctx>.<Name>             →  context-scoped item
 *   actor.<Name>             →  actor
 *   adr-NNNN                 →  ADR
 *   flow.<Name>              →  cross-context flow
 *   context.<name>           →  bounded context itself
 *   <service>:<any of above> →  federated form
 */

/** Kebab-case service / context identifier. */
const KEBAB = /^[a-z][a-z0-9-]*$/;
/** PascalCase item name (events, commands, etc.). */
const PASCAL = /^[A-Za-z][A-Za-z0-9]*$/;
/** ADR id pattern (`adr-NNNN`). */
const ADR_ID = /^adr-\d{4}$/;

/** Discriminated union over the five id shapes. */
export type ParsedRef =
  | { kind: "item"; service?: string; context: string; name: string }
  | { kind: "adr"; service?: string; id: string }
  | { kind: "actor"; service?: string; name: string }
  | { kind: "flow"; service?: string; name: string }
  | { kind: "context"; service?: string; name: string };

/**
 * Parse a ref string into its structured form. Returns `null` for
 * inputs that do not match any of the five shapes.
 *
 * @example
 * parseRef("ordering.OrderPlaced")
 * // → { kind: "item", context: "ordering", name: "OrderPlaced" }
 *
 * parseRef("payments:billing.PaymentCaptured")
 * // → { kind: "item", service: "payments", context: "billing", name: "PaymentCaptured" }
 *
 * parseRef("adr-0001")
 * // → { kind: "adr", id: "adr-0001" }
 *
 * parseRef("ordering:adr-0007")
 * // → { kind: "adr", service: "ordering", id: "adr-0007" }
 */
export function parseRef(s: string): ParsedRef | null {
  if (typeof s !== "string" || s.length === 0) return null;

  // Peel off optional service prefix.
  let service: string | undefined;
  let body = s;
  const colon = s.indexOf(":");
  if (colon > 0) {
    const svc = s.slice(0, colon);
    if (!KEBAB.test(svc)) return null;
    service = svc;
    body = s.slice(colon + 1);
    if (body.length === 0) return null;
  }

  // ADR: "adr-NNNN"
  if (ADR_ID.test(body)) {
    return { kind: "adr", service, id: body };
  }

  // Special-prefix forms: "actor.X", "flow.X", "context.X"
  if (body.startsWith("actor.")) {
    const name = body.slice("actor.".length);
    if (!PASCAL.test(name)) return null;
    return { kind: "actor", service, name };
  }
  if (body.startsWith("flow.")) {
    const name = body.slice("flow.".length);
    if (name.length === 0) return null;
    return { kind: "flow", service, name };
  }
  if (body.startsWith("context.")) {
    const name = body.slice("context.".length);
    if (!KEBAB.test(name)) return null;
    return { kind: "context", service, name };
  }

  // Generic context-scoped item: "<ctx>.<Name>"
  const dot = body.indexOf(".");
  if (dot > 0) {
    const ctx = body.slice(0, dot);
    const name = body.slice(dot + 1);
    if (KEBAB.test(ctx) && PASCAL.test(name)) {
      return { kind: "item", service, context: ctx, name };
    }
  }

  return null;
}

/**
 * Result of qualifying a name-only or partial ref into its canonical
 * graph/index id form. Used by the indexer and graph builders to
 * produce service-prefixed ids consistently.
 */
export interface QualifiedRef {
  /** Canonical id (e.g. `ordering.OrderPlaced` or `payments:billing.PaymentCaptured`). */
  id: string;
  /** Bounded-context name, when the ref names a context-scoped item. */
  context?: string;
  /** Item / actor / flow / context name as written. */
  name: string;
  /** True when the ref points at a service different from the walk prefix. */
  isForeign: boolean;
}

/**
 * Qualify a bare-or-federated item ref into a canonical id form.
 *
 * Three input shapes are handled:
 *  - Author-qualified federated form (`<svc>:<ctx>.<Name>`) → kept as-is,
 *    marked foreign whenever it differs from `walkPrefix`.
 *  - Author-qualified context form (`<ctx>.<Name>`, no service) →
 *    gets `walkPrefix` applied so peer walks namespace it correctly.
 *  - Bare PascalCase name (`Name`) → resolved as a name in
 *    `currentContext`, then prefixed with `walkPrefix`.
 *
 * `walkPrefix` is `""` for local walks and `"<peerName>:"` for peer
 * walks. The function leaves any already-prefixed ref untouched so
 * a peer's own author-written federated refs survive the prefix pass.
 */
export function qualifyItemRef(
  raw: string,
  walkPrefix: string,
  currentContext: string,
): QualifiedRef {
  const parsed = parseRef(raw);

  if (parsed?.kind === "item" && parsed.service) {
    // Author-qualified federated form: `<svc>:<ctx>.<Name>`.
    return {
      id: `${parsed.service}:${parsed.context}.${parsed.name}`,
      context: parsed.context,
      name: parsed.name,
      isForeign: walkPrefix !== `${parsed.service}:`,
    };
  }

  if (parsed?.kind === "item") {
    // Author-qualified context form (`<ctx>.<Name>`, no service).
    return {
      id: `${walkPrefix}${parsed.context}.${parsed.name}`,
      context: parsed.context,
      name: parsed.name,
      isForeign: false,
    };
  }

  // Bare name fallback (`OrderPlaced` in YAML inter-item refs such as
  // raised_by, handles.commands, when.events, …).
  if (raw.includes(":")) {
    // Author wrote a colon but it didn't parse as `<svc>:<ctx>.<Name>`.
    // Leave as-is so the caller can surface a clear "malformed" error
    // elsewhere; treat as foreign so the prefix isn't applied.
    return { id: raw, name: raw, isForeign: true };
  }
  return {
    id: `${walkPrefix}${currentContext}.${raw}`,
    context: currentContext,
    name: raw,
    isForeign: false,
  };
}

/**
 * Qualify a bare-or-federated actor ref. Actor ids use the
 * `actor.<Name>` form (no context). Federated form is
 * `<service>:actor.<Name>`. Bare YAML form is just `<Name>`.
 */
export function qualifyActorRef(raw: string, walkPrefix: string): QualifiedRef {
  const parsed = parseRef(raw);

  if (parsed?.kind === "actor" && parsed.service) {
    return {
      id: `${parsed.service}:actor.${parsed.name}`,
      name: parsed.name,
      isForeign: walkPrefix !== `${parsed.service}:`,
    };
  }
  if (parsed?.kind === "actor") {
    return {
      id: `${walkPrefix}actor.${parsed.name}`,
      name: parsed.name,
      isForeign: false,
    };
  }

  // Bare PascalCase actor name (the dominant case in YAML).
  if (raw.includes(":")) {
    return { id: raw, name: raw, isForeign: true };
  }
  return { id: `${walkPrefix}actor.${raw}`, name: raw, isForeign: false };
}

/** Serialize a {@link ParsedRef} back into its canonical string form. */
export function formatRef(r: ParsedRef): string {
  const prefix = r.service ? `${r.service}:` : "";
  switch (r.kind) {
    case "item":
      return `${prefix}${r.context}.${r.name}`;
    case "adr":
      return `${prefix}${r.id}`;
    case "actor":
      return `${prefix}actor.${r.name}`;
    case "flow":
      return `${prefix}flow.${r.name}`;
    case "context":
      return `${prefix}context.${r.name}`;
  }
}

