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
   */
  static from(model: DomainModel): DomainGraph {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const adj = new Map<string, Set<string>>();

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
      edges.push({ from, to, label });
      adj.get(from)?.add(to);
      adj.get(to)?.add(from);
    }

    /** Wire adr_refs for any item. */
    function wireAdrRefs(itemId: string, adrRefs: string[] | undefined): void {
      if (!adrRefs) return;
      for (const ref of adrRefs) {
        // ADR node might not exist yet if the ADR file wasn't present;
        // we still create a placeholder node so the edge is recorded.
        ensureNode(ref, "adr", ref);
        addEdge(itemId, ref, "adr_ref");
      }
    }

    // ── Actors ────────────────────────────────────────────────────

    for (const actor of model.actors) {
      const id = ensureNode(actorId(actor.name), "actor", actor.name);
      wireAdrRefs(id, actor.adr_refs);
    }

    // ── Bounded contexts & their items ────────────────────────────

    for (const [ctxName, ctx] of model.contexts) {
      const ctxId = ensureNode(`context.${ctxName}`, "context", ctxName);
      wireAdrRefs(ctxId, undefined); // contexts don't have adr_refs currently

      // Visit all item types: create node, add contains edge, wire ADR refs,
      // then apply type-specific relationship wiring.
      forEachItem(ctx, (type: ItemType, name: string, item: AnyDomainItem) => {
        const nodeKind = type as NodeKind;
        const id = ensureNode(scopedId(ctxName, name), nodeKind, name, ctxName);
        addEdge(ctxId, id, "contains");
        wireAdrRefs(id, itemAdrRefs(item));

        // Type-specific relationship wiring
        switch (type) {
          case "event": {
            const evt = item as DomainEvent;
            if (evt.raised_by) {
              const aggId = ensureNode(scopedId(ctxName, evt.raised_by), "aggregate", evt.raised_by, ctxName);
              addEdge(aggId, id, "emits");
            }
            break;
          }
          case "command": {
            const cmd = item as Command;
            if (cmd.handled_by) {
              const aggId = ensureNode(scopedId(ctxName, cmd.handled_by), "aggregate", cmd.handled_by, ctxName);
              addEdge(aggId, id, "handles");
            }
            if (cmd.actor) {
              const aId = ensureNode(actorId(cmd.actor), "actor", cmd.actor);
              addEdge(aId, id, "initiates");
            }
            break;
          }
          case "policy": {
            const pol = item as Policy;
            for (const trigger of pol.when?.events ?? []) {
              const evtId = ensureNode(scopedId(ctxName, trigger), "event", trigger, ctxName);
              addEdge(evtId, id, "triggers");
            }
            for (const emitted of pol.then?.commands ?? []) {
              const cmdId = ensureNode(scopedId(ctxName, emitted), "command", emitted, ctxName);
              addEdge(id, cmdId, "emits");
            }
            break;
          }
          case "aggregate": {
            const agg = item as Aggregate;
            for (const h of agg.handles?.commands ?? []) {
              const cmdId = ensureNode(scopedId(ctxName, h), "command", h, ctxName);
              addEdge(id, cmdId, "handles");
            }
            for (const e of agg.emits?.events ?? []) {
              const evtId = ensureNode(scopedId(ctxName, e), "event", e, ctxName);
              addEdge(id, evtId, "emits");
            }
            break;
          }
          case "read_model": {
            const rm = item as ReadModel;
            for (const sub of rm.subscribes_to ?? []) {
              const evtId = ensureNode(scopedId(ctxName, sub), "event", sub, ctxName);
              addEdge(id, evtId, "subscribes_to");
            }
            for (const user of rm.used_by ?? []) {
              const aId = ensureNode(actorId(user), "actor", user);
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

    for (const [adrId, adr] of model.adrs) {
      ensureNode(adrId, "adr", adr.title);

      // domain_refs → domain items
      for (const ref of adr.domain_refs ?? []) {
        // ref is in "context.Name" format — ensure node exists
        const dotIdx = ref.indexOf(".");
        if (dotIdx > 0) {
          const ctx = ref.slice(0, dotIdx);
          const name = ref.slice(dotIdx + 1);
          // We don't know the item kind from the ref alone; default to
          // a generic node that will be reconciled if it was already created.
          ensureNode(ref, "aggregate", name, ctx);
        }
        addEdge(adrId, ref, "domain_ref");
      }

      // superseded_by → another ADR
      if (adr.superseded_by) {
        ensureNode(adr.superseded_by, "adr", adr.superseded_by);
        addEdge(adrId, adr.superseded_by, "superseded_by");
      }
    }

    // ── Flows ─────────────────────────────────────────────────────

    for (const flow of model.index.flows ?? []) {
      const fId = ensureNode(flowId(flow.name), "flow", flow.name);

      let prevStepId: string | undefined;
      for (const step of flow.steps) {
        const ref = step.ref as string;
        const dotIdx = ref.indexOf(".");
        const ctx = dotIdx > 0 ? ref.slice(0, dotIdx) : undefined;
        const name = dotIdx > 0 ? ref.slice(dotIdx + 1) : ref;
        const kind = step.type === "read_model" ? "read_model" : step.type;

        ensureNode(ref, kind as NodeKind, name, ctx);
        addEdge(fId, ref, "flow_step");

        // Link consecutive flow steps
        if (prevStepId) {
          addEdge(prevStepId, ref, "flow_next");
        }
        prevStepId = ref;
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
