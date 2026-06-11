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
import { join } from "node:path";
import { repoRoot, packageClaudeDir } from "../../../shared/paths.js";
import { formatCliError } from "../../../shared/errors.js";
import { pkgVersion, pkgName } from "../../../version.js";
import {
  installClaudeConfig,
  installSkills,
  mergeClaudeSettings,
  refreshAgentsMd,
  type ClaudeSettings,
} from "./init.js";
import {
  computeArtifactDiff,
  dkkHookBasenames,
  dkkPermissionAllowEntries,
  scanInstalledArtifacts,
  type ArtifactDiff,
} from "../dkk-artifacts.js";
import { detectInstallMode, fetchLatestVersion, type InstallInfo } from "../install-mode.js";
import { pruneDkkEntries } from "../settings-prune.js";
import { ensureMcpRegistered, type McpRegisterOutcome } from "../mcp-register.js";

interface UpdateOpts {
  root?: string;
  yes?: boolean;
  check?: boolean;
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

  // Skip Phase A/B/C entirely if we're already in the re-exec'd child.
  if (!opts.postUpgrade) {
    const install = detectInstallMode();
    if (install.mode === "npx") {
      console.error("Error: `dkk update` can't upgrade an npx-launched install.");
      console.error("Hint: install dkk globally (`npm i -g domain-knowledge-kit`) or as a devDependency, then re-run.");
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

  // ── Phase D: Artifact diff + sweep + reinstall ──────────────────────
  let diffSummary = { added: 0, replaced: 0, removed: 0 };
  // Track whether settings.json existed before the install path; if it
  // didn't, Phase E has nothing to prune — installClaudeConfig just wrote
  // a pristine copy of the template.
  const settingsExistedBefore = existsSync(join(root, ".claude", "settings.json"));
  if (!opts.skipArtifacts) {
    const diff = computeArtifactDiff(root);
    printArtifactDiff(diff);

    if (opts.check) {
      console.log("\n(--check) No changes made. Re-run without --check to apply.");
      return;
    }

    const totalChanges = diff.toAdd.length + diff.toReplace.length + diff.toRemove.length;
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
      sweepRemovedArtifacts(root);
      installClaudeConfig(root, /*force*/ true, { skipSettings: true });
      installSkills(root, /*force*/ true);
      diffSummary = { added: diff.toAdd.length, replaced: diff.toReplace.length, removed: diff.toRemove.length };
    }
  }

  // ── Phase E: settings.json prune + remerge ──────────────────────────
  const settingsResult = pruneAndRemergeSettings(root, opts, settingsExistedBefore);

  // ── Phase F: MCP auto-register ──────────────────────────────────────
  let mcpOutcome: McpRegisterOutcome | { status: "skipped"; reason: string } =
    { status: "skipped", reason: "--skip-mcp" };
  if (!opts.skipMcp && !opts.check) {
    mcpOutcome = ensureMcpRegistered(root);
  }

  // ── Phase G: AGENTS.md refresh ──────────────────────────────────────
  let agentsStatus: "created" | "updated" | "appended" | "skipped" = "skipped";
  if (!opts.check) {
    agentsStatus = refreshAgentsMd(root);
  }

  // ── Phase H: Summary report ─────────────────────────────────────────
  printSummary(diffSummary, settingsResult, mcpOutcome, agentsStatus);
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
  if (opts.skipArtifacts) args.push("--skip-artifacts");
  if (opts.skipMcp) args.push("--skip-mcp");
  if (opts.root) args.push("--root", opts.root);
  // --skip-npm is intentionally NOT forwarded: we've just finished the
  // npm-install step, so a child re-exec should still continue with
  // artifact refresh (the equivalent of --skip-npm at the child level).
  return args;
}

// ── Phase D helpers ───────────────────────────────────────────────────

function printArtifactDiff(diff: ArtifactDiff): void {
  console.log("");
  console.log("Artifact diff against the bundled template:");
  if (diff.toAdd.length === 0 && diff.toReplace.length === 0 && diff.toRemove.length === 0) {
    console.log("  (no changes)");
    return;
  }
  for (const p of diff.toAdd) console.log(`  + add      ${p}`);
  for (const p of diff.toReplace) console.log(`  ~ replace  ${p}`);
  for (const p of diff.toRemove) console.log(`  - remove   ${p}`);
}

function sweepRemovedArtifacts(root: string): void {
  // Recompute the diff at sweep-time so we delete exactly what we promised.
  const diff = computeArtifactDiff(root);
  for (const rel of diff.toRemove) {
    const abs = join(root, rel);
    try {
      rmSync(abs, { recursive: true, force: true });
      console.log(`Removed  ${rel}`);
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
}

// ── Phase E helpers ───────────────────────────────────────────────────

interface SettingsResult {
  status: "no-file" | "pruned-and-merged" | "merge-only" | "skipped" | "malformed";
  pruned: number;
  added: number;
  mixedWarnings: string[];
}

function pruneAndRemergeSettings(
  root: string,
  opts: UpdateOpts,
  existedBefore: boolean,
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

  for (const w of mixedHookWarnings) console.warn(`Warning: ${w}`);

  return {
    status: removed.length > 0 ? "pruned-and-merged" : "merge-only",
    pruned: removed.length,
    added: changes.length,
    mixedWarnings: mixedHookWarnings,
  };
}

// ── Phase H helpers ───────────────────────────────────────────────────

function printSummary(
  diff: { added: number; replaced: number; removed: number },
  settings: SettingsResult,
  mcp: McpRegisterOutcome | { status: "skipped"; reason: string },
  agents: "created" | "updated" | "appended" | "skipped",
): void {
  console.log("");
  console.log("── Summary ────────────────────────────────────────────────────────");
  console.log(`dkk           ${pkgVersion}`);
  console.log(`Artifacts     +${diff.added} added, ~${diff.replaced} replaced, -${diff.removed} removed`);
  console.log(`settings.json ${formatSettingsResult(settings)}`);
  console.log(`MCP server    ${formatMcpResult(mcp)}`);
  console.log(`AGENTS.md     ${agents}`);
  console.log("");
  console.log("Next: run `dkk render` to validate the domain model.");
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
