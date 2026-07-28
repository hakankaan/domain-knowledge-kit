/**
 * Domain model loader.
 *
 * Recursively walks `.dkk/domain/` and `.dkk/adr/` to discover all YAML
 * definition files and ADR Markdown files, then assembles and returns
 * a fully-typed {@link DomainModel}.
 *
 * Context layout (per-item directory format):
 *
 *   .dkk/domain/contexts/<name>/
 *     context.yml          ← metadata: name, description, glossary
 *     events/              ← one .yml file per DomainEvent
 *     commands/            ← one .yml file per Command
 *     policies/            ← one .yml file per Policy
 *     aggregates/          ← one .yml file per Aggregate
 *     read-models/         ← one .yml file per ReadModel
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type {
  ActorsFile,
  ContextMetaFile,
  DomainContext,
  DomainIndex,
  DomainModel,
  AdrRecord,
  AdrLoadIssue,
  DomainEvent,
  Command,
  Policy,
  Aggregate,
  ReadModel,
} from "./types/domain.js";
import { parseYaml } from "./yaml.js";
import { isAdrFile, parseAdrFile } from "./adr-parser.js";
import {
  actorsFile,
  contextsDir,
  indexFile,
  adrDir,
} from "./paths.js";
import { loadServiceId } from "./service-id.js";

// ── Federation hook (inversion of dependency) ─────────────────────────
//
// The federation slice owns the peer-loading logic, but it needs to
// run at the tail end of every `loadDomainModel` call so that callers
// of the shared loader transparently see `model.peers`. Rather than
// have this module reach into the federation slice by path string
// (the old `createRequire` hack), the federation slice imports this
// module and registers a hook at module-init time via
// {@link setFederationHook}. The hook is opt-in: if no federation
// module is loaded (e.g. a script that imports `loadDomainModel`
// directly without the federation slice), no peers are hydrated.

/**
 * Federation-hook signature. Implementations receive the resolved
 * `root` and the already-built local `DomainModel`, and may mutate
 * `model.peers` in place. Errors thrown by the hook are caught and
 * logged as warnings — the local model still loads.
 */
export type FederationHook = (root: string | undefined, model: DomainModel) => void;

let federationHook: FederationHook | undefined;

/**
 * Register a federation hook. Called once at module-init time by the
 * federation slice. Passing `undefined` clears the hook (intended for
 * tests).
 */
export function setFederationHook(hook: FederationHook | undefined): void {
  federationHook = hook;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Read a YAML file and parse it into `T`. */
function loadYaml<T>(filePath: string): T {
  const text = readFileSync(filePath, "utf-8");
  return parseYaml<T>(text);
}

/**
 * Discover all `.yml` / `.yaml` files under a directory (non-recursive).
 * Skips dotfiles (e.g. `.gitkeep`).
 */
function listYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => {
      const ext = extname(f).toLowerCase();
      return (ext === ".yml" || ext === ".yaml") && !f.startsWith(".");
    })
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Discover all `.md` files under a directory (non-recursive).
 * Skips README.md and dotfiles.
 */
function listAdrFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isAdrFile)
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Load a bounded context from a per-item directory.
 *
 * Expects:
 *   <ctxDir>/context.yml          — identity: name, description, glossary
 *   <ctxDir>/events/*.yml         — one file per DomainEvent
 *   <ctxDir>/commands/*.yml       — one file per Command
 *   <ctxDir>/policies/*.yml       — one file per Policy
 *   <ctxDir>/aggregates/*.yml     — one file per Aggregate
 *   <ctxDir>/read-models/*.yml    — one file per ReadModel
 *
 * Returns `null` if `context.yml` is absent or has no `name`.
 */
function loadPerItemContext(ctxDir: string): DomainContext | null {
  const metaPath = join(ctxDir, "context.yml");
  if (!existsSync(metaPath)) return null;

  const meta = loadYaml<ContextMetaFile>(metaPath);
  if (!meta.name) return null;

  const events = listYamlFiles(join(ctxDir, "events")).map((f) => loadYaml<DomainEvent>(f));
  const commands = listYamlFiles(join(ctxDir, "commands")).map((f) => loadYaml<Command>(f));
  const policies = listYamlFiles(join(ctxDir, "policies")).map((f) => loadYaml<Policy>(f));
  const aggregates = listYamlFiles(join(ctxDir, "aggregates")).map((f) => loadYaml<Aggregate>(f));
  const readModels = listYamlFiles(join(ctxDir, "read-models")).map((f) => loadYaml<ReadModel>(f));

  const ctx: DomainContext = {
    name: meta.name,
    description: meta.description,
  };
  if (meta.glossary?.length) ctx.glossary = meta.glossary;
  if (meta.code_refs?.length) ctx.code_refs = meta.code_refs;
  if (meta.adr_refs?.length) ctx.adr_refs = meta.adr_refs;
  if (events.length) ctx.events = events;
  if (commands.length) ctx.commands = commands;
  if (policies.length) ctx.policies = policies;
  if (aggregates.length) ctx.aggregates = aggregates;
  if (readModels.length) ctx.read_models = readModels;

  return ctx;
}

/**
 * Discover and load all bounded contexts from `domain/contexts/`.
 *
 * Each sub-directory that contains a `context.yml` is treated as a
 * bounded context in the new per-item format.
 */
function loadAllContexts(ctxDir: string): Map<string, DomainContext> {
  const contexts = new Map<string, DomainContext>();
  if (!existsSync(ctxDir)) return contexts;

  const entries = readdirSync(ctxDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory()) continue;

    const ctx = loadPerItemContext(join(ctxDir, entry.name));
    if (ctx) contexts.set(ctx.name, ctx);
  }

  return contexts;
}

// ── Public API ────────────────────────────────────────────────────────

/** Options for the loader. */
export interface LoaderOptions {
  /** Override repository root (default: auto-detected). */
  root?: string;
  /**
   * When `false`, skip federation hydration — `model.peers` will not be
   * populated even if `.dkk/federation.yml` exists. Used when loading a
   * peer's own model (one level deep, no transitive peers) and by
   * callers that want a pure local view.
   *
   * Default: `true` (federation runs when a manifest is present).
   */
  followPeers?: boolean;
}

/**
 * Load the complete domain model from disk.
 *
 * 1. Parses `domain/index.yml`
 * 2. Parses `domain/actors.yml`
 * 3. Discovers and parses every bounded-context YAML file
 *    under `domain/contexts/`
 * 4. Discovers and parses ADR frontmatter from `.dkk/adr/*.md`
 *
 * @returns A fully-populated {@link DomainModel}.
 */
export function loadDomainModel(options: LoaderOptions = {}): DomainModel {
  const root = options.root;

  // 1. Domain index
  const indexPath = indexFile(root);
  const index: DomainIndex = existsSync(indexPath)
    ? loadYaml<DomainIndex>(indexPath)
    : { contexts: [] };

  // 2. Actors
  const actorsPath = actorsFile(root);
  const actorsData: ActorsFile = existsSync(actorsPath)
    ? loadYaml<ActorsFile>(actorsPath)
    : { actors: [] };

  // 3. Bounded contexts
  const contexts = loadAllContexts(contextsDir(root));

  // 4. ADRs
  //
  // Files are visited in sorted order and the FIRST claim on an id
  // wins, so a collision is deterministic and the surviving record is
  // stable across runs. Both halves of a collision are reported: the
  // loser used to be dropped in silence, taking a whole decision out
  // of search, docs, and every ref check with it.
  const adrs = new Map<string, AdrRecord>();
  const adrIssues: AdrLoadIssue[] = [];
  const adrFiles = listAdrFiles(adrDir(root));
  for (const adrPath of adrFiles) {
    const result = parseAdrFile(adrPath);

    if (!result.ok) {
      adrIssues.push({
        file: adrPath,
        message: result.message,
        // A stray Markdown note in the ADR directory is a plausible
        // accident; frontmatter that is present but broken is not.
        severity: result.reason === "no-frontmatter" ? "warning" : "error",
      });
      continue;
    }

    const record = result.record;
    const existing = adrs.get(record.id);
    if (existing) {
      adrIssues.push({
        file: adrPath,
        message: `duplicate ADR id "${record.id}" — already declared by ${
          existing.file ? basename(existing.file) : "another file"
        }. This file is ignored until one of them is renumbered.`,
        severity: "error",
      });
      continue;
    }
    adrs.set(record.id, record);
  }

  // 5. Service identity (federation Phase 1 — optional)
  const service = loadServiceId(root) ?? undefined;

  const model: DomainModel = {
    index,
    actors: actorsData.actors ?? [],
    contexts,
    adrs,
  };
  if (adrIssues.length) model.adrIssues = adrIssues;
  if (service) model.service = service;

  // 6. Federation peers (Phase 2 — optional, one level deep).
  // The federation slice registers itself via `setFederationHook` at
  // module-init time. The hook is suppressed via `followPeers: false`
  // when this loader is itself invoked from inside the federation
  // slice (loading a peer's own model). That keeps peer-of-peer
  // transitivity off without any cycle detection.
  if (options.followPeers !== false && federationHook) {
    try {
      federationHook(root, model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`dkk: federation load failed: ${msg}`);
    }
  }

  return model;
}
