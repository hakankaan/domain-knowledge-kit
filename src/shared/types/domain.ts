/**
 * TypeScript interfaces for all domain item types.
 * These align with the JSON Schemas under tools/dkk/schema/.
 */

// ── Shared ────────────────────────────────────────────────────────────

/** A typed field carried by events or commands. */
export interface Field {
  /** Field name. */
  name: string;
  /** Field type (e.g. "string", "UUID", "Money"). */
  type: string;
  /** Optional human-readable description. */
  description?: string;
}

/** ADR reference in the form "adr-NNNN". */
export type AdrRef = `adr-${string}`;

/** A given/when/then scenario example for an event or command. */
export interface Example {
  /** Short human-readable description of the scenario. */
  description: string;
  /** Pre-conditions (given). */
  given?: string[];
  /** Trigger / action (when). */
  when?: string[];
  /** Expected outcomes (then). */
  then?: string[];
}

/** Domain item reference in context.Name format (e.g. "ordering.OrderPlaced"). */
export type DomainRef = `${string}.${string}`;

// ── Glossary ──────────────────────────────────────────────────────────

/** A ubiquitous-language term within a bounded context. */
export interface GlossaryEntry {
  /** The canonical term name. */
  term: string;
  /** Plain-language definition. */
  definition: string;
  /** Alternative names for this term. */
  aliases?: string[];
  /** Related ADR identifiers. */
  adr_refs?: AdrRef[];
}

// ── Actor ─────────────────────────────────────────────────────────────

/** Whether the actor is a person, internal system, or external system. */
export type ActorType = "human" | "system" | "external";

/** A person or system that interacts with the domain. */
export interface Actor {
  /** Actor display name (e.g. "Customer", "Payment Gateway"). */
  name: string;
  /** Kind of actor. */
  type: ActorType;
  /** What role this actor plays in the domain. */
  description: string;
  /** What this actor can do, expressed in domain language. */
  capabilities?: string[];
  /** How this actor can fail, expressed in domain language. */
  failure_modes?: string[];
  /** Related ADR identifiers. */
  adr_refs?: AdrRef[];
}

/** Top-level actors definition file shape (.dkk/domain/actors.yml). */
export interface ActorsFile {
  actors: Actor[];
}

// ── Domain Event ──────────────────────────────────────────────────────

/** A domain event raised within a bounded context. */
export interface DomainEvent {
  /** PascalCase event name (e.g. "OrderPlaced"). */
  name: string;
  /** What this event signifies in the domain. */
  description: string;
  /** Payload fields carried by this event. */
  fields?: Field[];
  /** Name of the aggregate that raises this event. */
  raised_by?: string;
  /** Given/when/then usage scenarios. */
  examples?: Example[];
  /** Business invariants / rules that must hold when this event is raised. */
  invariants?: string[];
  /** Related ADR identifiers. */
  adr_refs?: AdrRef[];
}

// ── Command ───────────────────────────────────────────────────────────

/** A command handled by an aggregate within a bounded context. */
export interface Command {
  /** PascalCase command name (e.g. "PlaceOrder"). */
  name: string;
  /** What this command instructs the system to do. */
  description: string;
  /** Input fields for this command. */
  fields?: Field[];
  /** Name of the actor that initiates this command. */
  actor?: string;
  /** Name of the aggregate that handles this command. */
  handled_by?: string;
  /** Conditions that must be true before this command can be accepted. */
  preconditions?: string[];
  /** Reasons this command may be rejected. */
  rejections?: string[];
  /** Business invariants / rules that must hold when this event is raised. */
  invariants?: string[];
  /** Given/when/then usage scenarios. */
  examples?: Example[];
  /** Related ADR identifiers. */
  adr_refs?: AdrRef[];
}

// ── Policy ────────────────────────────────────────────────────────────

/** A reactive policy that listens to events and emits commands. */
export interface Policy {
  /** PascalCase policy name (e.g. "SendConfirmationEmail"). */
  name: string;
  /** What this policy does in response to events. */
  description: string;
  /** Conditions that activate this policy (nested: when.events). */
  when?: { events?: string[] };
  /** Actions taken by this policy (nested: then.commands). */
  then?: { commands?: string[] };
  /** Related ADR identifiers. */
  adr_refs?: AdrRef[];
}

// ── Aggregate ─────────────────────────────────────────────────────────

/** A domain aggregate that handles commands and emits events. */
export interface Aggregate {
  /** PascalCase aggregate name (e.g. "Order"). */
  name: string;
  /** What this aggregate represents in the domain. */
  description: string;
  /** Commands handled by this aggregate (nested: handles.commands). */
  handles?: { commands?: string[] };
  /** Events emitted by this aggregate (nested: emits.events). */
  emits?: { events?: string[] };
  /** Business invariants / rules enforced by this aggregate. */
  invariants?: string[];
  /** Related ADR identifiers. */
  adr_refs?: AdrRef[];
}

// ── Read Model ────────────────────────────────────────────────────────

/** A read model (projection) built from domain events. */
export interface ReadModel {
  /** PascalCase read model name (e.g. "OrderSummary"). */
  name: string;
  /** What data this read model exposes. */
  description: string;
  /** Data fields exposed by this read model. */
  fields?: Field[];
  /** Event names this read model subscribes to. */
  subscribes_to?: string[];
  /** Actor names that consume this read model. */
  used_by?: string[];
  /** Related ADR identifiers. */
  adr_refs?: AdrRef[];
}

// ── Context Meta File ─────────────────────────────────────────────────

/**
 * Context metadata file shape (.dkk/domain/contexts/<name>/context.yml).
 * Contains only identity and glossary; item arrays live in typed
 * sub-directories (events/, commands/, policies/, aggregates/, read-models/).
 */
export interface ContextMetaFile {
  /** Kebab-case context identifier (e.g. "ordering"). */
  name: string;
  /** What this bounded context is responsible for. */
  description: string;
  /** Ubiquitous-language terms scoped to this context. */
  glossary?: GlossaryEntry[];
  /**
   * Repo-relative POSIX glob patterns binding this context to the
   * source paths it models (e.g. "apps/api/src/billing/**"). Consumed
   * by `dkk drift` for freshness/coverage checks.
   */
  code_refs?: string[];
  /** ADRs constraining this context as a whole. */
  adr_refs?: AdrRef[];
}

// ── Bounded Context ───────────────────────────────────────────────────

/** A bounded context assembled from per-item YAML files. */
export interface DomainContext {
  /** Kebab-case context identifier (e.g. "ordering"). */
  name: string;
  /** What this bounded context is responsible for. */
  description: string;
  /** Ubiquitous-language terms scoped to this context. */
  glossary?: GlossaryEntry[];
  /** Repo-relative glob patterns binding this context to source paths (see ContextMetaFile.code_refs). */
  code_refs?: string[];
  /** ADRs constraining this context as a whole. */
  adr_refs?: AdrRef[];
  /** Domain events raised within this context. */
  events?: DomainEvent[];
  /** Commands handled within this context. */
  commands?: Command[];
  /** Reactive policies within this context. */
  policies?: Policy[];
  /** Aggregates within this context. */
  aggregates?: Aggregate[];
  /** Read models (projections) within this context. */
  read_models?: ReadModel[];
}

// ── ADR ───────────────────────────────────────────────────────────────

/** Lifecycle status of an Architecture Decision Record. */
export type AdrStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "deprecated"
  | "superseded";

/** A level-2 section of an ADR body, split on its Markdown heading. */
export interface AdrSection {
  /** Heading text as written (e.g. "Alternatives Considered"). */
  heading: string;
  /** Lower-kebab slug of the heading, used for `--section` lookups. */
  slug: string;
  /** Raw Markdown between this heading and the next one of the same level. */
  body: string;
}

/** Frontmatter metadata for an Architecture Decision Record. */
export interface AdrRecord {
  /** Stable ADR identifier (e.g. "adr-0001"). */
  id: AdrRef;
  /** Human-readable title of the decision. */
  title: string;
  /** Current lifecycle status. */
  status: AdrStatus;
  /** ISO-8601 date when the decision was recorded (YYYY-MM-DD). */
  date: string;
  /** People involved in making this decision. */
  deciders?: string[];
  /** Domain items, contexts, actors, or flows related to this decision. */
  domain_refs?: string[];
  /** ID of the ADR that supersedes this one. */
  superseded_by?: AdrRef;
  /** ADR id(s) this decision replaces (the forward half of the chain). */
  supersedes?: AdrRef[];
  /** Free-form labels for filtering (e.g. "security", "storage"). */
  tags?: string[];
  /** External references — ticket, PR, RFC, or design-doc URLs. */
  links?: string[];
  /** Glob patterns binding this decision to the code it constrains. */
  code_refs?: string[];
  /** Date by which a `proposed` decision should be revisited (YYYY-MM-DD). */
  review_by?: string;

  // ── Runtime-only (computed at load time, never on disk) ─────────────

  /** Raw Markdown body — everything after the closing `---`. */
  body?: string;
  /** `body` split into its level-2 sections, in document order. */
  sections?: AdrSection[];
  /** Absolute path of the file this record was loaded from. */
  file?: string;
}

/**
 * A file under `.dkk/adr/` that could not be loaded as an ADR, or an
 * ADR whose identity collides with another file's.
 *
 * Collected by the loader rather than thrown, so one broken decision
 * record cannot take down the whole model. The validator turns these
 * into findings against the offending path.
 */
export interface AdrLoadIssue {
  /** Absolute path of the offending file. */
  file: string;
  /** What is wrong with it. */
  message: string;
  /** Blocking (a broken ADR) vs informational (probably not an ADR). */
  severity: "error" | "warning";
}

// ── Domain Index ──────────────────────────────────────────────────────

/** A reference to a registered bounded context in the index. */
export interface ContextEntry {
  /** Context identifier matching a file under .dkk/domain/contexts/. */
  name: string;
  /** Short summary of the bounded context. */
  description?: string;
}

/** Step type within a cross-context flow. */
export type FlowStepType = "command" | "event" | "policy" | "read_model";

/** A single step in a cross-context flow. */
export interface FlowStep {
  /** Domain item reference in context.Name format. */
  ref: DomainRef;
  /** Type of the referenced domain item. */
  type: FlowStepType;
  /** Optional annotation for this step. */
  note?: string;
}

/** A cross-context flow linking domain items in sequence. */
export interface Flow {
  /** Flow name. */
  name: string;
  /** What this flow accomplishes. */
  description?: string;
  /** Ordered sequence of domain item references forming the flow. */
  steps: FlowStep[];
  /** ADRs constraining this flow. */
  adr_refs?: AdrRef[];
}

/** Top-level domain index file shape (.dkk/domain/index.yml). */
export interface DomainIndex {
  /** Registered bounded contexts. */
  contexts: ContextEntry[];
  /** Cross-context flows linking domain items in sequence. */
  flows?: Flow[];
}

// ── Container ─────────────────────────────────────────────────────────

/** Complete domain model loaded from all YAML and ADR files. */
export interface DomainModel {
  /** Top-level domain index. */
  index: DomainIndex;
  /** All actors. */
  actors: Actor[];
  /** All bounded contexts keyed by context name. */
  contexts: Map<string, DomainContext>;
  /** All ADR records keyed by ADR id. */
  adrs: Map<string, AdrRecord>;
  /**
   * Files under `.dkk/adr/` that failed to load, and id collisions
   * between ADRs. Empty/absent when every ADR loaded cleanly.
   */
  adrIssues?: AdrLoadIssue[];
  /**
   * Service identity for this repo (federation). Present when a
   * `.dkk/service.yml` was found; otherwise `undefined`. Legacy
   * unfederated repos keep working unchanged.
   */
  service?: import("./federation.js").ServiceManifest;
  /**
   * Peer service models loaded from `.dkk/federation.yml`. Keyed by
   * peer service name. Each value is a fully-loaded `DomainModel`
   * (one level deep — peer's own peers are not transitively followed).
   * Present only when federation is configured and at least one peer
   * was reachable.
   */
  peers?: Map<string, DomainModel>;
}
