/**
 * Canonical identification of DKK-managed AI assistant artifacts in a
 * consumer's repo. Used by `dkk update` to safely sweep stale files and
 * prune stale settings.json entries without touching user-authored content.
 *
 * Naming convention (single source of truth — keep changes here):
 *
 * - **Files** in `.claude/skills/`, `.claude/agents/`, `.claude/commands/`
 *   are DKK-managed if their first path segment matches `dkk-*`.
 * - **Hooks** in `.claude/hooks/` are identified by basename — only those
 *   whose `.mjs` filename appears in the bundled settings.json template's
 *   hook command strings are owned by DKK.
 * - **Skill directories** in `.github/skills/` are DKK-managed if they
 *   match `dkk-*`.
 * - **permissions.allow** entries are DKK-managed iff they appear verbatim
 *   in the bundled settings.json template's `permissions.allow`.
 * - **LEGACY_DKK_PATHS** captures artifact paths that prior versions of
 *   DKK installed and that current versions no longer ship — `update`
 *   removes them so users on old releases don't carry stale files forever.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { packageClaudeDir, packageSkillsDir } from "../../shared/paths.js";
import { extractHookBasename, type ClaudeSettings } from "./commands/init.js";

/**
 * Repo-relative paths that previous DKK versions installed but the current
 * release no longer ships. `dkk update` removes any of these still present
 * in a target repo. Append new entries here when a template file is
 * renamed or retired.
 */
export const LEGACY_DKK_PATHS: readonly string[] = [
  ".github/skills/dkk-domain-knowledge",
];

export interface ClaudeArtifactInventory {
  /** `.claude/hooks/<basename>.mjs` filenames the bundled template installs. */
  hooks: string[];
  /** `.claude/skills/<skill>/` directories the bundled template installs (matches the `dkk-*` prefix). */
  skills: string[];
  /** `.claude/agents/<agent>.md` filenames the bundled template installs. */
  agents: string[];
  /** `.claude/commands/<command>.md` filenames the bundled template installs. */
  commands: string[];
}

/**
 * Walk `tools/dkk/claude/` in the running DKK package and return the set of
 * artifact basenames the template currently ships. Derived at runtime so
 * future template additions don't require code changes here.
 */
export function dkkClaudeFiles(): ClaudeArtifactInventory {
  const inv: ClaudeArtifactInventory = { hooks: [], skills: [], agents: [], commands: [] };
  const src = packageClaudeDir();
  if (!existsSync(src)) return inv;

  inv.hooks = listFilesIfDir(join(src, "hooks"));
  inv.skills = listDirsIfDir(join(src, "skills"));
  inv.agents = listFilesIfDir(join(src, "agents"));
  inv.commands = listFilesIfDir(join(src, "commands"));
  return inv;
}

/**
 * Skill directories the bundled `.github/skills/` template installs (e.g.
 * `dkk-flow-implementer`). Returned as bare directory names.
 */
export function dkkGithubSkillDirs(): string[] {
  const src = packageSkillsDir();
  if (!existsSync(src)) return [];
  return listDirsIfDir(src);
}

/**
 * `permissions.allow` entries the bundled `settings.json` template ships.
 * Empty array if the template is missing or unparseable — callers should
 * treat that as "DKK doesn't own any permissions" rather than erroring.
 */
export function dkkPermissionAllowEntries(): string[] {
  const settings = readBundledSettings();
  if (!settings) return [];
  return settings.permissions?.allow ?? [];
}

/**
 * Hook script basenames referenced by the bundled `settings.json` template
 * (e.g. `session-start-prime.mjs`). Used to identify DKK-owned hook entries
 * in a consumer's settings.json so they can be pruned cleanly.
 */
export function dkkHookBasenames(): string[] {
  const settings = readBundledSettings();
  if (!settings?.hooks) return [];
  const out = new Set<string>();
  for (const entries of Object.values(settings.hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks ?? []) {
        const b = extractHookBasename(hook.command);
        if (b) out.add(b);
      }
    }
  }
  return [...out];
}

/**
 * Read and parse the bundled `settings.json` template. Returns `null` if
 * the file is missing or unparseable (failures are silent — see callers).
 */
function readBundledSettings(): ClaudeSettings | null {
  const path = join(packageClaudeDir(), "settings.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ClaudeSettings;
  } catch {
    return null;
  }
}

function listFilesIfDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => {
    try { return statSync(join(dir, n)).isFile(); } catch { return false; }
  });
}

function listDirsIfDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => {
    try { return statSync(join(dir, n)).isDirectory(); } catch { return false; }
  });
}

/**
 * Result of scanning a target repo for every DKK-managed artifact path.
 * Paths are absolute. Use {@link computeArtifactDiff} for the add / replace /
 * remove triage.
 */
export interface InstalledArtifactScan {
  // Files matching `.claude/(skills|agents|commands)/dkk-<name>`.
  dkkPrefixedClaude: string[];
  // Files in `.claude/hooks/` matching dkkHookBasenames().
  dkkHooks: string[];
  // Top-level `.github/skills/dkk-<name>` directories.
  githubSkillDirs: string[];
  // Any LEGACY_DKK_PATHS entry that still exists.
  legacy: string[];
}

/**
 * Walk a target repo's `.claude/` and `.github/skills/` trees and return
 * the set of paths the predicates flag as DKK-managed.
 */
export function scanInstalledArtifacts(root: string): InstalledArtifactScan {
  const hookBasenames = new Set(dkkHookBasenames());
  const scan: InstalledArtifactScan = {
    dkkPrefixedClaude: [],
    dkkHooks: [],
    githubSkillDirs: [],
    legacy: [],
  };

  // .claude/skills, .claude/agents, .claude/commands — match dkk-* prefix.
  for (const sub of ["skills", "agents", "commands"] as const) {
    const dir = join(root, ".claude", sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith("dkk-")) continue;
      const path = join(dir, name);
      // skills/ is nested (one dir per skill); agents/ + commands/ are flat files.
      if (sub === "skills") {
        // Push the directory itself; sweep deletes recursively.
        scan.dkkPrefixedClaude.push(path);
      } else {
        scan.dkkPrefixedClaude.push(path);
      }
    }
  }

  // .claude/hooks — match basenames the bundled template defines.
  const hooksDir = join(root, ".claude", "hooks");
  if (existsSync(hooksDir)) {
    for (const name of readdirSync(hooksDir)) {
      if (hookBasenames.has(name)) scan.dkkHooks.push(join(hooksDir, name));
    }
  }

  // .github/skills/dkk-*
  const ghSkills = join(root, ".github", "skills");
  if (existsSync(ghSkills)) {
    for (const name of readdirSync(ghSkills)) {
      if (!name.startsWith("dkk-")) continue;
      scan.githubSkillDirs.push(join(ghSkills, name));
    }
  }

  // Legacy paths.
  for (const legacyRel of LEGACY_DKK_PATHS) {
    const abs = join(root, legacyRel);
    if (existsSync(abs)) scan.legacy.push(abs);
  }

  return scan;
}

export interface ArtifactDiff {
  /** Files in the new template that aren't present in the target repo. */
  toAdd: string[];
  /** Files present in both but with different content. */
  toReplace: string[];
  /** Files present locally that DKK no longer ships (renamed/removed templates + legacy paths). */
  toRemove: string[];
}

/**
 * Compute the add / replace / remove triage between the bundled template
 * and a target repo. Paths are returned as repo-relative POSIX paths.
 *
 * `toAdd` and `toReplace` are derived by enumerating the bundled template's
 * shipped files; `toRemove` is the set of installed DKK-managed paths that
 * have no counterpart in the new template.
 */
export function computeArtifactDiff(root: string): ArtifactDiff {
  const diff: ArtifactDiff = { toAdd: [], toReplace: [], toRemove: [] };
  const claudeSrc = packageClaudeDir();
  const skillsSrc = packageSkillsDir();
  const inv = dkkClaudeFiles();
  const installed = scanInstalledArtifacts(root);

  const expectedInstalled = new Set<string>();

  // Hooks: flat files.
  for (const name of inv.hooks) {
    const srcPath = join(claudeSrc, "hooks", name);
    const destPath = join(root, ".claude", "hooks", name);
    expectedInstalled.add(destPath);
    if (!existsSync(destPath)) {
      diff.toAdd.push(toRel(root, destPath));
    } else if (!filesEqual(srcPath, destPath)) {
      diff.toReplace.push(toRel(root, destPath));
    }
  }

  // settings.json is intentionally left out of the diff: the prune+merge
  // phase handles it independently and its content always differs from a
  // fresh template (user customisations + additive merge state). Including
  // it here would either always show "replace" on every run (noisy) or
  // misleadingly suggest the file will be force-overwritten.

  // Skills: nested (skill/<file>).
  for (const skillName of inv.skills) {
    const skillSrc = join(claudeSrc, "skills", skillName);
    const skillDest = join(root, ".claude", "skills", skillName);
    expectedInstalled.add(skillDest);
    if (!existsSync(skillDest)) {
      diff.toAdd.push(toRel(root, skillDest));
      continue;
    }
    // Compare each file inside the skill dir.
    let anyDiff = false;
    for (const fileName of readdirSync(skillSrc)) {
      const f = join(skillSrc, fileName);
      try { if (!statSync(f).isFile()) continue; } catch { continue; }
      const df = join(skillDest, fileName);
      if (!existsSync(df) || !filesEqual(f, df)) { anyDiff = true; break; }
    }
    if (anyDiff) diff.toReplace.push(toRel(root, skillDest));
  }

  // Agents + commands: flat files.
  for (const [sub, names] of [["agents", inv.agents], ["commands", inv.commands]] as const) {
    for (const name of names) {
      const srcPath = join(claudeSrc, sub, name);
      const destPath = join(root, ".claude", sub, name);
      expectedInstalled.add(destPath);
      if (!existsSync(destPath)) {
        diff.toAdd.push(toRel(root, destPath));
      } else if (!filesEqual(srcPath, destPath)) {
        diff.toReplace.push(toRel(root, destPath));
      }
    }
  }

  // .github/skills/<dkk-*>
  if (existsSync(skillsSrc)) {
    for (const skillName of dkkGithubSkillDirs()) {
      const skillSrcDir = join(skillsSrc, skillName);
      const skillDestDir = join(root, ".github", "skills", skillName);
      expectedInstalled.add(skillDestDir);
      if (!existsSync(skillDestDir)) {
        diff.toAdd.push(toRel(root, skillDestDir));
        continue;
      }
      let anyDiff = false;
      for (const fileName of readdirSync(skillSrcDir)) {
        const f = join(skillSrcDir, fileName);
        try { if (!statSync(f).isFile()) continue; } catch { continue; }
        const df = join(skillDestDir, fileName);
        if (!existsSync(df) || !filesEqual(f, df)) { anyDiff = true; break; }
      }
      if (anyDiff) diff.toReplace.push(toRel(root, skillDestDir));
    }
  }

  // toRemove: any installed dkk-managed path not present in `expectedInstalled`,
  // plus everything in `legacy` (which by definition is no longer shipped).
  // De-duplicate because a legacy path can match both the `dkk-*` prefix
  // predicate AND the LEGACY_DKK_PATHS list.
  const seenRemove = new Set<string>();
  const candidates = [
    ...installed.dkkPrefixedClaude,
    ...installed.dkkHooks,
    ...installed.githubSkillDirs,
    ...installed.legacy,
  ];
  for (const path of candidates) {
    if (expectedInstalled.has(path)) continue;
    if (seenRemove.has(path)) continue;
    seenRemove.add(path);
    diff.toRemove.push(toRel(root, path));
  }

  return diff;
}

function filesEqual(a: string, b: string): boolean {
  try {
    return readFileSync(a, "utf-8") === readFileSync(b, "utf-8");
  } catch {
    return false;
  }
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).replace(/\\/g, "/");
}

/** True if `name` (basename or first path segment) starts with `dkk-`. */
export function isDkkPrefixed(path: string): boolean {
  return basename(path).startsWith("dkk-");
}
