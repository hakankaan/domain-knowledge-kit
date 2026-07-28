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
import {
  primeContent,
  fullPrimeContent,
  buildDomainSummary,
  buildStalenessHeadline,
  guideSection,
  GUIDE_TOPICS,
} from "../agent/commands/prime.js";
import type { AdrRecord, Flow } from "../../shared/types/domain.js";
import { adrFrontmatter } from "../../shared/adr-parser.js";
import { adrView, renderAdrText } from "../adr/present.js";
import { auditAdrs } from "../adr/audit.js";
import { collectDecisions } from "../adr/decisions.js";
import { loadFederation, resolvePeerRoot, peerEnvKey } from "../federation/loader.js";
import { findConsumers } from "../federation/commands/consumers.js";
import { analyzeDrift, mapFileToContext } from "../audit/commands/drift.js";
import { repoRoot } from "../../shared/paths.js";
import { pkgVersion } from "../../version.js";

/** JSON-stringify a payload for tool output. */
function asText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/** Build the MCP server and register all tools. */
export function buildServer(rootOpt?: string): McpServer {
  const server = new McpServer({
    name: "dkk",
    // Read from package.json rather than hardcoded: a stale value here is
    // invisible locally but is what every MCP client reports as the server
    // version, so it silently misidentifies the build during triage.
    version: pkgVersion,
  });

  // Optional override for the repo root (each tool can also take its own).
  const defaultRoot = rootOpt;

  // ── search ──────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_search",
    {
      description:
        "Full-text search across domain items (events, commands, policies, aggregates, read models, ADRs, glossary). Federation-aware: results include items from any loaded peer service, with their id prefixed `<service>:<context>.<Name>` and a `service` field on each row.",
      inputSchema: {
        query: z.string().describe("FTS5 query string."),
        context: z.string().optional().describe("Filter by bounded context name."),
        type: z
          .string()
          .optional()
          .describe("Filter by item type (event, command, policy, aggregate, read_model, glossary, actor, adr, flow, context)."),
        tag: z.string().optional().describe("Filter by tag/keyword."),
        status: z
          .string()
          .optional()
          .describe(
            "Filter by lifecycle status. ADRs only: proposed | accepted | rejected | deprecated | superseded. Use this to ask 'what is currently binding?' (accepted) or 'what is still open?' (proposed).",
          ),
        service: z
          .string()
          .optional()
          .describe(
            "Filter by service. Use the local service name to see only local rows, or a peer name to see only that peer's items. Empty string matches local rows in unfederated repos.",
          ),
        limit: z.number().int().min(1).max(200).optional().describe("Max results (default 20)."),
        expand: z.boolean().optional().describe("Expand top results with graph neighbours."),
        root: z.string().optional().describe("Override repository root."),
      },
    },
    async ({ query, context, type, tag, status, service, limit, expand, root }) => {
      const r = root ?? defaultRoot;
      const filters = { context, type, tag, status, service };
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
        "Show the full definition of a domain item by its ID. Accepts ids like 'ordering.OrderPlaced', 'actor.Customer', 'adr-0001', 'flow.OrderFulfillment', 'context.ordering'. Federation-aware: prefix any id with '<service>:' to look it up in a loaded peer service (e.g. 'ordering:ordering.OrderPlaced' from a billing repo that has ordering as a peer). The shorthand '<service>:<ItemName>' is also accepted when the service exports a single context.",
      inputSchema: {
        id: z.string().describe("Composite item id, optionally `<service>:` prefixed for federated lookups."),
        section: z
          .string()
          .optional()
          .describe(
            "ADRs only: return just one section of the body by its heading (e.g. 'decision', 'consequences', 'alternatives'). Prefix matching, so 'alt' finds 'Alternatives Considered'. Use this when you want what was decided without paying for the whole document.",
          ),
        format: z.enum(["json", "yaml"]).optional().describe("Output format (default json)."),
        root: z.string().optional(),
      },
    },
    async ({ id, section, format, root }) => {
      const model = loadDomainModel({ root: root ?? defaultRoot });
      const result = resolveItem(model, id);
      if (!result.found || !result.data) {
        return {
          isError: true,
          content: [{ type: "text", text: asText({ error: `Item "${id}" not found.` }) }],
        };
      }

      // An ADR's body is Markdown, and it carries the decision. Folding
      // it into a YAML scalar loses every heading, so Context, Decision
      // and Consequences become indistinguishable to the reader.
      if (result.kind === "adr") {
        const adr = result.data as AdrRecord;
        const view = adrView(adr, section);
        if (!view.ok) {
          return { isError: true, content: [{ type: "text", text: asText({ error: view.message }) }] };
        }
        if (format === "yaml") {
          return { content: [{ type: "text", text: renderAdrText(adr, view.view) }] };
        }
        return {
          content: [
            {
              type: "text",
              text: asText({
                id,
                label: result.label,
                data: section
                  ? { ...adrFrontmatter(adr), section: view.view.section, body: view.view.body }
                  : adr,
                sections: view.view.availableSections,
              }),
            },
          ],
        };
      }

      if (section) {
        return {
          isError: true,
          content: [{ type: "text", text: asText({ error: `\`section\` applies to ADRs only; "${id}" is not an ADR.` }) }],
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
        "Concise, AI-optimised summary of a domain item with its direct graph neighbours. Cheapest tool for quick orientation around an id. Federation-aware: accepts '<service>:<id>' for peer items.",
      inputSchema: {
        id: z.string().describe("Composite item id, optionally `<service>:` prefixed for peer items."),
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
        "BFS graph traversal from an item id. Use depth >= 2 to assess blast radius (what would break if this item changes). Federation-aware: the graph spans loaded peer services, so cross-service edges (e.g. a local policy's `when.events: ['ordering:ordering.OrderPlaced']`) are traversable. Peer node ids appear prefixed with '<service>:'.",
      inputSchema: {
        id: z.string().describe("Composite item id, optionally `<service>:` prefixed for peer items."),
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
      description: "List domain items with optional filters by bounded context, item type, and/or lifecycle status. Lists local items only; for peers use `dkk_search` with a `service` filter or `dkk_peers` for an overview.",
      inputSchema: {
        context: z.string().optional(),
        type: z.string().optional(),
        status: z
          .string()
          .optional()
          .describe(
            "Filter by lifecycle status. ADRs only: proposed | accepted | rejected | deprecated | superseded. Combine with type='adr' to list open proposals or the currently binding set.",
          ),
        root: z.string().optional(),
      },
    },
    async ({ context, type, status, root }) => {
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
      if (status) {
        const st = status.toLowerCase();
        rows = rows.filter((r) => (r.status ?? "").toLowerCase() === st);
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
      description: "Return the absolute file path(s) where a domain item is defined on disk. Resolves local ids only; peer items live in their own repos — use `dkk_peers` to find where each peer is checked out.",
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

      // ADR health is not a graph property — an ADR's edges are links,
      // not structure, so the orphan walk above deliberately skips
      // them. Decision rot needs its own pass.
      const adrHealth = auditAdrs(model);

      return {
        content: [
          {
            type: "text",
            text: asText({
              counts,
              health: {
                orphanedCount: orphaned.length,
                orphaned,
                unlinkedAdrs: adrHealth.unlinked.map((a) => a.id),
                stalledProposals: adrHealth.stalledProposals.map((a) => a.id),
                oneWayAdrLinks: adrHealth.linkGaps.length,
              },
            }),
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
        "Output the lean DKK agent context (behavioural rules, the MCP-tool retrieval pointer, mutation-only CLI commands, ID/naming conventions, model layout) plus the current domain summary. Re-prime with this after compaction or topic drift. For deep reference (YAML structure, workflows, full CLI), use `dkk_guide` or set `verbose: true`.",
      inputSchema: {
        staticOnly: z.boolean().optional().describe("Skip the dynamic domain summary."),
        verbose: z
          .boolean()
          .optional()
          .describe("Return the full reference document instead of the lean default."),
        root: z.string().optional(),
      },
    },
    async ({ staticOnly, verbose, root }) => {
      const r = root ?? defaultRoot;
      let text = verbose ? fullPrimeContent() : primeContent();
      if (!staticOnly) {
        text = buildStalenessHeadline(r) + text + buildDomainSummary(r);
      }
      return { content: [{ type: "text", text }] };
    },
  );

  // ── guide ───────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_guide",
    {
      description:
        "On-demand deep reference for working with the domain model — fetch a section only when the task calls for it (prime stays lean). Topics: 'yaml' (full YAML structure for every item type — read before authoring/editing YAML), 'update' (the domain-change workflow, referential-integrity rules, and validation), 'federation' (cross-repo refs + peer workflow), 'review' (change-impact review workflow), 'cli' (the full CLI command reference).",
      inputSchema: {
        topic: z
          .enum(GUIDE_TOPICS)
          .describe("Which reference section to return: yaml | update | federation | review | cli."),
      },
    },
    async ({ topic }) => {
      return { content: [{ type: "text", text: guideSection(topic) }] };
    },
  );

  // ── peers ───────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_peers",
    {
      description:
        "List federation peers and their reachability state. Peers are services whose `.dkk/` is loaded alongside this repo's; their items can be referenced as `<service>:<context>.<Name>`.",
      inputSchema: {
        root: z.string().optional().describe("Override repository root."),
      },
    },
    async ({ root }) => {
      const r = root ?? defaultRoot;
      const rootAbs = repoRoot(r);
      const manifest = loadFederation(r);
      if (!manifest || manifest.peers.length === 0) {
        return { content: [{ type: "text", text: asText({ peers: [] }) }] };
      }
      const peers = manifest.peers.map((peer) => {
        const resolution = resolvePeerRoot(peer, rootAbs);
        return {
          name: peer.name,
          kind: peer.source.type,
          reachable: resolution.reachable,
          peerRoot: resolution.peerRoot,
          envOverride: process.env[peerEnvKey(peer.name)] ?? null,
          reason: resolution.reason ?? null,
        };
      });
      return { content: [{ type: "text", text: asText({ peers }) }] };
    },
  );

  // ── consumers ───────────────────────────────────────────────────────
  server.registerTool(
    "dkk_consumers",
    {
      description:
        "Reverse-lookup across federation: given a local item id (e.g. `ordering.OrderPlaced`), list every reference back to it from a loaded peer. Use to answer 'who breaks if I rename this?'.",
      inputSchema: {
        id: z.string().describe("Local item id (bare form, e.g. ordering.OrderPlaced)."),
        root: z.string().optional().describe("Override repository root."),
      },
    },
    async ({ id, root }) => {
      const model = loadDomainModel({ root: root ?? defaultRoot });
      const consumers = findConsumers(model, id, model.service?.name);
      return {
        content: [
          {
            type: "text",
            text: asText({
              item: id,
              service: model.service?.name ?? null,
              consumers,
              peerCount: model.peers?.size ?? 0,
            }),
          },
        ],
      };
    },
  );

  // ── drift ───────────────────────────────────────────────────────────
  server.registerTool(
    "dkk_drift",
    {
      description:
        "Model/code drift report from `code_refs` bindings + git history: stale contexts (bound code changed since the model did), dead bindings (bound paths no longer exist), and uncovered source dirs. Pass `file` to instead map one source file to its owning context (with staleness and linked ADRs). The validator only measures internal consistency — use this to ask whether the model still matches the code.",
      inputSchema: {
        file: z
          .string()
          .optional()
          .describe("Map this source file to its owning context instead of running the full report."),
        threshold: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Commits touching bound code before a context counts as stale (default 5)."),
        root: z.string().optional().describe("Override repository root."),
      },
    },
    async ({ file, threshold, root }) => {
      const r = root ?? defaultRoot;
      const payload = file
        ? mapFileToContext(file, { root: r })
        : analyzeDrift({ root: r, threshold });
      return { content: [{ type: "text", text: asText(payload) }] };
    },
  );

  // ── decisions ───────────────────────────────────────────────────────
  server.registerTool(
    "dkk_decisions",
    {
      description:
        "Which architectural decisions govern this? Pass `item` (a domain id like 'ordering.Order', 'actor.Customer', 'flow.Checkout', 'context.ordering') or `file` (a source path). Returns every linked ADR with its provenance — whether the item names it, it names the item, it governs the whole context, or its code_refs bind the file — plus `binding`: the ids actually in effect after following supersession chains. Prefer this over composing search + related + show when the question is 'what has already been decided about X?'. Read the full text of anything it returns with dkk_show (use `section` to get just the decision).",
      inputSchema: {
        item: z
          .string()
          .optional()
          .describe("Domain id to ask about (ordering.Order, actor.Customer, flow.X, context.ordering)."),
        file: z
          .string()
          .optional()
          .describe("Source file path to ask about. Resolved via code_refs on ADRs and on contexts."),
        includeContext: z
          .boolean()
          .optional()
          .describe("Include decisions governing the whole owning context (default true)."),
        root: z.string().optional().describe("Override repository root."),
      },
    },
    async ({ item, file, includeContext, root }) => {
      const r = root ?? defaultRoot;
      if (!item && !file) {
        return {
          isError: true,
          content: [{ type: "text", text: asText({ error: "Pass either `item` or `file`." }) }],
        };
      }

      const model = loadDomainModel({ root: r });

      if (file) {
        // Path → context/ADR resolution is the drift slice's job; this
        // tool only turns the result into a decision answer.
        const mapping = mapFileToContext(file, { root: r });
        const report = collectDecisions(model, mapping.file, {
          fileBinding: { context: mapping.context, adrs: mapping.adrsBoundDirectly ?? [] },
          includeContext,
        });
        return { content: [{ type: "text", text: asText({ ...report, mappedContext: mapping.context }) }] };
      }

      const report = collectDecisions(model, item!, { includeContext });
      return { content: [{ type: "text", text: asText(report) }] };
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
      const result = validateDomainModel(model, { warnMissingFields, root: root ?? defaultRoot });
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
