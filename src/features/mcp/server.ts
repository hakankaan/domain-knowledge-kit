/**
 * Model Context Protocol server for DKK.
 *
 * Exposes the read-only domain query surface and validation as MCP tools
 * over stdio so AI agents (Claude Code, etc.) can introspect the domain
 * model directly, without shelling out to the CLI on every call.
 *
 * Tools delegate to the same in-process modules used by the CLI commands.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadDomainModel } from "../../shared/loader.js";
import { DomainGraph } from "../../shared/graph.js";
import { stringifyYaml } from "../../shared/yaml.js";
import { search } from "../query/searcher.js";
import { buildIndex } from "../pipeline/indexer.js";
import { validateDomainModel } from "../pipeline/validator.js";
import { resolveItem } from "../query/commands/show.js";
import { resolveDescription } from "../query/commands/summary.js";
import { collectRows } from "../query/commands/list.js";
import { resolveItemPath } from "../query/commands/locate.js";
import {
  buildStoryContext,
  renderMarkdown,
  type StoryContext,
} from "../query/commands/story.js";
import { primeContent, buildDomainSummary } from "../agent/commands/prime.js";
import type { Flow } from "../../shared/types/domain.js";

/** JSON-stringify a payload for tool output. */
function asText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/** Build the MCP server and register all tools. */
export function buildServer(rootOpt?: string): McpServer {
  const server = new McpServer({
    name: "dkk",
    version: "0.2.15",
  });

  // Optional override for the repo root (each tool can also take its own).
  const defaultRoot = rootOpt;

  // ── search ──────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_search",
    {
      description:
        "Full-text search across domain items (events, commands, policies, aggregates, read models, ADRs, glossary). Returns ranked results with excerpts, related ids, and ADR refs.",
      inputSchema: {
        query: z.string().describe("FTS5 query string."),
        context: z.string().optional().describe("Filter by bounded context name."),
        type: z
          .string()
          .optional()
          .describe("Filter by item type (event, command, policy, aggregate, read_model, glossary, actor, adr, flow, context)."),
        tag: z.string().optional().describe("Filter by tag/keyword."),
        limit: z.number().int().min(1).max(200).optional().describe("Max results (default 20)."),
        expand: z.boolean().optional().describe("Expand top results with graph neighbours."),
        root: z.string().optional().describe("Override repository root."),
      },
    },
    async ({ query, context, type, tag, limit, expand, root }) => {
      const r = root ?? defaultRoot;
      const filters = { context, type, tag };
      const opts = { root: r, limit: limit ?? 20 } as { root?: string; limit: number; graph?: DomainGraph };

      if (expand) {
        const model = loadDomainModel({ root: r });
        opts.graph = DomainGraph.from(model);
      }

      let results;
      try {
        results = search(query, filters, opts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Search index not found")) {
          const model = loadDomainModel({ root: r });
          buildIndex(model, { root: r });
          results = search(query, filters, opts);
        } else {
          throw err;
        }
      }

      return { content: [{ type: "text", text: asText({ query, count: results.length, results }) }] };
    },
  );

  // ── show ────────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_show",
    {
      description:
        "Show the full definition of a domain item by its ID. Accepts ids like 'ordering.OrderPlaced', 'actor.Customer', 'adr-0001', 'flow.OrderFulfillment', 'context.ordering'.",
      inputSchema: {
        id: z.string().describe("Composite item id."),
        format: z.enum(["json", "yaml"]).optional().describe("Output format (default json)."),
        root: z.string().optional(),
      },
    },
    async ({ id, format, root }) => {
      const model = loadDomainModel({ root: root ?? defaultRoot });
      const result = resolveItem(model, id);
      if (!result.found || !result.data) {
        return {
          isError: true,
          content: [{ type: "text", text: asText({ error: `Item "${id}" not found.` }) }],
        };
      }
      const text =
        format === "yaml"
          ? `# ${result.label ?? id}\n\n${stringifyYaml(result.data)}`
          : asText({ id, label: result.label, data: result.data });
      return { content: [{ type: "text", text }] };
    },
  );

  // ── summary ─────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_summary",
    {
      description:
        "Concise, AI-optimised summary of a domain item with its direct graph neighbours. Cheapest tool for quick orientation around an id.",
      inputSchema: {
        id: z.string().describe("Composite item id."),
        root: z.string().optional(),
      },
    },
    async ({ id, root }) => {
      const r = root ?? defaultRoot;
      const model = loadDomainModel({ root: r });
      const graph = DomainGraph.from(model);
      const node = graph.nodes.get(id);
      if (!node) {
        return {
          isError: true,
          content: [{ type: "text", text: asText({ error: `Item "${id}" not found.` }) }],
        };
      }
      const description = resolveDescription(model, id);
      const relatedIds = Array.from(graph.getRelated(id, 1));
      const nodeEdges = graph.edges.filter((e) => e.from === id || e.to === id);
      const related = relatedIds.map((relId) => {
        const relNode = graph.nodes.get(relId);
        const edge = nodeEdges.find(
          (e) => (e.from === id && e.to === relId) || (e.from === relId && e.to === id),
        );
        return { id: relId, kind: relNode?.kind, name: relNode?.name, label: edge?.label };
      });
      const payload: Record<string, unknown> = {
        id: node.id,
        name: node.name,
        kind: node.kind,
        context: node.context,
      };
      if (description !== undefined) payload.description = description;
      payload.related = related;
      return { content: [{ type: "text", text: asText(payload) }] };
    },
  );

  // ── related ─────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_related",
    {
      description:
        "BFS graph traversal from an item id. Use depth >= 2 to assess blast radius (what would break if this item changes).",
      inputSchema: {
        id: z.string().describe("Composite item id."),
        depth: z.number().int().min(1).max(5).optional().describe("Traversal depth (default 1)."),
        root: z.string().optional(),
      },
    },
    async ({ id, depth, root }) => {
      const model = loadDomainModel({ root: root ?? defaultRoot });
      const graph = DomainGraph.from(model);
      if (!graph.hasNode(id)) {
        return {
          isError: true,
          content: [{ type: "text", text: asText({ error: `Node "${id}" not found in the domain graph.` }) }],
        };
      }
      const d = depth ?? 1;
      const ids = Array.from(graph.getRelated(id, d));
      const grouped: Record<string, Array<{ id: string; name: string; context?: string }>> = {};
      for (const nId of ids) {
        const node = graph.nodes.get(nId);
        const kind = node?.kind ?? "unknown";
        (grouped[kind] ??= []).push({
          id: nId,
          name: node?.name ?? nId,
          ...(node?.context ? { context: node.context } : {}),
        });
      }
      for (const kind of Object.keys(grouped)) {
        grouped[kind].sort((a, b) => a.id.localeCompare(b.id));
      }
      return { content: [{ type: "text", text: asText({ id, depth: d, related: grouped }) }] };
    },
  );

  // ── list ────────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_list",
    {
      description: "List domain items with optional filters by bounded context and/or item type.",
      inputSchema: {
        context: z.string().optional(),
        type: z.string().optional(),
        root: z.string().optional(),
      },
    },
    async ({ context, type, root }) => {
      let rows = collectRows(root ?? defaultRoot);
      if (context) {
        const c = context.toLowerCase();
        rows = rows.filter((r) => r.context.toLowerCase() === c);
      }
      if (type) {
        let t = type.toLowerCase();
        if (t === "read-model") t = "read_model";
        rows = rows.filter((r) => r.type.toLowerCase() === t);
      }
      return { content: [{ type: "text", text: asText({ count: rows.length, items: rows }) }] };
    },
  );

  // ── story ───────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_story",
    {
      description:
        "Aggregate a flow's full domain context (actors, ordered steps, triggered policies, BDD examples, ADRs, downstream effects) for AI-assisted user-story generation and implementation guidance.",
      inputSchema: {
        flowId: z.string().describe("Flow id, with or without 'flow.' prefix."),
        format: z.enum(["json", "markdown"]).optional().describe("Output format (default json)."),
        root: z.string().optional(),
      },
    },
    async ({ flowId, format, root }) => {
      const r = root ?? defaultRoot;
      const model = loadDomainModel({ root: r });
      const graph = DomainGraph.from(model);
      const normalizedId = flowId.startsWith("flow.") ? flowId : `flow.${flowId}`;
      const flowName = normalizedId.slice("flow.".length);
      const flow = (model.index.flows ?? []).find((f: Flow) => f.name === flowName);
      if (!flow) {
        const available = (model.index.flows ?? []).map((f: Flow) => `flow.${f.name}`);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: asText({
                error: `Flow "${normalizedId}" not found.`,
                availableFlows: available,
              }),
            },
          ],
        };
      }
      const ctx: StoryContext = buildStoryContext(model, graph, flow);
      const text = format === "markdown" ? renderMarkdown(ctx) : asText(ctx);
      return { content: [{ type: "text", text }] };
    },
  );

  // ── locate ──────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_locate",
    {
      description: "Return the absolute file path(s) where a domain item is defined on disk.",
      inputSchema: {
        id: z.string(),
        root: z.string().optional(),
      },
    },
    async ({ id, root }) => {
      const paths = resolveItemPath(id, root ?? defaultRoot);
      if (paths.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: asText({ error: `Not found: ${id}` }) }],
        };
      }
      return { content: [{ type: "text", text: asText({ id, paths }) }] };
    },
  );

  // ── stats ───────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_stats",
    {
      description: "Print domain model statistics and detect orphaned (unreferenced) items.",
      inputSchema: {
        root: z.string().optional(),
      },
    },
    async ({ root }) => {
      const r = root ?? defaultRoot;
      const model = loadDomainModel({ root: r });
      const graph = DomainGraph.from(model);

      const counts = {
        contexts: 0,
        events: 0,
        commands: 0,
        aggregates: 0,
        policies: 0,
        readModels: 0,
        actors: 0,
        adrs: 0,
        flows: 0,
      };
      const orphaned: string[] = [];

      for (const [id, node] of graph.nodes) {
        switch (node.kind) {
          case "context": counts.contexts++; break;
          case "event": counts.events++; break;
          case "command": counts.commands++; break;
          case "aggregate": counts.aggregates++; break;
          case "policy": counts.policies++; break;
          case "read_model": counts.readModels++; break;
          case "actor": counts.actors++; break;
          case "adr": counts.adrs++; break;
          case "flow": counts.flows++; break;
        }
        if (
          node.kind !== "context" &&
          node.kind !== "actor" &&
          node.kind !== "adr" &&
          node.kind !== "flow" &&
          node.kind !== "glossary"
        ) {
          let connections = 0;
          for (const edge of graph.edges) {
            if ((edge.from === id || edge.to === id) && edge.label !== "contains") {
              connections++;
            }
          }
          if (connections === 0) orphaned.push(id);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: asText({ counts, health: { orphanedCount: orphaned.length, orphaned } }),
          },
        ],
      };
    },
  );

  // ── prime ───────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_prime",
    {
      description:
        "Output the full DKK agent context (project overview, item types, retrieval/update workflows, CLI reference, plus current domain summary). Run once at session start to make the agent domain-aware.",
      inputSchema: {
        staticOnly: z.boolean().optional().describe("Skip the dynamic domain summary."),
        root: z.string().optional(),
      },
    },
    async ({ staticOnly, root }) => {
      let text = primeContent();
      if (!staticOnly) text += buildDomainSummary(root ?? defaultRoot);
      return { content: [{ type: "text", text }] };
    },
  );

  // ── validate ────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_validate",
    {
      description:
        "Schema + cross-reference validation of the domain model. Returns errors and warnings (no rendering).",
      inputSchema: {
        id: z.string().optional().describe("Filter results to a single item id."),
        warnMissingFields: z.boolean().optional(),
        root: z.string().optional(),
      },
    },
    async ({ id, warnMissingFields, root }) => {
      const model = loadDomainModel({ root: root ?? defaultRoot });
      const result = validateDomainModel(model, { warnMissingFields });
      let { valid, errors, warnings } = result;

      if (id) {
        const isMatch = (p?: string) => {
          if (!p) return false;
          if (p === `actor:${id}` || p === `adr:${id}` || p === `context:${id}`) return true;
          const [ctx, name] = id.split(".");
          if (ctx && name) return p.startsWith(`context:${ctx}.`) && p.endsWith(`:${name}`);
          return false;
        };
        errors = errors.filter((e) => isMatch(e.path));
        warnings = warnings.filter((w) => isMatch(w.path));
        valid = errors.length === 0;
      }

      return {
        isError: !valid,
        content: [
          {
            type: "text",
            text: asText({
              valid,
              errors: errors.map((e) => ({ message: e.message, path: e.path ?? null })),
              warnings: warnings.map((w) => ({ message: w.message, path: w.path ?? null })),
            }),
          },
        ],
      };
    },
  );

  return server;
}

/** Connect the server to stdio and run until disconnect. */
export async function runStdio(rootOpt?: string): Promise<void> {
  const server = buildServer(rootOpt);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
