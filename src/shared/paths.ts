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

/** Absolute path to the `.dkk/domain/` directory. */
export function domainDir(root?: string): string {
  return join(repoRoot(root), ".dkk", "domain");
}

/** Absolute path to `.dkk/domain/contexts/`. */
export function contextsDir(root?: string): string {
  return join(domainDir(root), "contexts");
}

/** Absolute path to `.dkk/domain/actors.yml`. */
export function actorsFile(root?: string): string {
  return join(domainDir(root), "actors.yml");
}

/** Absolute path to `.dkk/domain/index.yml`. */
export function indexFile(root?: string): string {
  return join(domainDir(root), "index.yml");
}

/** Absolute path to `.dkk/adr/`. */
export function adrDir(root?: string): string {
  return join(repoRoot(root), ".dkk", "adr");
}

/** Absolute path to `.dkk/docs/` (rendered output). */
export function docsDir(root?: string): string {
  return join(repoRoot(root), ".dkk", "docs");
}

/** Absolute path to `tools/dkk/templates/`. */
export function templatesDir(root?: string): string {
  return join(repoRoot(root), "tools", "dkk", "templates");
}

/** Absolute path to `tools/dkk/schema/`. */
export function schemaDir(root?: string): string {
  return join(repoRoot(root), "tools", "dkk", "schema");
}

/**
 * Turn an absolute path into a repo-relative POSIX path
 * (forward slashes, no leading `./`).
 */
export function repoRelative(absPath: string, root?: string): string {
  return relative(repoRoot(root), absPath).replace(/\\/g, "/");
}
