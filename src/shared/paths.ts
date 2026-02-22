/**
 * Path resolution utilities.
 *
 * Two resolution strategies:
 *
 * 1. **Project paths** (`repoRoot`, `domainDir`, `docsDir`, …) resolve
 *    from `process.cwd()` (or an explicit `--root` override).  This is
 *    the user's project directory — where `.dkk/domain/` lives.
 *
 * 2. **Package asset paths** (`packageRoot`, `schemaDir`, `templatesDir`)
 *    resolve from `import.meta.dirname` relative to the DKK package
 *    install.  Schemas and Handlebars templates ship with the package.
 */
import { resolve, join, relative } from "node:path";

/**
 * Resolve the DKK package installation root.
 *
 * When running from source (`tsx src/cli.ts`) `import.meta.dirname`
 * points at `src/shared/`, so we go up two levels.  When running from
 * the compiled output (`dist/shared/`) we also go up two levels.
 *
 * Used exclusively for locating package-bundled assets (schemas,
 * templates).
 */
export function packageRoot(): string {
  // import.meta.dirname is src/shared  or dist/shared
  return resolve(import.meta.dirname, "../..");
}

/**
 * Resolve the project root (where `.dkk/` lives).
 *
 * Defaults to `process.cwd()` so that DKK works correctly whether it
 * is run from source, from a global install, or as a project dependency.
 *
 * Callers can override by passing an explicit root path (the `--root`
 * CLI flag).
 */
export function repoRoot(override?: string): string {
  if (override) return resolve(override);
  return resolve(process.cwd());
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

/**
 * Absolute path to `tools/dkk/templates/`.
 *
 * Always resolves relative to the DKK package installation so that
 * templates are found regardless of the user's working directory.
 */
export function templatesDir(): string {
  return join(packageRoot(), "tools", "dkk", "templates");
}

/**
 * Absolute path to `tools/dkk/schema/`.
 *
 * Always resolves relative to the DKK package installation so that
 * schemas are found regardless of the user's working directory.
 */
export function schemaDir(): string {
  return join(packageRoot(), "tools", "dkk", "schema");
}

/**
 * Turn an absolute path into a repo-relative POSIX path
 * (forward slashes, no leading `./`).
 */
export function repoRelative(absPath: string, root?: string): string {
  return relative(repoRoot(root), absPath).replace(/\\/g, "/");
}
