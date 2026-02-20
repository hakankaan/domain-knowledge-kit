/**
 * Domain model loader.
 *
 * Recursively walks `domain/` and `docs/adr/` to discover all YAML
 * definition files and ADR Markdown files, then assembles and returns
 * a fully-typed {@link DomainModel}.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type {
  ActorsFile,
  DomainContext,
  DomainIndex,
  DomainModel,
  AdrRecord,
} from "../types/domain.js";
import { parseYaml } from "../utils/yaml.js";
import { parseAdrFile } from "../utils/adr-parser.js";
import {
  actorsFile,
  contextsDir,
  indexFile,
  adrDir,
} from "../utils/paths.js";

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
 * Discover context directories.
 *
 * Each subdirectory of `domain/contexts/` that contains a YAML file
 * is considered a bounded-context directory. Single `.yml` files
 * directly under `domain/contexts/` are also accepted as flat contexts.
 */
function discoverContextPaths(ctxDir: string): string[] {
  if (!existsSync(ctxDir)) return [];

  const entries = readdirSync(ctxDir, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const fullPath = join(ctxDir, entry.name);

    if (entry.isDirectory()) {
      // Look for context.yml or <dir-name>.yml inside the directory
      const contextYml = join(fullPath, "context.yml");
      const namedYml = join(fullPath, `${entry.name}.yml`);
      if (existsSync(contextYml)) {
        paths.push(contextYml);
      } else if (existsSync(namedYml)) {
        paths.push(namedYml);
      }
    } else {
      const ext = extname(entry.name).toLowerCase();
      if (ext === ".yml" || ext === ".yaml") {
        paths.push(fullPath);
      }
    }
  }

  return paths.sort();
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
 * 4. Discovers and parses ADR frontmatter from `docs/adr/*.md`
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
  const contexts = new Map<string, DomainContext>();
  const ctxPaths = discoverContextPaths(contextsDir(root));
  for (const ctxPath of ctxPaths) {
    const ctx = loadYaml<DomainContext>(ctxPath);
    if (ctx.name) {
      contexts.set(ctx.name, ctx);
    }
  }

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
