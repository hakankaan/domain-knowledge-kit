/**
 * `dkk update` command — upgrade the dkk npm package and refresh every
 * DKK-managed AI assistant artifact in the current repo.
 *
 * Pipeline (see plan: [[update-command-plan]]):
 *   A. Pre-flight   — validate repo, detect install mode + versions
 *   B. Self-upgrade — run `npm install ... domain-knowledge-kit@latest`
 *   C. Re-exec      — spawn the freshly-installed binary with --post-upgrade
 *                     so that bundled templates resolve to the NEW package
 *   D. Artifact diff + sweep + reinstall
 *   E. settings.json prune + additive remerge
 *   F. MCP server auto-registration
 *   G. AGENTS.md refresh
 *   H. Summary report
 *
 * Phase C is the load-bearing trick: after npm install completes, the
 * currently-running Node process still has the OLD package's code in
 * memory and `import.meta.url` points at the OLD install. The only honest
 * way to read new templates is to re-exec onto the freshly-installed
 * binary. Phases A–C run only in the first invocation; phases D–H run in
 * the re-exec'd child (or in the initial process when `--skip-npm` is
 * passed, since there's no version transition to worry about).
 */
import type { Command as Cmd } from "commander";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { basename, join } from "node:path";
import { repoRoot, packageClaudeDir } from "../../../shared/paths.js";
import { formatCliError } from "../../../shared/errors.js";
import { pkgVersion, pkgName } from "../../../version.js";
import {
  installClaudeConfig,
  installCopilotConfig,
  installSkills,
  mergeClaudeSettings,
  printSectionOutcome,
  refreshAgentsMd,
  refreshCopilotInstructions,
  type ClaudeSettings,
  type SectionOutcome,
} from "./init.js";
import {
  artifactDiffCount,
  computeArtifactDiff,
  detectAdoptedSurfaces,
  dkkHookBasenames,
  dkkPermissionAllowEntries,
  hasClaudeAdoption,
  hasCopilotAdoption,
  hasGithubSkillsAdoption,
  recordArtifactLock,
  scanInstalledArtifacts,
  shippedArtifacts,
  type ArtifactDiff,
} from "../dkk-artifacts.js";
import { CONFLICT_SUFFIX } from "../artifact-lock.js";
import { applyCaseRenames } from "../case-rename.js";
import { unifiedDiff } from "../../../shared/unified-diff.js";
import { detectInstallMode, fetchLatestVersion, type InstallInfo } from "../install-mode.js";
import { pruneDkkEntries } from "../settings-prune.js";
import { ensureMcpRegistered, ensureVscodeMcpRegistered, type McpRegisterOutcome } from "../mcp-register.js";

interface UpdateOpts {
  root?: string;
  yes?: boolean;
  check?: boolean;
  diff?: boolean;
  force?: boolean;
  skipNpm?: boolean;
  skipArtifacts?: boolean;
  skipMcp?: boolean;
  postUpgrade?: boolean;
}

/** Register the `update` subcommand. */
export function registerUpdate(program: Cmd): void {
  program
    .command("update")
    .description("Upgrade dkk and refresh DKK-managed artifacts (.claude/, .github/skills/, AGENTS.md, MCP) in this project")
    .option("-y, --yes", "Skip interactive confirmation for the artifact diff")
    .option("--check", "Dry-run: print the diff + plan but make no changes")
    .option("--diff", "Show the unified diff for each changed file before the confirmation prompt")
    .option("--force", "Overwrite locally-edited artifacts instead of preserving them as conflicts")
    .option("--skip-npm", "Don't run npm upgrade (use the already-installed version)")
    .option("--skip-artifacts", "Don't sweep/reinstall .claude/ and .github/skills/ files")
    .option("--skip-mcp", "Don't auto-register the DKK MCP server")
    .option("-r, --root <path>", "Override repository root")
    .option("--post-upgrade", "Internal: re-exec phase after self-upgrade", false)
    .action(async (opts: UpdateOpts) => {
      try {
        await runUpdate(opts);
      } catch (err) {
        console.error(`Error: ${formatCliError(err)}`);
        process.exit(1);
      }
    });
}

async function runUpdate(opts: UpdateOpts): Promise<void> {
  const root = repoRoot(opts.root);

  // ── Phase A: Pre-flight ─────────────────────────────────────────────
  // .dkk/ must exist — `update` is project-scoped and only meaningful
  // for repos that have already adopted DKK.
  if (!existsSync(join(root, ".dkk"))) {
    console.error(`Error: \`dkk update\` requires a DKK-using project (no .dkk/ found at ${root}).`);
    console.error(`Hint: run \`dkk init\` first to bootstrap one.`);
    process.exit(1);
  }

  // Skip Phase A/B/C entirely if we're already in the re-exec'd child, or
  // when `--check` is set: a dry run must not install anything. Without this
  // guard `--check` ran the npm self-upgrade and re-exec'd, so a command
  // documented as "make no changes" mutated node_modules (or the global
  // prefix) before printing its diff. `--check` also no longer needs an
  // upgradable install mode, so it works under npx — which is how CI runs it.
  const dryRun = Boolean(opts.check);
  if (!opts.postUpgrade && !dryRun) {
    const install = detectInstallMode();
    if (install.mode === "npx") {
      console.error("Error: `dkk update` can't upgrade an npx-launched install.");
      console.error("Hint: install dkk globally (`npm i -g domain-knowledge-kit`) or as a devDependency, then re-run.");
      console.error("Hint: for a read-only drift check in CI, use `dkk artifacts check` instead.");
      process.exit(1);
    }

    const current = pkgVersion;
    const latest = opts.skipNpm ? current : fetchLatestVersion();

    if (opts.skipNpm) {
      console.log(`dkk: ${current} (npm upgrade skipped via --skip-npm)`);
    } else if (latest === null) {
      console.warn(`Warning: could not contact the npm registry; proceeding without self-upgrade.`);
    } else if (current === latest) {
      console.log(`dkk: already on the latest version (${current}).`);
    } else {
      console.log(`dkk: ${current} → ${latest} (running npm install…)`);

      // ── Phase B: Self-upgrade ───────────────────────────────────────
      const npmArgs = buildNpmInstallArgs(install);
      const npmResult = spawnSync("npm", npmArgs, { stdio: "inherit" });
      if (npmResult.status !== 0) {
        console.error(`Error: npm install failed with exit code ${npmResult.status ?? "unknown"}.`);
        console.error(`Hint: run \`npm ${npmArgs.join(" ")}\` manually to see the underlying error, then re-run \`dkk update --skip-npm\`.`);
        process.exit(1);
      }

      // ── Phase C: Re-exec onto the new install ───────────────────────
      const newDkk = resolveDkkBinary(install);
      if (!newDkk) {
        console.warn("Warning: could not locate the freshly-installed `dkk` binary; refreshing artifacts using the in-memory templates (may be stale).");
        // Fall through to phases D–H in the current process. Best-effort.
      } else {
        const childArgs = buildReExecArgs(opts);
        const child = spawnSync(newDkk, ["update", "--post-upgrade", ...childArgs], {
          stdio: "inherit",
        });
        process.exit(child.status ?? 0);
      }
    }
  }

  // Capture which agent surfaces the repo adopted BEFORE Phase D touches
  // anything. `dkk update` refreshes only what's already installed, so it
  // never pushes a toolchain onto a repo that didn't opt in (a Copilot-only
  // repo gets no `.claude/`, a Claude-only repo gets no `.github/` Copilot).
  const claudeAdopted = hasClaudeAdoption(root);
  const githubSkillsAdopted = hasGithubSkillsAdoption(root);
  const copilotAdopted = hasCopilotAdoption(root);

  // ── Phase D: Artifact diff + sweep + reinstall ──────────────────────
  let diffSummary = { added: 0, replaced: 0, conflicted: 0, removed: 0, renamed: 0 };
  // Track whether settings.json existed before the install path; if it
  // didn't, Phase E has nothing to prune — installClaudeConfig just wrote
  // a pristine copy of the template.
  const settingsExistedBefore = existsSync(join(root, ".claude", "settings.json"));
  const anyAdopted = claudeAdopted || githubSkillsAdopted || copilotAdopted;
  if (!opts.skipArtifacts) {
    const diff = computeArtifactDiff(root);
    printArtifactDiff(diff, Boolean(opts.force));

    if (opts.diff) printContentDiffs(root, diff);

    // Everything decision-relevant must land BEFORE the prompt. The
    // settings.json prune is what actually surfaces "mixed DKK/user commands
    // left intact" warnings, and printing those after the writes made them
    // unactionable — by then the user had already answered y.
    const settingsPreview = claudeAdopted && settingsExistedBefore
      ? previewSettingsPrune(root)
      : [];
    for (const warning of settingsPreview) console.warn(`Warning: ${warning}`);

    if (opts.check) {
      console.log("\n(--check) No changes made. Re-run without --check to apply.");
      return;
    }

    const totalChanges = artifactDiffCount(diff);
    if (totalChanges === 0) {
      console.log("Artifacts: already up to date.");
    } else {
      if (!opts.yes) {
        const ok = await confirm(`Proceed with these changes? [y/N] `);
        if (!ok) {
          console.log("Aborted. No changes made.");
          return;
        }
      }

      // Case-only renames first: they must land before the sweep, or a
      // delete-then-recreate on a case-insensitive filesystem leaves git
      // seeing no change at all.
      const renames = applyCaseRenames(root, diff.caseRenames);
      for (const label of renames.applied) console.log(`Renamed  ${label}`);
      for (const warning of renames.warnings) console.warn(`Warning: ${warning}`);

      const removed = sweepRemovedArtifacts(root);

      // Locally-edited files are protected from the force-overwrite: the
      // installers keep them and write the new template as `<path>.new`.
      const protect = opts.force
        ? undefined
        : new Set(diff.toConflict.map((rel) => join(root, rel)));

      if (claudeAdopted) installClaudeConfig(root, /*force*/ true, { skipSettings: true, protect });
      if (githubSkillsAdopted) installSkills(root, /*force*/ true, { protect });
      // Copilot prompts/agents. Skills are handled by the line above;
      // instructions + MCP are handled by Phases G/F below — skip all three.
      if (copilotAdopted) {
        installCopilotConfig(root, /*force*/ true, {
          skipInstructions: true, skipMcp: true, skipSkills: true, protect,
        });
      }
      diffSummary = {
        added: diff.toAdd.length,
        replaced: diff.toReplace.length,
        conflicted: opts.force ? 0 : diff.toConflict.length,
        // What the sweep actually deleted, not what the pre-rename diff
        // predicted — a legacy path reclaimed by a case rename is not a
        // removal.
        removed,
        renamed: renames.applied.length,
      };
    }

    sweepResolvedConflicts(root, opts.force ? [] : diff.toConflict);

    // Always re-record, even on a no-op run: a repo upgrading from a
    // pre-lock dkk has zero drift but no lock, and would otherwise never
    // acquire one.
    if (anyAdopted) recordArtifactLock(root);
  }

  // ── Phase E: settings.json prune + remerge (Claude only) ────────────
  // `quiet`: the mixed-hook warnings were already printed above, before the
  // prompt. Repeating them here would just be noise.
  const settingsResult = claudeAdopted
    ? pruneAndRemergeSettings(root, opts, settingsExistedBefore, /*quiet*/ !opts.skipArtifacts)
    : { status: "skipped" as const, pruned: 0, added: 0, mixedWarnings: [] };

  // ── Phase F: MCP auto-register ──────────────────────────────────────
  let mcpOutcome: McpRegisterOutcome | { status: "skipped"; reason: string } =
    { status: "skipped", reason: "--skip-mcp" };
  if (!opts.skipMcp && !opts.check) {
    mcpOutcome = ensureMcpRegistered(root);
    // Copilot's VS Code MCP config, only for repos that opted into Copilot.
    if (copilotAdopted) ensureVscodeMcpRegistered(root);
  }

  // ── Phase G: AGENTS.md + copilot-instructions.md refresh ────────────
  // "not-run" is the --check sentinel; "skipped" is a *refused* splice
  // (ambiguous markers). Keeping them distinct matters — one is expected,
  // the other means a file needs manual repair.
  let agentsStatus: SectionOutcome | "not-run" = "not-run";
  let copilotStatus: SectionOutcome | "not-adopted" = "not-adopted";
  if (!opts.check) {
    agentsStatus = refreshAgentsMd(root);
    if (agentsStatus === "skipped") printSectionOutcome(agentsStatus, root, "AGENTS.md");
    if (copilotAdopted) {
      copilotStatus = refreshCopilotInstructions(root);
      if (copilotStatus === "skipped") {
        printSectionOutcome(copilotStatus, root, ".github/copilot-instructions.md");
      }
    }
  }

  // ── Phase H: Summary report ─────────────────────────────────────────
  printSummary(diffSummary, settingsResult, mcpOutcome, agentsStatus, copilotStatus);
}

// ── Phase A helpers ───────────────────────────────────────────────────

function buildNpmInstallArgs(install: InstallInfo): string[] {
  if (install.mode === "global") {
    return ["install", "-g", `${pkgName}@latest`];
  }
  // Local / unknown: install as a devDep into the current cwd. Bumps the
  // host's package.json so subsequent runs pick up the new version.
  return ["install", "--save-dev", `${pkgName}@latest`];
}

function resolveDkkBinary(install: InstallInfo): string | null {
  // Try the obvious places first; fall back to `which`.
  const candidates: string[] = [];
  if (install.mode === "global" && install.globalNodeModules) {
    candidates.push(join(install.globalNodeModules, ".bin", "dkk"));
  }
  candidates.push(join(process.cwd(), "node_modules", ".bin", "dkk"));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const out = execFileSync("which", ["dkk"], {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function buildReExecArgs(opts: UpdateOpts): string[] {
  const args: string[] = [];
  if (opts.yes) args.push("--yes");
  if (opts.check) args.push("--check");
  if (opts.diff) args.push("--diff");
  if (opts.force) args.push("--force");
  if (opts.skipArtifacts) args.push("--skip-artifacts");
  if (opts.skipMcp) args.push("--skip-mcp");
  if (opts.root) args.push("--root", opts.root);
  // --skip-npm is intentionally NOT forwarded: we've just finished the
  // npm-install step, so a child re-exec should still continue with
  // artifact refresh (the equivalent of --skip-npm at the child level).
  return args;
}

// ── Phase D helpers ───────────────────────────────────────────────────

function printArtifactDiff(diff: ArtifactDiff, force: boolean): void {
  console.log("");
  console.log("Artifact diff against the bundled template:");
  if (artifactDiffCount(diff) === 0) {
    console.log("  (no changes)");
    return;
  }
  for (const p of diff.toAdd) console.log(`  + add       ${p}`);
  for (const p of diff.toReplace) console.log(`  ~ replace   ${p}`);
  for (const p of diff.toConflict) {
    console.log(`  ${force ? "~ OVERWRITE" : "! conflict "} ${p}`);
  }
  for (const p of diff.toRemove) console.log(`  - remove    ${p}`);
  for (const r of diff.caseRenames) console.log(`  ↻ rename    ${r.fromRel} → ${basename(r.toRel)}`);

  if (diff.toConflict.length > 0) {
    const noun = diff.toConflict.length === 1 ? "file was" : "files were";
    console.log("");
    if (force) {
      console.log(`  ⚠ --force: ${diff.toConflict.length} ${noun} edited after dkk installed`);
      console.log(`    ${diff.toConflict.length === 1 ? "it" : "them"}. Those local changes will be DESTROYED.`);
    } else {
      console.log(`  ${diff.toConflict.length} ${noun} edited after dkk installed ${diff.toConflict.length === 1 ? "it" : "them"}.`);
      console.log(`  Your version is kept; the new template is written alongside as`);
      console.log(`  <path>${CONFLICT_SUFFIX} for you to merge. Pass --diff to see what changed,`);
      console.log(`  or --force to overwrite instead.`);
    }
  }

  if (diff.lockMissing && diff.toReplace.length > 0) {
    console.log("");
    console.log(`  Note: this repo has no .dkk/artifacts.lock yet, so a local edit can't be`);
    console.log(`  told apart from a previous dkk version's copy — everything differing is`);
    console.log(`  listed as \`replace\`. This run writes the lock; future upgrades will`);
    console.log(`  flag conflicts instead. Pass --diff to check before answering.`);
  }
}

/**
 * Print a unified diff for every file whose content is about to change.
 *
 * The reason `--diff` exists: a y/N prompt over a list of paths is not a
 * decision. Without the content there is no way to see what you are about to
 * lose short of running `git diff` in another terminal.
 */
function printContentDiffs(root: string, diff: ArtifactDiff): void {
  const changed = [...diff.toReplace, ...diff.toConflict];
  if (changed.length === 0) return;

  // rel → bundled template path, so each local file can be diffed against
  // what would replace it.
  const templates = new Map(
    shippedArtifacts(root, detectAdoptedSurfaces(root)).files.map((f) => [f.rel, f.src]),
  );

  for (const rel of changed) {
    const src = templates.get(rel);
    if (!src) continue;
    const local = readIfPresent(join(root, rel));
    const template = readIfPresent(src);
    if (local === null || template === null) continue;

    const body = unifiedDiff(local, template, {
      fromLabel: `${rel} (local)`,
      toLabel: `${rel} (dkk ${pkgVersion})`,
    });
    if (!body) continue;
    console.log("");
    console.log(body);
  }
  console.log("");
}

function readIfPresent(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

function sweepRemovedArtifacts(root: string): number {
  // Recompute the diff at sweep-time so we delete exactly what we promised.
  // This also absorbs the case renames applied a moment ago: a legacy path
  // that has just been renamed to its canonical spelling is no longer stale,
  // and must not be deleted on the strength of the pre-rename diff.
  const diff = computeArtifactDiff(root);
  let removed = 0;
  for (const rel of diff.toRemove) {
    const abs = join(root, rel);
    try {
      rmSync(abs, { recursive: true, force: true });
      console.log(`Removed  ${rel}`);
      removed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: could not remove ${rel}: ${msg}`);
    }
  }

  // Belt-and-suspenders: also sweep any installed dkk-* directory that
  // isn't in the new template's shipped list (handles the rare case where
  // `computeArtifactDiff` couldn't recompute the same way — e.g. if a
  // file was deleted between the two scans). No-op in the normal case.
  for (const p of scanInstalledArtifacts(root).legacy) {
    if (existsSync(p)) {
      try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  return removed;
}

/**
 * Drop `<path>.new` merge candidates whose conflict is gone — the local file
 * now matches the template, so the copy is stale.
 *
 * `writeArtifactFile` already does this whenever it writes a file; this
 * covers the case it can't reach, where resolving the last conflict leaves
 * the diff empty so no install runs at all and the `.new` would linger
 * forever.
 */
function sweepResolvedConflicts(root: string, stillConflicted: readonly string[]): void {
  const keep = new Set(stillConflicted);
  for (const artifact of shippedArtifacts(root, detectAdoptedSurfaces(root)).files) {
    if (keep.has(artifact.rel)) continue;
    const candidate = `${artifact.dest}${CONFLICT_SUFFIX}`;
    if (!existsSync(candidate)) continue;
    try {
      rmSync(candidate, { force: true });
      console.log(`Removed  ${artifact.rel}${CONFLICT_SUFFIX} (conflict resolved)`);
    } catch { /* best effort — a stale merge candidate is harmless */ }
  }
}

// ── Phase E helpers ───────────────────────────────────────────────────

interface SettingsResult {
  status: "no-file" | "pruned-and-merged" | "merge-only" | "skipped" | "malformed";
  pruned: number;
  added: number;
  mixedWarnings: string[];
}

/**
 * Non-mutating dry run of the settings.json prune, returning only its
 * warnings.
 *
 * Exists purely for ordering: `pruneDkkEntries` is where "mixed DKK/user
 * commands left intact" is discovered, but the real prune runs in Phase E —
 * after the artifact writes, and therefore after the confirmation prompt.
 * A warning a user reads only once the writes have happened cannot inform
 * the decision it is about.
 */
function previewSettingsPrune(root: string): string[] {
  const templatePath = join(packageClaudeDir(), "settings.json");
  const settingsPath = join(root, ".claude", "settings.json");
  if (!existsSync(templatePath) || !existsSync(settingsPath)) return [];
  try {
    const existing = JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeSettings;
    const { mixedHookWarnings } = pruneDkkEntries(
      existing,
      new Set(dkkPermissionAllowEntries()),
      new Set(dkkHookBasenames()),
    );
    return mixedHookWarnings;
  } catch {
    // A malformed file is reported (and left alone) by the real prune below.
    return [];
  }
}

function pruneAndRemergeSettings(
  root: string,
  opts: UpdateOpts,
  existedBefore: boolean,
  quiet: boolean,
): SettingsResult {
  if (opts.check || opts.skipArtifacts) {
    return { status: "skipped", pruned: 0, added: 0, mixedWarnings: [] };
  }

  const templatePath = join(packageClaudeDir(), "settings.json");
  if (!existsSync(templatePath)) {
    return { status: "skipped", pruned: 0, added: 0, mixedWarnings: [] };
  }

  const settingsPath = join(root, ".claude", "settings.json");

  // No existing file → just write the template verbatim. Phase D skipped
  // settings.json so it's our responsibility to create it.
  if (!existedBefore) {
    const raw = readFileSync(templatePath, "utf-8");
    writeFileSync(settingsPath, raw, "utf-8");
    console.log(`Created  .claude/settings.json`);
    return { status: "no-file", pruned: 0, added: 0, mixedWarnings: [] };
  }

  let existing: ClaudeSettings;
  let template: ClaudeSettings;
  try {
    existing = JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeSettings;
    template = JSON.parse(readFileSync(templatePath, "utf-8")) as ClaudeSettings;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: could not parse settings.json (${msg}); leaving it untouched.`);
    return { status: "malformed", pruned: 0, added: 0, mixedWarnings: [] };
  }

  const dkkAllow = new Set(dkkPermissionAllowEntries());
  const dkkHooks = new Set(dkkHookBasenames());
  const { pruned, removed, mixedHookWarnings } = pruneDkkEntries(existing, dkkAllow, dkkHooks);
  const { merged, changes } = mergeClaudeSettings(pruned, template);

  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  if (!quiet) for (const w of mixedHookWarnings) console.warn(`Warning: ${w}`);

  return {
    status: removed.length > 0 ? "pruned-and-merged" : "merge-only",
    pruned: removed.length,
    added: changes.length,
    mixedWarnings: mixedHookWarnings,
  };
}

// ── Phase H helpers ───────────────────────────────────────────────────

function printSummary(
  diff: { added: number; replaced: number; conflicted: number; removed: number; renamed: number },
  settings: SettingsResult,
  mcp: McpRegisterOutcome | { status: "skipped"; reason: string },
  agents: SectionOutcome | "not-run",
  copilot: SectionOutcome | "not-adopted",
): void {
  const parts = [`+${diff.added} added`, `~${diff.replaced} replaced`, `-${diff.removed} removed`];
  if (diff.renamed > 0) parts.push(`↻${diff.renamed} renamed`);

  console.log("");
  console.log("── Summary ────────────────────────────────────────────────────────");
  console.log(`dkk           ${pkgVersion}`);
  console.log(`Artifacts     ${parts.join(", ")}`);
  if (diff.conflicted > 0) {
    const noun = diff.conflicted === 1 ? "file" : "files";
    console.log(`              !${diff.conflicted} ${noun} kept as-is — merge the *${CONFLICT_SUFFIX} copies by hand`);
  }
  console.log(`settings.json ${formatSettingsResult(settings)}`);
  console.log(`MCP server    ${formatMcpResult(mcp)}`);
  console.log(`AGENTS.md     ${formatSectionOutcome(agents)}`);
  console.log(`Copilot       ${copilot === "not-adopted" ? "not installed (run `dkk init --copilot`)" : formatSectionOutcome(copilot)}`);
  console.log("");
  console.log("Next: run `dkk render` to validate the domain model.");
}

function formatSectionOutcome(o: SectionOutcome | "not-run"): string {
  if (o === "not-run") return "not refreshed (--check)";
  if (o === "skipped") return "SKIPPED — ambiguous markers, repair by hand";
  return o;
}

function formatSettingsResult(s: SettingsResult): string {
  if (s.status === "no-file") return "(none — created by artifact install)";
  if (s.status === "skipped") return "skipped";
  if (s.status === "malformed") return "left untouched (could not parse)";
  return `pruned ${s.pruned}, added ${s.added}`;
}

function formatMcpResult(m: McpRegisterOutcome | { status: "skipped"; reason: string }): string {
  switch (m.status) {
    case "already-registered":
      return `already registered (${m.path})`;
    case "registered":
      return `registered (${m.path}: \`${m.command}\`)`;
    case "skipped":
      return `skipped (${m.reason})`;
    case "failed":
      return `failed: ${m.reason} (add a "dkk" entry to .mcp.json manually)`;
  }
}

// ── Confirmation prompt ──────────────────────────────────────────────

/** Interactive Y/N prompt. Non-TTY stdin defaults to "no" (safer for CI). */
function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log(`${prompt}n   (no TTY — defaulting to abort; pass --yes to skip this prompt)`);
    return Promise.resolve(false);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
