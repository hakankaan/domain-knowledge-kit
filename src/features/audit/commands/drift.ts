/**
 * `dkk drift` — git-aware model/code freshness checks.
 *
 * The validator can only measure a pack's *internal* consistency; a pack
 * frozen for weeks stays green while the code moves on. This command
 * closes that gap using `code_refs` bindings (context.yml → source path
 * globs) plus git history:
 *
 *   dkk drift              report stale contexts, dead bindings,
 *                          uncovered source dirs (exit 0 — advisory)
 *   dkk drift --strict     same, but exit 1 on findings (CI gate)
 *   dkk drift ack <ctx…>   record "reviewed, still accurate" at HEAD
 *                          without a meaningless YAML touch
 *   dkk drift map <file>   which context binds a source file + staleness
 *                          (used by the post-edit relevance nudge hook)
 *
 * Design constraints:
 *  - Nudge in the loop, gate only in CI: default exit code is 0 so the
 *    agent/dev loop is never blocked on staleness it wasn't asked to fix.
 *  - An ack mechanism is required: without it the only way to say
 *    "reviewed, still accurate" is a noise edit to the YAML.
 *  - Everything degrades gracefully without git (dead-binding and
 *    coverage checks still run; staleness is skipped).
 */
import type { Command as Cmd } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fg from "fast-glob";
import picomatch from "picomatch";
import { loadDomainModel } from "../../../shared/loader.js";
import { repoRoot, repoRelative } from "../../../shared/paths.js";
import { parseYaml, stringifyYaml } from "../../../shared/yaml.js";
import { forEachItem, itemAdrRefs } from "../../../shared/item-visitor.js";
import {
  isGitRepo,
  headSha,
  lastCommitTouching,
  commitTimestamp,
  countCommitsSince,
  globPathspec,
} from "../../../shared/git.js";
import type { DomainModel, DomainContext } from "../../../shared/types/domain.js";

// ── Config (.dkk/drift.yml) ───────────────────────────────────────────

/** Shape of the optional `.dkk/drift.yml` state/config file. */
interface DriftConfig {
  /**
   * Directory globs that define what counts as a "source unit" for the
   * coverage check (e.g. `apps/*`, `packages/*`). When absent, common
   * workspace layouts are auto-detected.
   */
  source_roots?: string[];
  /**
   * Per-context "reviewed at" commit SHAs written by `dkk drift ack`.
   * The staleness baseline for a context is the newer of (last commit
   * touching its model dir, its ack SHA).
   */
  acks?: Record<string, string>;
}

function driftFile(root?: string): string {
  return join(repoRoot(root), ".dkk", "drift.yml");
}

function loadDriftConfig(root?: string): DriftConfig {
  const path = driftFile(root);
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = parseYaml<unknown>(readFileSync(path, "utf-8"));
  } catch {
    console.warn(`dkk drift: could not parse ${path} — ignoring it.`);
    return {};
  }

  // Normalise defensively: this file is hand-editable, and a wrong-typed
  // value (e.g. `source_roots: apps/*` as a scalar) must not leak into
  // iteration logic as a string-of-characters.
  const config: DriftConfig = {};
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.source_roots)) {
      config.source_roots = r.source_roots.filter((s): s is string => typeof s === "string");
    }
    if (r.acks && typeof r.acks === "object" && !Array.isArray(r.acks)) {
      config.acks = {};
      for (const [k, v] of Object.entries(r.acks as Record<string, unknown>)) {
        if (typeof v === "string") config.acks[k] = v;
      }
    }
  }
  return config;
}

function saveDriftConfig(config: DriftConfig, root?: string): void {
  writeFileSync(driftFile(root), stringifyYaml(config), "utf-8");
}

// ── Shared analysis helpers ───────────────────────────────────────────

const GLOB_IGNORE = ["**/node_modules/**", "**/.git/**", ".dkk/**"];

/** Expand one context's code_refs; returns matched files and dead globs. */
function expandBindings(
  ctx: DomainContext,
  cwd: string,
): { matched: string[]; deadGlobs: string[] } {
  const matched: string[] = [];
  const deadGlobs: string[] = [];
  for (const glob of ctx.code_refs ?? []) {
    let files: string[];
    try {
      files = fg.sync(glob, { cwd, ignore: GLOB_IGNORE, dot: false, onlyFiles: true });
    } catch {
      deadGlobs.push(glob);
      continue;
    }
    if (files.length === 0) deadGlobs.push(glob);
    else matched.push(...files);
  }
  return { matched, deadGlobs };
}

/** Staleness numbers for one context, or null when git can't answer. */
interface ContextStaleness {
  /** Commits touching bound paths since the baseline (model change or ack). */
  commitsSince: number;
  /** Days since the context's model dir last changed in git. */
  daysSinceModelChange: number;
}

function contextStaleness(
  ctxName: string,
  codeRefs: string[],
  cwd: string,
  acks: Record<string, string>,
): ContextStaleness | null {
  const modelLast = lastCommitTouching(cwd, [`.dkk/domain/contexts/${ctxName}`]);
  if (!modelLast) return null; // model dir never committed — nothing to compare against

  // Baseline = the newer of (last model change, acked review point).
  // Ties (1-second commit-timestamp granularity) go to the ack: it is
  // the explicit "reviewed at HEAD" statement and HEAD is never older
  // than the model commit it follows.
  let baseline = modelLast.sha;
  const ackSha = acks[ctxName];
  if (ackSha) {
    const ackTs = commitTimestamp(cwd, ackSha);
    if (ackTs !== null && ackTs >= modelLast.timestamp) baseline = ackSha;
  }

  const pathspecs = codeRefs.map(globPathspec);
  let commitsSince = countCommitsSince(cwd, baseline, pathspecs);
  // An acked SHA can stop resolving (rebase, history rewrite). Falling
  // back to the model baseline keeps the context visible to drift instead
  // of silently exempting it forever.
  if (commitsSince === null && baseline !== modelLast.sha) {
    commitsSince = countCommitsSince(cwd, modelLast.sha, pathspecs);
  }
  if (commitsSince === null) return null;

  const daysSinceModelChange = Math.floor(
    (Date.now() / 1000 - modelLast.timestamp) / 86_400,
  );
  return { commitsSince, daysSinceModelChange };
}

/**
 * Source units for the coverage check: either the configured
 * `source_roots` globs, or auto-detected workspace layout
 * (`apps/*`, `packages/*`, `libs/*`, `services/*`, plus a bare `src`).
 */
function sourceUnits(cwd: string, config: DriftConfig): string[] {
  const globs = config.source_roots ?? ["apps/*", "packages/*", "libs/*", "services/*"];
  const units = new Set<string>();
  for (const glob of globs) {
    try {
      for (const dir of fg.sync(glob, { cwd, onlyDirectories: true, dot: false })) {
        units.add(dir);
      }
    } catch {
      // invalid configured glob — skip silently; validate covers syntax
    }
  }
  if (!config.source_roots && existsSync(join(cwd, "src"))) units.add("src");
  return [...units].sort();
}

/** Frequency-ranked ADR refs across a context's items (top N). */
function topAdrRefs(ctx: DomainContext, limit = 3): string[] {
  const freq = new Map<string, number>();
  forEachItem(ctx, (_type, _name, item) => {
    for (const ref of itemAdrRefs(item) ?? []) {
      freq.set(ref, (freq.get(ref) ?? 0) + 1);
    }
  });
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ref]) => ref);
}

/** Contexts that declare code_refs, in model order. */
function boundContexts(model: DomainModel): DomainContext[] {
  return [...model.contexts.values()].filter((c) => (c.code_refs ?? []).length > 0);
}

// ── check: analysis (pure — shared by CLI and MCP) ────────────────────

/** One stale-context finding. */
export interface StaleFinding {
  context: string;
  commitsSince: number;
  daysSinceModelChange: number;
  codeRefs: string[];
}

/** The full drift report — JSON output of `dkk drift` and the MCP tool. */
export interface DriftReport {
  /** False when no context declares code_refs (feature unadopted). */
  adopted: boolean;
  /** False when git is unavailable — staleness checks were skipped. */
  gitAvailable: boolean;
  threshold: number;
  stale: StaleFinding[];
  deadBindings: Array<{ context: string; glob: string }>;
  uncoveredDirs: string[];
  unboundContexts: string[];
}

/** Compute the drift report. No printing, no exit codes. */
export function analyzeDrift(
  opts: { root?: string; threshold?: number } = {},
): DriftReport {
  const cwd = repoRoot(opts.root);
  const threshold = Math.max(1, opts.threshold ?? 5);
  const model = loadDomainModel({ root: opts.root });
  const config = loadDriftConfig(opts.root);
  const acks = config.acks ?? {};
  const gitAvailable = isGitRepo(cwd);

  const bound = boundContexts(model);
  const unboundContexts = [...model.contexts.keys()].filter(
    (name) => !bound.some((c) => c.name === name),
  );

  const stale: StaleFinding[] = [];
  const deadBindings: Array<{ context: string; glob: string }> = [];
  const allMatched = new Set<string>();

  for (const ctx of bound) {
    const { matched, deadGlobs } = expandBindings(ctx, cwd);
    for (const glob of deadGlobs) deadBindings.push({ context: ctx.name, glob });
    for (const f of matched) allMatched.add(f);

    if (gitAvailable) {
      const s = contextStaleness(ctx.name, ctx.code_refs ?? [], cwd, acks);
      if (s && s.commitsSince >= threshold) {
        stale.push({
          context: ctx.name,
          commitsSince: s.commitsSince,
          daysSinceModelChange: s.daysSinceModelChange,
          codeRefs: ctx.code_refs ?? [],
        });
      }
    }
  }

  // Coverage: source units no binding reaches. Only meaningful once at
  // least one context is bound — otherwise every unit would be "uncovered"
  // and the report would be pure noise on unadopted packs.
  const uncoveredDirs =
    bound.length > 0
      ? sourceUnits(cwd, config).filter(
          (unit) => ![...allMatched].some((f) => f === unit || f.startsWith(`${unit}/`)),
        )
      : [];

  return {
    adopted: bound.length > 0,
    gitAvailable,
    threshold,
    stale,
    deadBindings,
    uncoveredDirs,
    unboundContexts,
  };
}

// ── check: CLI presentation ───────────────────────────────────────────

function runCheck(opts: {
  root?: string;
  json?: boolean;
  minify?: boolean;
  strict?: boolean;
  threshold?: string;
}): void {
  const report = analyzeDrift({
    root: opts.root,
    threshold: Number(opts.threshold ?? 5) || 5,
  });
  const { adopted, gitAvailable, threshold, stale, deadBindings, uncoveredDirs, unboundContexts } =
    report;
  const findings = stale.length + deadBindings.length + uncoveredDirs.length;

  if (opts.json) {
    console.log(JSON.stringify(report, null, opts.minify ? 0 : 2));
  } else {
    if (!adopted) {
      console.log(
        "No context declares code_refs yet — drift has nothing to check.\n" +
          "Bind contexts to the source they model by adding to context.yml, e.g.:\n\n" +
          "  code_refs:\n    - apps/api/src/billing/**\n\n" +
          "then re-run `dkk drift`.",
      );
      return;
    }

    console.log(`\n🔎 Drift report (staleness threshold: ${threshold} commit(s))\n`);
    if (!gitAvailable) {
      console.log("  ℹ Not a git repository — staleness checks skipped (dead-binding + coverage only).\n");
    }

    if (stale.length > 0) {
      console.log("  ⚠ Stale contexts (bound code changed since the model did):");
      for (const s of stale) {
        console.log(
          `    - ${s.context}: ${s.commitsSince} commit(s) touched bound code; model last changed ${s.daysSinceModelChange}d ago`,
        );
        console.log(`        bound: ${s.codeRefs.join(", ")}`);
        console.log(`        update the model, or \`dkk drift ack ${s.context}\` after verifying it is still accurate`);
      }
      console.log("");
    }

    if (deadBindings.length > 0) {
      console.log("  ✗ Dead bindings (glob matches no files — code deleted/moved?):");
      for (const d of deadBindings) {
        console.log(`    - ${d.context}: "${d.glob}"`);
      }
      console.log("");
    }

    if (uncoveredDirs.length > 0) {
      console.log("  ⚠ Uncovered source dirs (no context's code_refs reach them):");
      for (const dir of uncoveredDirs) {
        console.log(`    - ${dir}/`);
      }
      console.log("");
    }

    if (unboundContexts.length > 0) {
      console.log(
        `  ℹ Contexts without code_refs (invisible to drift): ${unboundContexts.join(", ")}\n`,
      );
    }

    if (findings === 0) {
      console.log("  ✓ No drift detected across bound contexts.\n");
    } else {
      console.log(
        `  Summary: ${stale.length} stale, ${deadBindings.length} dead binding(s), ${uncoveredDirs.length} uncovered dir(s)\n`,
      );
    }
  }

  if (opts.strict && findings > 0) process.exit(1);
}

// ── ack ───────────────────────────────────────────────────────────────

function runAck(contexts: string[], opts: { root?: string }): void {
  const cwd = repoRoot(opts.root);
  if (!isGitRepo(cwd)) {
    console.error("Error: `dkk drift ack` requires a git repository.");
    process.exit(1);
  }
  const sha = headSha(cwd);
  if (!sha) {
    console.error("Error: could not resolve HEAD (no commits yet?).");
    process.exit(1);
  }

  const model = loadDomainModel({ root: opts.root });
  for (const name of contexts) {
    if (!model.contexts.has(name)) {
      console.error(`Error: context "${name}" not found.`);
      process.exit(1);
    }
  }

  const config = loadDriftConfig(opts.root);
  config.acks = config.acks ?? {};
  for (const name of contexts) config.acks[name] = sha;
  saveDriftConfig(config, opts.root);

  for (const name of contexts) {
    console.log(`Acknowledged "${name}" at ${sha.slice(0, 12)} — drift clock reset for this context.`);
  }
  console.log(`\nRecorded in .dkk/drift.yml (commit it with your change).`);
}

// ── map: analysis (pure — shared by CLI, MCP, and the nudge hook) ─────

/** Result of mapping one source file onto the model via code_refs. */
export interface FileMapping {
  /** Repo-relative POSIX path of the queried file. */
  file: string;
  /** Owning context name, or null when no binding matches. */
  context: string | null;
  description?: string;
  codeRefs?: string[];
  daysSinceModelChange?: number | null;
  commitsSinceModelChange?: number | null;
  /**
   * Decisions relevant to this file, most precise first: ADRs whose own
   * `code_refs` match it, then ADRs on the owning context, then the
   * ADRs its items most often cite.
   */
  adrs?: string[];
  /**
   * The subset of `adrs` bound to this path by the ADR's own
   * `code_refs` — an exact statement that the decision governs this
   * file, not an inference from its context.
   */
  adrsBoundDirectly?: string[];
}

/** ADRs whose own `code_refs` glob matches a repo-relative path. */
function adrsBindingFile(model: DomainModel, rel: string): string[] {
  const hits: string[] = [];
  for (const [id, adr] of model.adrs) {
    if (!adr.code_refs?.length) continue;
    if (picomatch.isMatch(rel, adr.code_refs, { dot: false })) hits.push(id);
  }
  return hits.sort();
}

/** Resolve a file to its owning context. No printing, no exit codes. */
export function mapFileToContext(
  file: string,
  opts: { root?: string } = {},
): FileMapping {
  const cwd = repoRoot(opts.root);
  const rel = repoRelative(resolve(file), opts.root);
  const model = loadDomainModel({ root: opts.root });
  const acks = loadDriftConfig(opts.root).acks ?? {};

  // A decision can bind source directly, which is both more precise
  // than inferring it from the context and independent of whether any
  // context claims the file at all.
  const direct = adrsBindingFile(model, rel);

  let match: DomainContext | null = null;
  for (const ctx of boundContexts(model)) {
    if (picomatch.isMatch(rel, ctx.code_refs ?? [], { dot: false })) {
      match = ctx;
      break;
    }
  }

  if (!match) {
    return direct.length
      ? { file: rel, context: null, adrs: direct, adrsBoundDirectly: direct }
      : { file: rel, context: null };
  }

  const staleness = isGitRepo(cwd)
    ? contextStaleness(match.name, match.code_refs ?? [], cwd, acks)
    : null;

  const adrs = [
    ...new Set([...direct, ...(match.adr_refs ?? []), ...topAdrRefs(match)]),
  ];

  return {
    file: rel,
    context: match.name,
    description: match.description,
    codeRefs: match.code_refs ?? [],
    daysSinceModelChange: staleness?.daysSinceModelChange ?? null,
    commitsSinceModelChange: staleness?.commitsSince ?? null,
    adrs,
    ...(direct.length ? { adrsBoundDirectly: direct } : {}),
  };
}

// ── map: CLI presentation ─────────────────────────────────────────────

function runMap(
  file: string,
  opts: { root?: string; json?: boolean; minify?: boolean },
): void {
  const mapping = mapFileToContext(file, { root: opts.root });

  if (opts.json) {
    console.log(JSON.stringify(mapping, null, opts.minify ? 0 : 2));
    return;
  }

  if (!mapping.context) {
    const direct = mapping.adrsBoundDirectly?.length
      ? ` Decisions binding it directly: ${mapping.adrsBoundDirectly.join(", ")}.`
      : "";
    console.log(`${mapping.file}: no context binds this file.${direct}`);
    return;
  }

  const freshness =
    mapping.daysSinceModelChange !== null && mapping.daysSinceModelChange !== undefined
      ? ` (model last changed ${mapping.daysSinceModelChange}d ago; ${mapping.commitsSinceModelChange} commit(s) to bound code since)`
      : "";
  const adrNote = mapping.adrs?.length ? `; ADRs: ${mapping.adrs.join(", ")}` : "";
  console.log(`${mapping.file} → context "${mapping.context}"${freshness}${adrNote}`);
}

// ── Registration ──────────────────────────────────────────────────────

/** Register the `drift` command group. */
export function registerDrift(program: Cmd): void {
  const drift = program
    .command("drift")
    .description("Detect model/code drift via code_refs bindings and git history");

  drift
    .command("check", { isDefault: true })
    .description("Report stale contexts, dead bindings, and uncovered source dirs")
    .option("--threshold <n>", "Commits touching bound code before a context counts as stale", "5")
    .option("--strict", "Exit non-zero when drift is found (CI gate)")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: { root?: string; json?: boolean; minify?: boolean; strict?: boolean; threshold?: string }) => {
      runCheck(opts);
    });

  drift
    .command("ack <contexts...>")
    .description("Mark context(s) as reviewed-and-accurate at current HEAD (resets their drift clock)")
    .option("-r, --root <path>", "Override repository root")
    .action((contexts: string[], opts: { root?: string }) => {
      runAck(contexts, opts);
    });

  drift
    .command("map <file>")
    .description("Show which context binds a source file, with staleness and linked ADRs")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action((file: string, opts: { root?: string; json?: boolean; minify?: boolean }) => {
      runMap(file, opts);
    });
}
