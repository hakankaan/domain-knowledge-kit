/**
 * Repo-relative path resolution utilities.
 *
 * Every path helper resolves relative to the repository root
 * so callers never need to worry about the working directory.
 */
import { resolve, join, relative } from "node:path";

/**
 * Resolve the repository root.
 *
 * When running from source (`tsx src/cli.ts`) `import.meta.dirname`
 * points at `src/shared/`, so we go up two levels. When running from
 * the compiled output (`dist/shared/`) we also go up two levels.
 *
 * Callers can override by passing an explicit `repoRoot`.
 */
export function repoRoot(override?: string): string {
  if (override) return resolve(override);
  // import.meta.dirname is src/shared  or dist/shared
  return resolve(import.meta.dirname, "../..");
}

/** Absolute path to the `domain/` directory. */
export function domainDir(root?: string): string {
  return join(repoRoot(root), "domain");
}

/** Absolute path to `domain/contexts/`. */
export function contextsDir(root?: string): string {
  return join(domainDir(root), "contexts");
}

/** Absolute path to `domain/actors.yml`. */
export function actorsFile(root?: string): string {
  return join(domainDir(root), "actors.yml");
}

/** Absolute path to `domain/index.yml`. */
export function indexFile(root?: string): string {
  return join(domainDir(root), "index.yml");
}

/** Absolute path to `docs/adr/`. */
export function adrDir(root?: string): string {
  return join(repoRoot(root), "docs", "adr");
}

/** Absolute path to `docs/domain/` (rendered output). */
export function docsDir(root?: string): string {
  return join(repoRoot(root), "docs", "domain");
}

/** Absolute path to `tools/domain-pack/templates/`. */
export function templatesDir(root?: string): string {
  return join(repoRoot(root), "tools", "domain-pack", "templates");
}

/**
 * Turn an absolute path into a repo-relative POSIX path
 * (forward slashes, no leading `./`).
 */
export function repoRelative(absPath: string, root?: string): string {
  return relative(repoRoot(root), absPath).replace(/\\/g, "/");
}
