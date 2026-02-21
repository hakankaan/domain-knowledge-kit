/**
 * Domain model loader.
 *
 * Recursively walks `domain/` and `.dkk/adr/` to discover all YAML
 * definition files and ADR Markdown files, then assembles and returns
 * a fully-typed {@link DomainModel}.
 *
 * Context layout (per-item directory format):
 *
 *   domain/contexts/<name>/
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
  DomainEvent,
  Command,
  Policy,
  Aggregate,
  ReadModel,
} from "./types/domain.js";
import { parseYaml } from "./yaml.js";
import { parseAdrFile } from "./adr-parser.js";
import {
  actorsFile,
  contextsDir,
  indexFile,
  adrDir,
} from "./paths.js";

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
    .filter((f) => {
      const ext = extname(f).toLowerCase();
      const name = basename(f).toLowerCase();
      return ext === ".md" && !f.startsWith(".") && name !== "readme.md";
    })
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
  const adrs = new Map<string, AdrRecord>();
  const adrFiles = listAdrFiles(adrDir(root));
  for (const adrPath of adrFiles) {
    const record = parseAdrFile(adrPath);
    if (record) {
      adrs.set(record.id, record);
    }
  }

  return {
    index,
    actors: actorsData.actors ?? [],
    contexts,
    adrs,
  };
}
