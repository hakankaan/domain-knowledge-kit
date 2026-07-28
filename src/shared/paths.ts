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
import { resolve, join, relative, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Resolve the DKK package installation root.
 *
 * Computed from `import.meta.url` via `fileURLToPath` instead of
 * `import.meta.dirname` because the latter is undefined under tsx
 * when this module is loaded transitively via `createRequire` (used
 * by the loader's federation hydration). `fileURLToPath(import.meta.url)`
 * works in all loading paths.
 *
 * Running from source (`tsx src/cli.ts`) → resolves to `src/shared`.
 * Running from the compiled output (`dist/shared/`) → `dist/shared`.
 * Both cases go up two levels to reach the package root.
 *
 * Used exclusively for locating package-bundled assets (schemas,
 * templates).
 */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

/**
 * Walk up the directory tree from `from`, returning the first ancestor
 * that contains a `.dkk/` directory. Returns `null` when none is found.
 *
 * Capped at 64 iterations as a defensive measure against pathological
 * filesystems; normal trees terminate at `/` well before that. The
 * `from` path is resolved to an absolute path before searching.
 *
 * Exposed separately from {@link repoRoot} so other tools (e.g. a
 * future `dkk doctor`) can reuse the search without inheriting
 * `repoRoot`'s override/fallback semantics.
 */
export function findDkkRoot(from: string): string | null {
  let current = resolve(from);
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(current, ".dkk"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Resolve the project root (where `.dkk/` lives).
 *
 * Resolution order:
 *   1. Explicit `override` (the `--root` CLI flag) — used verbatim,
 *      no walk-up. This preserves the contract for callers that pass
 *      an absolute root and expect it to be used as-is (including
 *      pointing at a fresh directory that has no `.dkk/` yet).
 *   2. Walk-up search via {@link findDkkRoot}: if `cwd/.dkk/` exists,
 *      return `cwd`. Otherwise walk up the directory tree to the
 *      first ancestor containing a `.dkk/`. This makes DKK usable
 *      from any sub-directory of a service repo (including monorepos
 *      where services live under `services/<name>/`).
 *   3. Fallback: if no `.dkk/` is found on the walk-up path, return
 *      `process.cwd()` (matches the historical behaviour, so that
 *      scaffold commands which create `.dkk/` in cwd still work).
 *
 * The walk-up can be disabled with `DKK_DISABLE_WALKUP=1` for callers
 * who want the strict legacy behaviour.
 */
export function repoRoot(override?: string): string {
  if (override) return resolve(override);

  const cwd = resolve(process.cwd());

  if (process.env.DKK_DISABLE_WALKUP === "1") {
    return cwd;
  }

  return findDkkRoot(cwd) ?? cwd;
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
 * Absolute path to `.dkk/templates/` — the project's own overrides for
 * DKK's bundled Handlebars templates.
 *
 * Optional and absent by default. A file here shadows the bundled
 * template of the same name, which is the only sane place for a team to
 * customise a scaffold: the bundled copy lives inside `node_modules`
 * and is replaced on every upgrade.
 */
export function projectTemplatesDir(root?: string): string {
  return join(repoRoot(root), ".dkk", "templates");
}

/**
 * Resolve a template by name, preferring the project override in
 * `.dkk/templates/` over the copy bundled with the package.
 *
 * @param name - Template basename without extension (e.g. "adr").
 * @returns Absolute path, or `null` when neither location has it.
 */
export function resolveTemplate(name: string, root?: string): string | null {
  const file = `${name}.md.hbs`;
  const override = join(projectTemplatesDir(root), file);
  if (existsSync(override)) return override;
  const bundled = join(templatesDir(), file);
  return existsSync(bundled) ? bundled : null;
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
 * Absolute path to the `.github/skills/` directory bundled inside the
 * DKK package installation.
 *
 * Used by `dkk init --skills` to copy skill files into a user's project.
 */
export function packageSkillsDir(): string {
  return join(packageRoot(), ".github", "skills");
}

/**
 * Absolute path to the `tools/dkk/claude/` directory bundled inside the
 * DKK package installation.
 *
 * Holds the Claude Code config template (`settings.json` + hook scripts)
 * used by `dkk init --claude` to scaffold AI-assistant integration in
 * a consumer's repo.
 */
export function packageClaudeDir(): string {
  return join(packageRoot(), "tools", "dkk", "claude");
}

/**
 * Absolute path to the `tools/dkk/copilot/` directory bundled inside the
 * DKK package installation.
 *
 * Holds the GitHub Copilot config template (prompt files + custom agent)
 * used by `dkk init --copilot` to scaffold Copilot integration in a
 * consumer's repo. The portable skills it installs alongside live under
 * `packageSkillsDir()`.
 */
export function packageCopilotDir(): string {
  return join(packageRoot(), "tools", "dkk", "copilot");
}

/**
 * Turn an absolute path into a repo-relative POSIX path
 * (forward slashes, no leading `./`).
 */
export function repoRelative(absPath: string, root?: string): string {
  return relative(repoRoot(root), absPath).replace(/\\/g, "/");
}

/**
 * Absolute path to `.dkk/feedback.yml` (notes about the dkk tool itself).
 *
 * Not part of the domain model — the loader and validator never read it.
 */
export function feedbackFile(root?: string): string {
  return join(repoRoot(root), ".dkk", "feedback.yml");
}

// ── Federation paths ─────────────────────────────────────────────────

/** Absolute path to `.dkk/service.yml` (service identity manifest). */
export function serviceFile(root?: string): string {
  return join(repoRoot(root), ".dkk", "service.yml");
}

/** Absolute path to `.dkk/federation.yml` (peer manifest). */
export function federationFile(root?: string): string {
  return join(repoRoot(root), ".dkk", "federation.yml");
}

/** Absolute path to `.dkk/federation.lock.json` (pinned peer SHAs). */
export function federationLockFile(root?: string): string {
  return join(repoRoot(root), ".dkk", "federation.lock.json");
}

/** Absolute path to `.dkk/imports/` (gitignored peer cache root). */
export function importsDir(root?: string): string {
  return join(repoRoot(root), ".dkk", "imports");
}

/**
 * Absolute path to a single peer's cached repo root under `.dkk/imports/<service>/`.
 * The peer's `.dkk/` lives at `<importedServiceDir>/.dkk/`.
 */
export function importedServiceDir(service: string, root?: string): string {
  return join(importsDir(root), service);
}
