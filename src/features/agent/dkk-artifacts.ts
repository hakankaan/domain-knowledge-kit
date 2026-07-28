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
import { CONFLICT_SUFFIX, readArtifactLock, sha256, writeArtifactLock } from "./artifact-lock.js";
import { findCaseVariants, type CaseRename } from "./case-rename.js";

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
  // `<name>.new` files are conflict copies DKK wrote for the user to merge,
  // not managed artifacts; scanning them in would flag them for deletion on
  // the very next run, throwing away the template the user still needs.
  for (const sub of ["skills", "agents", "commands"] as const) {
    const dir = join(root, ".claude", sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith("dkk-")) continue;
      if (name.endsWith(CONFLICT_SUFFIX)) continue;
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
      if (name.endsWith(CONFLICT_SUFFIX)) continue;
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

/** Which agent surfaces a repo has opted into. */
export interface AdoptedSurfaces {
  claude: boolean;
  githubSkills: boolean;
  copilot: boolean;
}

/**
 * Each surface is diffed (and later refreshed) only if the repo has already
 * adopted it, so `dkk update` never pushes a toolchain onto a repo that
 * didn't opt in — a Copilot-only repo must not sprout a `.claude/` tree, and
 * a Claude-only repo must not sprout `.github/` Copilot files.
 */
export function detectAdoptedSurfaces(root: string): AdoptedSurfaces {
  return {
    claude: hasClaudeAdoption(root),
    githubSkills: hasGithubSkillsAdoption(root),
    copilot: hasCopilotAdoption(root),
  };
}

/** One file the bundled template ships, paired with where it lands. */
export interface ShippedArtifact {
  /** Absolute path inside the DKK package. */
  src: string;
  /** Absolute destination path in the target repo. */
  dest: string;
  /** Repo-relative POSIX destination path — the identity used in the lock. */
  rel: string;
}

export interface ShippedInventory {
  /** Every shipped file, individually. */
  files: ShippedArtifact[];
  /**
   * Install roots as {@link scanInstalledArtifacts} reports them: skill
   * *directories* plus flat files. Kept separate from `files` because
   * removal is decided per install root (a retired skill is swept as a
   * directory) while add/replace/conflict is decided per file.
   */
  roots: Set<string>;
}

/**
 * Enumerate every file the bundled template ships for the adopted surfaces.
 *
 * Per-file rather than per-directory: the lock hashes individual files, and
 * a directory-granular diff cannot say *which* skill file a user edited —
 * which is the whole point of telling a conflict from a stale copy.
 *
 * `.claude/settings.json` is intentionally absent: the prune+remerge phase
 * owns it, and its content always differs from a fresh template (user
 * customisations plus additive merge state).
 */
export function shippedArtifacts(root: string, surfaces: AdoptedSurfaces): ShippedInventory {
  const files: ShippedArtifact[] = [];
  const roots = new Set<string>();
  const add = (src: string, dest: string) => files.push({ src, dest, rel: toRel(root, dest) });

  if (surfaces.claude) {
    const claudeSrc = packageClaudeDir();
    const inv = dkkClaudeFiles();

    for (const name of inv.hooks) {
      const dest = join(root, ".claude", "hooks", name);
      roots.add(dest);
      add(join(claudeSrc, "hooks", name), dest);
    }

    for (const skillName of inv.skills) {
      const skillSrc = join(claudeSrc, "skills", skillName);
      const skillDest = join(root, ".claude", "skills", skillName);
      roots.add(skillDest);
      for (const fileName of listFilesIfDir(skillSrc)) {
        add(join(skillSrc, fileName), join(skillDest, fileName));
      }
    }

    for (const [sub, names] of [["agents", inv.agents], ["commands", inv.commands]] as const) {
      for (const name of names) {
        const dest = join(root, ".claude", sub, name);
        roots.add(dest);
        add(join(claudeSrc, sub, name), dest);
      }
    }
  }

  if (surfaces.githubSkills) {
    const skillsSrc = packageSkillsDir();
    for (const skillName of dkkGithubSkillDirs()) {
      const skillSrcDir = join(skillsSrc, skillName);
      const skillDestDir = join(root, ".github", "skills", skillName);
      roots.add(skillDestDir);
      for (const fileName of listFilesIfDir(skillSrcDir)) {
        add(join(skillSrcDir, fileName), join(skillDestDir, fileName));
      }
    }
  }

  if (surfaces.copilot) {
    const copilotInv = dkkCopilotFiles();
    for (const [sub, names] of [["prompts", copilotInv.prompts], ["agents", copilotInv.agents]] as const) {
      for (const name of names) {
        const dest = join(root, ".github", sub, name);
        roots.add(dest);
        add(join(packageCopilotDir(), sub, name), dest);
      }
    }
  }

  return { files, roots };
}

export interface ArtifactDiff {
  /** Files in the new template that aren't present in the target repo. */
  toAdd: string[];
  /**
   * Files that differ from the template but whose content is provably the
   * previous DKK version's — safe to overwrite silently.
   */
  toReplace: string[];
  /**
   * Files that differ from the template *and* from what DKK last wrote:
   * somebody edited them. Overwriting destroys work, so `dkk update` keeps
   * the local copy and writes the template alongside as `<path>.new`.
   */
  toConflict: string[];
  /** Files present locally that DKK no longer ships (renamed/removed templates + legacy paths). */
  toRemove: string[];
  /** Entries on disk whose spelling differs from the shipped name by case alone. */
  caseRenames: CaseRename[];
  /**
   * True when the repo has no readable `.dkk/artifacts.lock`, so a local edit
   * cannot be distinguished from a stale copy. Everything that differs is
   * reported as `toReplace` and callers must say why the distinction is
   * missing rather than implying the overwrite is known-safe.
   */
  lockMissing: boolean;
}

/**
 * Compute the add / replace / conflict / remove triage between the bundled
 * template and a target repo. Paths are returned as repo-relative POSIX paths.
 *
 * `toAdd`, `toReplace` and `toConflict` are derived by enumerating the
 * bundled template's shipped files; `toRemove` is the set of installed
 * DKK-managed paths that have no counterpart in the new template.
 */
export function computeArtifactDiff(root: string): ArtifactDiff {
  const diff: ArtifactDiff = {
    toAdd: [],
    toReplace: [],
    toConflict: [],
    toRemove: [],
    caseRenames: [],
    lockMissing: false,
  };

  const installed = scanInstalledArtifacts(root);
  const surfaces = detectAdoptedSurfaces(root);
  const inventory = shippedArtifacts(root, surfaces);

  const lock = readArtifactLock(root);
  diff.lockMissing = lock === null;

  for (const artifact of inventory.files) {
    const template = readIfPresent(artifact.src);
    if (template === null) continue;
    const onDisk = readIfPresent(artifact.dest);

    if (onDisk === null) {
      diff.toAdd.push(artifact.rel);
      continue;
    }
    if (onDisk === template) continue;

    // Differs from the template. Whether that is an upgrade or a collision
    // depends entirely on whether DKK recognises the local content as its own.
    if (lock === null) {
      // No provenance to consult. Preserve the historical behaviour rather
      // than flagging every pre-lock repo as conflicted; `lockMissing` tells
      // the caller to explain the limitation.
      diff.toReplace.push(artifact.rel);
    } else if (lock.artifacts[artifact.rel] === sha256(onDisk)) {
      diff.toReplace.push(artifact.rel);
    } else {
      diff.toConflict.push(artifact.rel);
    }
  }

  diff.caseRenames = findCaseVariants(root, inventory.files.map((f) => f.dest));

  // toRemove: any installed dkk-managed path (for an adopted surface) not
  // present in the shipped install roots, plus everything in `legacy` (no
  // longer shipped). Files for a surface the repo did NOT adopt are excluded —
  // otherwise their absence would flag every stray dkk-* file for deletion.
  // De-duplicate because a legacy path can match both the `dkk-*` prefix
  // predicate AND the LEGACY_DKK_PATHS list.
  // A wrongly-cased entry is reclaimed by the rename, not deleted — counting
  // it in both lists would report two changes for one logical fix and imply a
  // deletion that never happens.
  const renameSources = new Set(diff.caseRenames.map((r) => join(root, r.fromRel)));

  const seenRemove = new Set<string>();
  const candidates = [
    ...(surfaces.claude ? [...installed.dkkPrefixedClaude, ...installed.dkkHooks] : []),
    ...(surfaces.githubSkills ? installed.githubSkillDirs : []),
    ...(surfaces.copilot ? [...installed.copilotPrompts, ...installed.copilotAgents] : []),
    ...installed.legacy,
  ];
  for (const path of candidates) {
    if (inventory.roots.has(path)) continue;
    if (renameSources.has(path)) continue;
    if (seenRemove.has(path)) continue;
    seenRemove.add(path);
    diff.toRemove.push(toRel(root, path));
  }

  return diff;
}

/**
 * Rewrite `.dkk/artifacts.lock` from what is currently on disk.
 *
 * Call after any run that installs or refreshes artifacts (`dkk init`,
 * `dkk update`). Files matching the bundled template get their hash recorded;
 * conflicted files keep the hash of the version DKK actually wrote, so they
 * stay flagged until resolved.
 */
export function recordArtifactLock(root: string): void {
  const inventory = shippedArtifacts(root, detectAdoptedSurfaces(root));
  writeArtifactLock(root, inventory.files);
}

/** Total number of changes a diff proposes. */
export function artifactDiffCount(diff: ArtifactDiff): number {
  return (
    diff.toAdd.length +
    diff.toReplace.length +
    diff.toConflict.length +
    diff.toRemove.length +
    diff.caseRenames.length
  );
}

function readIfPresent(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).replace(/\\/g, "/");
}

/** True if `name` (basename or first path segment) starts with `dkk-`. */
export function isDkkPrefixed(path: string): boolean {
  return basename(path).startsWith("dkk-");
}
