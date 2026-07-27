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
import { basename, dirname, join, relative } from "node:path";
import { packageClaudeDir, packageCopilotDir, packageSkillsDir } from "../../shared/paths.js";
import { hasDkkMarkerLine, extractHookBasename, type ClaudeSettings } from "./commands/init.js";

/**
 * Repo-relative paths that previous DKK versions installed but the current
 * release no longer ships. `dkk update` removes any of these still present
 * in a target repo. Append new entries here when a template file is
 * renamed or retired.
 */
export const LEGACY_DKK_PATHS: readonly string[] = [
  ".github/skills/dkk-domain-knowledge",
  // Releases through 0.6.1 shipped the portable skills as lowercase
  // `skill.md`. The Agent Skills spec requires `SKILL.md` (case-sensitive),
  // so the lowercase files are invisible to every consumer on a
  // case-sensitive filesystem. Sweep runs before reinstall, so removing the
  // stale entry lets the copier create a correctly-cased one — on a
  // case-insensitive filesystem an in-place overwrite would have kept the
  // old spelling.
  ".github/skills/dkk-adr-author/skill.md",
  ".github/skills/dkk-flow-implementer/skill.md",
  ".github/skills/dkk-story-analyst/skill.md",
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

export interface CopilotArtifactInventory {
  /** `.github/prompts/<name>.prompt.md` filenames the bundled template installs. */
  prompts: string[];
  /** `.github/agents/<name>.agent.md` filenames the bundled template installs. */
  agents: string[];
}

/**
 * Walk `tools/dkk/copilot/` in the running DKK package and return the set of
 * Copilot artifact filenames the template currently ships. Derived at runtime
 * so future template additions don't require code changes here.
 */
export function dkkCopilotFiles(): CopilotArtifactInventory {
  const inv: CopilotArtifactInventory = { prompts: [], agents: [] };
  const src = packageCopilotDir();
  if (!existsSync(src)) return inv;
  inv.prompts = listFilesIfDir(join(src, "prompts"));
  inv.agents = listFilesIfDir(join(src, "agents"));
  return inv;
}

/**
 * True if the repo has opted into the GitHub Copilot integration — i.e. any
 * DKK-managed Copilot artifact is already present. `dkk update` uses this to
 * decide whether to refresh the Copilot surface, so it never pushes Copilot
 * files onto a Claude-only repo.
 *
 * Signals (any one suffices): a `dkk-*.prompt.md`, a `dkk-*.agent.md`, a
 * `dkk` server in `.vscode/mcp.json`, or a DKK marker section in
 * `.github/copilot-instructions.md`.
 */
export function hasCopilotAdoption(root: string): boolean {
  if (listDkkFilesWithSuffix(join(root, ".github", "prompts"), ".prompt.md").length > 0) return true;
  if (listDkkFilesWithSuffix(join(root, ".github", "agents"), ".agent.md").length > 0) return true;

  const vscodeMcp = join(root, ".vscode", "mcp.json");
  if (existsSync(vscodeMcp)) {
    try {
      const cfg = JSON.parse(readFileSync(vscodeMcp, "utf-8")) as { servers?: Record<string, unknown> };
      if (cfg.servers && "dkk" in cfg.servers) return true;
    } catch { /* ignore malformed */ }
  }

  const instructions = join(root, ".github", "copilot-instructions.md");
  if (existsSync(instructions)) {
    try {
      // Line-anchored: a file that merely *documents* the marker convention
      // in prose must not read as an installed DKK section. A lone/duplicated
      // marker still counts as adoption — it just isn't safe to splice.
      if (hasDkkMarkerLine(readFileSync(instructions, "utf-8"))) return true;
    } catch { /* ignore */ }
  }

  return false;
}

/**
 * True if the repo has opted into the Claude Code integration — any
 * DKK-managed `.claude/` artifact is present. `dkk update` uses this so it
 * never pushes a `.claude/` tree onto a repo that only adopted Copilot (or a
 * bare `dkk init`).
 *
 * Signals (any one suffices): a `dkk-*` skill/agent/command under `.claude/`, a
 * DKK hook script under `.claude/hooks/`, or DKK-owned permission/hook entries
 * merged into `.claude/settings.json`.
 */
export function hasClaudeAdoption(root: string): boolean {
  const scan = scanInstalledArtifacts(root);
  if (scan.dkkPrefixedClaude.length > 0 || scan.dkkHooks.length > 0) return true;

  // settings.json can carry DKK entries even when no other .claude/ files
  // remain (e.g. a user pruned skills) — treat that as adoption too.
  const settingsPath = join(root, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const s = JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeSettings;
      const dkkAllow = new Set(dkkPermissionAllowEntries());
      if ((s.permissions?.allow ?? []).some((e) => dkkAllow.has(e))) return true;
      const dkkHooks = new Set(dkkHookBasenames());
      for (const entries of Object.values(s.hooks ?? {})) {
        for (const entry of entries) {
          for (const h of entry.hooks ?? []) {
            const b = extractHookBasename(h.command);
            if (b && dkkHooks.has(b)) return true;
          }
        }
      }
    } catch { /* ignore malformed */ }
  }
  return false;
}

/** True if the repo has any `.github/skills/dkk-*` directory installed. */
export function hasGithubSkillsAdoption(root: string): boolean {
  try {
    return readdirSync(join(root, ".github", "skills")).some((n) => n.startsWith("dkk-"));
  } catch {
    return false;
  }
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

/**
 * Case-sensitive `existsSync`: true only when the parent directory contains
 * an entry spelled exactly like `absPath`'s basename.
 *
 * `existsSync` delegates to the filesystem, so on APFS/NTFS it answers true
 * for `skill.md` when only `SKILL.md` is present. Anywhere the exact spelling
 * is load-bearing — legacy-path sweeps, canonical-filename checks — that
 * false positive matters.
 */
function existsExact(absPath: string): boolean {
  const parent = dirname(absPath);
  const name = basename(absPath);
  try {
    return readdirSync(parent).includes(name);
  } catch {
    return false;
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
 * Absolute paths of files in `dir` named `dkk-*<suffix>` (e.g. `dkk-*.prompt.md`).
 * Returns `[]` if the directory is absent, unreadable, or is actually a file
 * (a `readdirSync` on a non-directory throws `ENOTDIR` — swallow it).
 */
function listDkkFilesWithSuffix(dir: string, suffix: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith("dkk-") && n.endsWith(suffix))
    .map((n) => join(dir, n));
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
  // Files in `.github/prompts/` matching `dkk-*.prompt.md`.
  copilotPrompts: string[];
  // Files in `.github/agents/` matching `dkk-*.agent.md`.
  copilotAgents: string[];
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
    copilotPrompts: [],
    copilotAgents: [],
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

  // .github/prompts/dkk-*.prompt.md and .github/agents/dkk-*.agent.md
  scan.copilotPrompts = listDkkFilesWithSuffix(join(root, ".github", "prompts"), ".prompt.md");
  scan.copilotAgents = listDkkFilesWithSuffix(join(root, ".github", "agents"), ".agent.md");

  // Legacy paths. Must be matched case-SENSITIVELY: on a case-insensitive
  // filesystem `existsSync(".../skill.md")` also matches the canonical
  // `SKILL.md` we just installed, which would park the current file in
  // `toRemove` on every run — a permanently dirty diff and a delete/reinstall
  // churn. Compare against the real directory entry instead.
  for (const legacyRel of LEGACY_DKK_PATHS) {
    const abs = join(root, legacyRel);
    if (existsExact(abs)) scan.legacy.push(abs);
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
  const installed = scanInstalledArtifacts(root);
  const expectedInstalled = new Set<string>();

  // Each agent surface is diffed (and later refreshed) only if the repo has
  // already adopted it, so `dkk update` never pushes a toolchain onto a repo
  // that didn't opt in — a Copilot-only repo must not sprout a `.claude/`
  // tree, and a Claude-only repo must not sprout `.github/` Copilot files.
  const claudeAdopted = hasClaudeAdoption(root);
  const githubSkillsAdopted = hasGithubSkillsAdoption(root);
  const copilotAdopted = hasCopilotAdoption(root);

  if (claudeAdopted) diffClaudeArtifacts(root, diff, expectedInstalled);
  if (githubSkillsAdopted) diffGithubSkills(root, diff, expectedInstalled);
  if (copilotAdopted) diffCopilotArtifacts(root, diff, expectedInstalled);

  // toRemove: any installed dkk-managed path (for an adopted surface) not
  // present in `expectedInstalled`, plus everything in `legacy` (no longer
  // shipped). Files for a surface the repo did NOT adopt are excluded —
  // otherwise their absence from `expectedInstalled` would flag every stray
  // dkk-* file for deletion. De-duplicate because a legacy path can match both
  // the `dkk-*` prefix predicate AND the LEGACY_DKK_PATHS list.
  const seenRemove = new Set<string>();
  const candidates = [
    ...(claudeAdopted ? [...installed.dkkPrefixedClaude, ...installed.dkkHooks] : []),
    ...(githubSkillsAdopted ? installed.githubSkillDirs : []),
    ...(copilotAdopted ? [...installed.copilotPrompts, ...installed.copilotAgents] : []),
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

/**
 * Diff the bundled `.claude/` template (hooks, skills, agents, commands)
 * against the target repo. `settings.json` is intentionally excluded — the
 * prune+merge phase owns it, and its content always differs from a fresh
 * template (user customisations + additive merge state).
 */
function diffClaudeArtifacts(root: string, diff: ArtifactDiff, expectedInstalled: Set<string>): void {
  const claudeSrc = packageClaudeDir();
  const inv = dkkClaudeFiles();

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

  // Skills: nested (skill/<file>).
  for (const skillName of inv.skills) {
    const skillSrc = join(claudeSrc, "skills", skillName);
    const skillDest = join(root, ".claude", "skills", skillName);
    expectedInstalled.add(skillDest);
    if (!existsSync(skillDest)) {
      diff.toAdd.push(toRel(root, skillDest));
    } else if (dirContentsDiffer(skillSrc, skillDest)) {
      diff.toReplace.push(toRel(root, skillDest));
    }
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
}

/** Diff the bundled `.github/skills/dkk-*` template against the target repo. */
function diffGithubSkills(root: string, diff: ArtifactDiff, expectedInstalled: Set<string>): void {
  const skillsSrc = packageSkillsDir();
  if (!existsSync(skillsSrc)) return;
  for (const skillName of dkkGithubSkillDirs()) {
    const skillSrcDir = join(skillsSrc, skillName);
    const skillDestDir = join(root, ".github", "skills", skillName);
    expectedInstalled.add(skillDestDir);
    if (!existsSync(skillDestDir)) {
      diff.toAdd.push(toRel(root, skillDestDir));
    } else if (dirContentsDiffer(skillSrcDir, skillDestDir)) {
      diff.toReplace.push(toRel(root, skillDestDir));
    }
  }
}

/** Diff the bundled `.github/{prompts,agents}/dkk-*` Copilot template. */
function diffCopilotArtifacts(root: string, diff: ArtifactDiff, expectedInstalled: Set<string>): void {
  const copilotInv = dkkCopilotFiles();
  for (const [sub, names] of [["prompts", copilotInv.prompts], ["agents", copilotInv.agents]] as const) {
    for (const name of names) {
      const srcPath = join(packageCopilotDir(), sub, name);
      const destPath = join(root, ".github", sub, name);
      expectedInstalled.add(destPath);
      if (!existsSync(destPath)) {
        diff.toAdd.push(toRel(root, destPath));
      } else if (!filesEqual(srcPath, destPath)) {
        diff.toReplace.push(toRel(root, destPath));
      }
    }
  }
}

/** True if any file in `srcDir` is missing from or differs against `destDir`. */
function dirContentsDiffer(srcDir: string, destDir: string): boolean {
  for (const fileName of readdirSync(srcDir)) {
    const f = join(srcDir, fileName);
    try { if (!statSync(f).isFile()) continue; } catch { continue; }
    const df = join(destDir, fileName);
    if (!existsSync(df) || !filesEqual(f, df)) return true;
  }
  return false;
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
