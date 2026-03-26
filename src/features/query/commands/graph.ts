import type { Command as Cmd } from "commander";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDomainModel } from "../../../shared/loader.js";
import { DomainGraph } from "../../../shared/graph.js";
import type { GraphNode, GraphEdge } from "../../../shared/graph.js";
import type { Flow } from "../../../shared/types/domain.js";

// ── Helpers ───────────────────────────────────────────────────────────

/** Replace every non-alphanumeric character with underscore. */
function mermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Escape a label string for use inside a Mermaid node shape.
 * Double-quotes inside labels would break the syntax.
 */
function mermaidLabel(name: string): string {
  return name.replace(/"/g, "'");
}

function nodeShape(node: GraphNode): string {
  const l = mermaidLabel(node.name);
  switch (node.kind) {
    case "event":      return `>${l}]`;
    case "command":    return `([${l}])`;
    case "aggregate":  return `[[${l}]]`;
    case "policy":     return `{{${l}}}`;
    case "read_model": return `[(${l})]`;
    case "actor":      return `((${l}))`;
    case "flow":       return `[/${l}/]`;
    case "adr":        return `{${l}}`;
    case "context":    return `[${l}]`;
    case "glossary":   return `[${l}]`;
    default:           return `[${l}]`;
  }
}

const SKIP_LABELS = new Set(["contains", "flow_next", "adr_ref", "domain_ref"]);

const VALID_KINDS = new Set([
  "event", "command", "aggregate", "policy", "read_model",
  "actor", "flow", "adr", "glossary",
]);

function edgeArrow(label: string): string {
  if (label === "subscribes_to" || label === "used_by") return `-.->`;
  if (label === "handles") return `==>`;
  return `-->`;
}

/**
 * Generates a Mermaid sequence diagram for a specific flow.
 */
export function generateFlowSequence(flow: Flow, graph: DomainGraph): string {
  const lines: string[] = ["```mermaid", "sequenceDiagram"];
  const participants = new Map<string, string>(); // safeId -> declaration
  const steps: string[] = [];

  function addParticipant(id: string, label: string): string {
    const safeId = mermaidId(id);
    if (!participants.has(safeId)) {
      participants.set(safeId, `    participant ${safeId} as ${mermaidLabel(label)}`);
    }
    return safeId;
  }

  const defaultActorId = addParticipant("actor_User", "User");

  for (const step of flow.steps) {
    const node = graph.nodes.get(step.ref);
    if (!node) {
      steps.push(`    %% Missing node: ${step.ref}`);
      continue;
    }

    const tCtx = node.context;
    const targetId = tCtx 
      ? addParticipant(`ctx_${tCtx}`, tCtx)
      : addParticipant("System", "System");

    if (node.kind === "command") {
      let actorId = defaultActorId;
      for (const edge of graph.edges) {
        if (edge.to === node.id && edge.label === "initiates") {
          const actorNode = graph.nodes.get(edge.from);
          if (actorNode) {
            actorId = addParticipant(actorNode.id, actorNode.name);
            break;
          }
        }
      }
      steps.push(`    ${actorId}->>${targetId}: ${node.name}`);
    } else if (node.kind === "event") {
      steps.push(`    ${targetId}-->>${targetId}: ${node.name}`);
    } else if (node.kind === "policy") {
      steps.push(`    ${targetId}->>${targetId}: [Policy] ${node.name}`);
    } else if (node.kind === "read_model") {
      steps.push(`    ${targetId}-->>${targetId}: [Read] ${node.name}`);
    } else {
      steps.push(`    ${targetId}->>${targetId}: ${node.name}`);
    }
  }

  for (const p of participants.values()) {
    lines.push(p);
  }
  lines.push("");
  for (const s of steps) {
    lines.push(s);
  }
  lines.push("```");

  return lines.join("\n");
}

// ── Registration ──────────────────────────────────────────────────────

export function registerGraph(program: Cmd): void {
  program    .command("graph")
    .description("Generate a Mermaid.js diagram of the domain model")
    .option("-o, --output <file>", "Output file path (default: .dkk/docs/graph.md)")
    .option("-t, --type <type>", "Type of diagram: flowchart or swimlane", "flowchart")
    .option("-d, --depth <n>", "Max BFS depth from aggregates/actors (default: 3)", parseInt, 3)
    .option("-c, --context <name>", "Render only items from this bounded context")
    .option("-l, --layout <dir>", "Flowchart direction: LR (left-to-right) or TD (top-down)", "LR")
    .option("-n, --node-types <types>", "Comma-separated node kinds to include (e.g. event,command,aggregate)")
    .option("-r, --root <path>", "Override repository root")
    .action(
      (opts: {
        root?: string;
        output?: string;
        type: string;
        depth: number;
        context?: string;
        layout: string;
        nodeTypes?: string;
      }) => {
        const model = loadDomainModel({ root: opts.root });
        const graph = DomainGraph.from(model);

        const outPath =
          opts.output ||
          (opts.root
            ? join(opts.root, ".dkk", "docs", "graph.md")
            : join(process.cwd(), ".dkk", "docs", "graph.md"));

        if (opts.type === "swimlane") {
          const flows = model.index.flows ?? [];
          if (flows.length === 0) {
            console.log("No flows defined in the domain model.");
            process.exit(0);
          }
          const chunks = flows.map((f) => `## ${f.name}\n\n${generateFlowSequence(f, graph)}`);
          const content = chunks.join("\n\n");
          try {
            writeFileSync(outPath, content, "utf-8");
            console.log(`Generated Mermaid swimlane diagrams at ${outPath}`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Failed to write graph to ${outPath}:`, msg);
            process.exit(1);
          }
          return;
        }

        // ── 1. Determine visible node set ────────────────────────────
        let visibleIds: Set<string>;

        if (opts.context) {
          // Only items belonging to the requested context (and actors/flows
          // that have an edge to one of those items within depth).
          const ctxItems = new Set<string>(
            [...graph.nodes.values()]
              .filter((n) => n.context === opts.context)
              .map((n) => n.id),
          );
          visibleIds = new Set(ctxItems);
          for (const id of ctxItems) {
            for (const rel of graph.getRelated(id, opts.depth)) {
              visibleIds.add(rel);
            }
          }
        } else {
          // BFS from every aggregate and actor up to opts.depth.
          visibleIds = new Set<string>();
          for (const [id, node] of graph.nodes) {
            if (node.kind === "aggregate" || node.kind === "actor") {
              visibleIds.add(id);
              for (const rel of graph.getRelated(id, opts.depth)) {
                visibleIds.add(rel);
              }
            }
          }
          // If the model has no aggregates/actors, fall back to all nodes.
          if (visibleIds.size === 0) {
            for (const id of graph.nodes.keys()) visibleIds.add(id);
          }
        }

        // Exclude bare context container nodes — they are represented as subgraphs.
        for (const id of visibleIds) {
          if (graph.nodes.get(id)?.kind === "context") visibleIds.delete(id);
        }

        // Apply --node-types filter (BFS runs over all kinds; output is then narrowed).
        if (opts.nodeTypes) {
          const requested = opts.nodeTypes.split(",").map((s) => s.trim()).filter(Boolean);
          const unknown = requested.filter((k) => !VALID_KINDS.has(k));
          if (unknown.length > 0) {
            process.stderr.write(`Warning: unknown node kind(s) ignored: ${unknown.join(", ")}\n`);
          }
          const kindFilter = new Set(requested.filter((k) => VALID_KINDS.has(k)));
          for (const id of visibleIds) {
            const kind = graph.nodes.get(id)?.kind;
            if (kind && !kindFilter.has(kind)) visibleIds.delete(id);
          }
        }

        // ── 2. Collect visible edges (deduplicated) ──────────────────
        const seenEdges = new Set<string>();
        const visibleEdges: GraphEdge[] = [];
        for (const edge of graph.edges) {
          if (SKIP_LABELS.has(edge.label)) continue;
          if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
          const key = `${edge.from}→${edge.to}→${edge.label}`;
          if (seenEdges.has(key)) continue;
          seenEdges.add(key);
          visibleEdges.push(edge);
        }

        // ── 3. Group nodes by bounded context ────────────────────────
        const byContext = new Map<string | undefined, GraphNode[]>();
        for (const id of visibleIds) {
          const node = graph.nodes.get(id);
          if (!node) continue;
          const ctx = node.context;
          if (!byContext.has(ctx)) byContext.set(ctx, []);
          byContext.get(ctx)!.push(node);
        }

        // ── 4. Render ────────────────────────────────────────────────
        const direction = opts.layout.toUpperCase() === "TD" ? "TD" : "LR";
        const lines: string[] = ["```mermaid", `flowchart ${direction}`];

        // Nodes inside subgraphs (bounded contexts)
        for (const [ctx, nodes] of byContext) {
          if (ctx) {
            lines.push(``, `    subgraph ${mermaidId(`ctx_${ctx}`)}["${mermaidLabel(ctx)}"]`);
          }
          for (const node of nodes) {
            lines.push(`        ${mermaidId(node.id)}${nodeShape(node)}`);
          }
          if (ctx) {
            lines.push(`    end`);
          }
        }

        // Edges
        if (visibleEdges.length > 0) {
          lines.push(``, `    %% Relationships`);
          for (const edge of visibleEdges) {
            const from = mermaidId(edge.from);
            const to = mermaidId(edge.to);
            lines.push(`    ${from} ${edgeArrow(edge.label)}|${edge.label}| ${to}`);
          }
        }

        lines.push("```\n");
        const content = lines.join("\n");

        try {
          writeFileSync(outPath, content, "utf-8");
          console.log(`Generated Mermaid graph at ${outPath}`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Failed to write graph to ${outPath}:`, msg);
          process.exit(1);
        }
      },
    );
}
