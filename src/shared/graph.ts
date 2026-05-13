/**
 * Domain graph — adjacency-list representation of domain model relationships.
 *
 * Nodes represent every domain item (event, command, policy, aggregate,
 * read-model, actor, ADR, flow). Edges capture the structural
 * relationships declared in the YAML model (handles, emits, triggers,
 * subscribes_to, actor, used_by, adr_refs, domain_refs, flow steps).
 *
 * The primary query surface is {@link DomainGraph.getRelated} which
 * performs a breadth-first traversal up to a specified depth.
 */

import type { DomainModel, DomainEvent, Command, Policy, Aggregate, ReadModel } from "./types/domain.js";
import { forEachItem, itemAdrRefs } from "./item-visitor.js";
import type { ItemType, AnyDomainItem } from "./item-visitor.js";
import { parseRef, qualifyItemRef, qualifyActorRef } from "./refs.js";

// ── Types ─────────────────────────────────────────────────────────────

/** The kind of domain item a node represents. */
export type NodeKind =
  | "context"
  | "event"
  | "command"
  | "policy"
  | "aggregate"
  | "read_model"
  | "actor"
  | "adr"
  | "glossary"
  | "flow";

/** A single node in the domain graph. */
export interface GraphNode {
  /** Unique identifier (e.g. "ordering.OrderPlaced", "actor.Customer"). */
  id: string;
  /** Kind of domain item. */
  kind: NodeKind;
  /** Human-readable display name. */
  name: string;
  /** Bounded-context name, when applicable. */
  context?: string;
}

/** An undirected edge between two nodes. */
export interface GraphEdge {
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** Describes the relationship (e.g. "handles", "emits", "adr_ref"). */
  label: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Build scoped id for a context-local item. */
function scopedId(context: string, name: string): string {
  return `${context}.${name}`;
}

/** Build id for an actor. */
function actorId(name: string): string {
  return `actor.${name}`;
}

/** Build id for a flow. */
function flowId(name: string): string {
  return `flow.${name}`;
}

// ── DomainGraph ───────────────────────────────────────────────────────

/**
 * Adjacency-list graph over every item in a {@link DomainModel}.
 *
 * Construct via the static factory {@link DomainGraph.from}.
 */
export class DomainGraph {
  /** All nodes keyed by id. */
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** All edges. */
  readonly edges: readonly GraphEdge[];

  /** Adjacency list: node id → set of neighbour ids. */
  private readonly adj: Map<string, Set<string>>;

  private constructor(
    nodes: Map<string, GraphNode>,
    edges: GraphEdge[],
    adj: Map<string, Set<string>>,
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.adj = adj;
  }

  // ── Factory ───────────────────────────────────────────────────────

  /**
   * Build a domain graph from a loaded {@link DomainModel}.
   *
   * Federation-aware: the local model is walked first, then each peer
   * model in `model.peers` is walked with its service name as a prefix.
   * Local node ids keep the bare grammar (`<ctx>.<Name>`, `actor.X`,
   * `adr-NNNN`, `flow.X`, `context.X`); peer node ids are prefixed
   * with `<peerService>:` so a local policy referencing
   * `ordering:ordering.OrderCancelled` connects through to the peer's
   * node by name.
   */
  static from(model: DomainModel): DomainGraph {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const adj = new Map<string, Set<string>>();
    const edgeKeys = new Set<string>();

    /** Ensure a node exists and return its id. */
    function ensureNode(id: string, kind: NodeKind, name: string, context?: string): string {
      const existing = nodes.get(id);
      if (!existing) {
        nodes.set(id, { id, kind, name, context });
        adj.set(id, new Set());
      } else if (existing.kind === "glossary" && kind !== "glossary") {
        // Structural kinds (aggregate, event, command, etc.) take precedence
        // over glossary when both share the same scoped ID within a context.
        existing.kind = kind;
      }
      return id;
    }

    /** Add an undirected edge (both directions in the adjacency list). */
    function addEdge(from: string, to: string, label: string): void {
      const key = `${from}\0${to}\0${label}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ from, to, label });
      adj.get(from)?.add(to);
      adj.get(to)?.add(from);
    }

    /** Wire adr_refs for any item. Adds the peer prefix when refs are bare. */
    function wireAdrRefs(itemId: string, adrRefs: string[] | undefined, prefix: string): void {
      if (!adrRefs) return;
      for (const ref of adrRefs) {
        // Author-qualified refs (already contain `:`) stay as-is; bare
        // refs are prefixed with this walk's service prefix.
        const nodeRefId = ref.includes(":") || !prefix ? ref : `${prefix}${ref}`;
        ensureNode(nodeRefId, "adr", nodeRefId);
        addEdge(itemId, nodeRefId, "adr_ref");
      }
    }

    /**
     * Walk one model (local or peer). When `walkPrefix` is set to
     * `"<peerName>:"`, every node id created inside this walk is
     * prefixed accordingly, so local + peer namespaces stay disjoint.
     */
    function walkOne(m: DomainModel, walkPrefix: string): void {
      // ── Actors ────────────────────────────────────────────────────
      for (const actor of m.actors) {
        const id = ensureNode(`${walkPrefix}${actorId(actor.name)}`, "actor", actor.name);
        wireAdrRefs(id, actor.adr_refs, walkPrefix);
      }

      // ── Bounded contexts & their items ────────────────────────────
      for (const [ctxName, ctx] of m.contexts) {
        const ctxId = ensureNode(`${walkPrefix}context.${ctxName}`, "context", ctxName);
        wireAdrRefs(ctxId, undefined, walkPrefix);

        forEachItem(ctx, (type: ItemType, name: string, item: AnyDomainItem) => {
          const nodeKind = type as NodeKind;
          const id = ensureNode(`${walkPrefix}${scopedId(ctxName, name)}`, nodeKind, name, ctxName);
          addEdge(ctxId, id, "contains");
          wireAdrRefs(id, itemAdrRefs(item), walkPrefix);

          switch (type) {
            case "event": {
              const evt = item as DomainEvent;
              if (evt.raised_by) {
                const res = qualifyItemRef(evt.raised_by, walkPrefix, ctxName);
                const aggId = ensureNode(res.id, "aggregate", res.name, res.context);
                addEdge(aggId, id, "emits");
              }
              break;
            }
            case "command": {
              const cmd = item as Command;
              if (cmd.handled_by) {
                const res = qualifyItemRef(cmd.handled_by, walkPrefix, ctxName);
                const aggId = ensureNode(res.id, "aggregate", res.name, res.context);
                addEdge(aggId, id, "handles");
              }
              if (cmd.actor) {
                const a = qualifyActorRef(cmd.actor, walkPrefix);
                const aId = ensureNode(a.id, "actor", a.name);
                addEdge(aId, id, "initiates");
              }
              break;
            }
            case "policy": {
              const pol = item as Policy;
              for (const trigger of pol.when?.events ?? []) {
                const res = qualifyItemRef(trigger, walkPrefix, ctxName);
                const evtId = ensureNode(res.id, "event", res.name, res.context);
                addEdge(evtId, id, "triggers");
              }
              for (const emitted of pol.then?.commands ?? []) {
                const res = qualifyItemRef(emitted, walkPrefix, ctxName);
                const cmdId = ensureNode(res.id, "command", res.name, res.context);
                addEdge(id, cmdId, "emits");
              }
              break;
            }
            case "aggregate": {
              const agg = item as Aggregate;
              for (const h of agg.handles?.commands ?? []) {
                const res = qualifyItemRef(h, walkPrefix, ctxName);
                const cmdId = ensureNode(res.id, "command", res.name, res.context);
                addEdge(id, cmdId, "handles");
              }
              for (const e of agg.emits?.events ?? []) {
                const res = qualifyItemRef(e, walkPrefix, ctxName);
                const evtId = ensureNode(res.id, "event", res.name, res.context);
                addEdge(id, evtId, "emits");
              }
              break;
            }
            case "read_model": {
              const rm = item as ReadModel;
              for (const sub of rm.subscribes_to ?? []) {
                const res = qualifyItemRef(sub, walkPrefix, ctxName);
                const evtId = ensureNode(res.id, "event", res.name, res.context);
                addEdge(id, evtId, "subscribes_to");
              }
              for (const user of rm.used_by ?? []) {
                const a = qualifyActorRef(user, walkPrefix);
                const aId = ensureNode(a.id, "actor", a.name);
                addEdge(id, aId, "used_by");
              }
              break;
            }
            case "glossary":
              // Glossary items have no type-specific relationship wiring.
              break;
          }
        });
      }

      // ── ADRs ──────────────────────────────────────────────────────
      for (const [adrIdRaw, adr] of m.adrs) {
        const adrNodeId = `${walkPrefix}${adrIdRaw}`;
        ensureNode(adrNodeId, "adr", adr.title);

        // domain_refs → domain items. Use parseRef to split correctly
        // for both bare and service-prefixed forms.
        for (const ref of adr.domain_refs ?? []) {
          const parsed = parseRef(ref);
          if (parsed?.kind === "item" && parsed.service) {
            // Explicit peer ref — keep as-is.
            const id = `${parsed.service}:${parsed.context}.${parsed.name}`;
            ensureNode(id, "aggregate", parsed.name, parsed.context);
            addEdge(adrNodeId, id, "domain_ref");
          } else if (parsed?.kind === "item") {
            // Bare ref — prefix with this walk's service.
            const id = `${walkPrefix}${parsed.context}.${parsed.name}`;
            ensureNode(id, "aggregate", parsed.name, parsed.context);
            addEdge(adrNodeId, id, "domain_ref");
          } else {
            // Unparseable — record edge against the raw form so
            // visibility is preserved even though the node is dangling.
            ensureNode(ref, "aggregate", ref);
            addEdge(adrNodeId, ref, "domain_ref");
          }
        }

        // superseded_by → another ADR
        if (adr.superseded_by) {
          const parsed = parseRef(adr.superseded_by);
          const targetId =
            parsed?.kind === "adr"
              ? parsed.service
                ? `${parsed.service}:${parsed.id}`
                : `${walkPrefix}${parsed.id}`
              : adr.superseded_by;
          ensureNode(targetId, "adr", targetId);
          addEdge(adrNodeId, targetId, "superseded_by");
        }
      }

      // ── Flows ─────────────────────────────────────────────────────
      for (const flow of m.index.flows ?? []) {
        const fId = ensureNode(`${walkPrefix}${flowId(flow.name)}`, "flow", flow.name);

        let prevStepId: string | undefined;
        for (const step of flow.steps) {
          const raw = step.ref as string;
          const parsed = parseRef(raw);
          let stepId: string;
          let ctx: string | undefined;
          let name: string;
          if (parsed?.kind === "item" && parsed.service) {
            stepId = `${parsed.service}:${parsed.context}.${parsed.name}`;
            ctx = parsed.context;
            name = parsed.name;
          } else if (parsed?.kind === "item") {
            stepId = `${walkPrefix}${parsed.context}.${parsed.name}`;
            ctx = parsed.context;
            name = parsed.name;
          } else {
            stepId = raw;
            const dot = raw.indexOf(".");
            ctx = dot > 0 ? raw.slice(0, dot) : undefined;
            name = dot > 0 ? raw.slice(dot + 1) : raw;
          }
          const kind = step.type === "read_model" ? "read_model" : step.type;
          ensureNode(stepId, kind as NodeKind, name, ctx);
          addEdge(fId, stepId, "flow_step");
          if (prevStepId) {
            addEdge(prevStepId, stepId, "flow_next");
          }
          prevStepId = stepId;
        }
      }
    }

    // Local walk (no prefix).
    walkOne(model, "");

    // Peer walks, one prefix per peer.
    for (const [peerName, peerModel] of model.peers ?? []) {
      try {
        walkOne(peerModel, `${peerName}:`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`dkk: skipped graphing peer "${peerName}": ${msg}`);
      }
    }

    return new DomainGraph(nodes, edges, adj);
  }

  // ── Queries ───────────────────────────────────────────────────────

  /**
   * Return the set of node ids reachable from `startId` within `depth`
   * hops (BFS). The start node itself is **not** included unless it is
   * reachable via a cycle within the depth limit.
   *
   * @param startId  The id of the node to start from.
   * @param depth    Maximum traversal depth (default: 1).
   * @returns A set of related node ids.
   */
  getRelated(startId: string, depth: number = 1): Set<string> {
    const result = new Set<string>();
    if (!this.adj.has(startId)) return result;

    const visited = new Set<string>([startId]);
    let frontier = [startId];

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        for (const neighbour of this.adj.get(nodeId) ?? []) {
          if (!visited.has(neighbour)) {
            visited.add(neighbour);
            result.add(neighbour);
            next.push(neighbour);
          }
        }
      }
      frontier = next;
    }

    return result;
  }

  /**
   * Return direct neighbours of a node (shorthand for depth-1 traversal).
   */
  getNeighbours(nodeId: string): Set<string> {
    return new Set(this.adj.get(nodeId) ?? []);
  }

  /**
   * Check whether a node id exists in the graph.
   */
  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }
}
