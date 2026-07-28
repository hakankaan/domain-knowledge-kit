/**
 * `dkk artifacts check` — non-mutating drift gate for CI.
 *
 * Exists because `dkk update --check` cannot serve this purpose:
 *   - it exits 0 even when the diff is non-empty, so it can never fail a build;
 *   - it still runs the npm self-upgrade (only `--skip-npm` suppresses that),
 *     so a "check" mutates node_modules or the global prefix;
 *   - it refuses to run at all under npx, which is how CI usually invokes dkk.
 *
 * This command touches nothing: it computes the same artifact diff `update`
 * uses and exits 1 when the repo has drifted from the bundled template.
 */
import type { Command as Cmd } from "commander";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { repoRoot } from "../../../shared/paths.js";
import { formatCliError } from "../../../shared/errors.js";
import { unifiedDiff } from "../../../shared/unified-diff.js";
import { pkgVersion } from "../../../version.js";
import {
  artifactDiffCount,
  computeArtifactDiff,
  detectAdoptedSurfaces,
  shippedArtifacts,
  type ArtifactDiff,
} from "../dkk-artifacts.js";

interface ArtifactsCheckOpts {
  root?: string;
  json?: boolean;
  diff?: boolean;
}

export function registerArtifacts(program: Cmd): void {
  const artifacts = program
    .command("artifacts")
    .description("Inspect DKK-managed AI assistant artifacts in this repo");

  artifacts
    .command("check")
    .description("Exit non-zero if installed artifacts have drifted from the bundled template (read-only; safe for CI)")
    .option("-r, --root <path>", "Override repository root")
    .option("--json", "Emit the diff as JSON")
    .option("--diff", "Show the unified diff for each outdated or conflicted file")
    .action((opts: ArtifactsCheckOpts) => {
      try {
        const root = repoRoot(opts.root);
        const diff = computeArtifactDiff(root);
        const drifted = artifactDiffCount(diff);

        if (opts.json) {
          console.log(JSON.stringify({ drifted, ...diff }));
        } else {
          printDiff(diff, drifted);
          if (opts.diff) printContentDiffs(root, diff);
        }

        // The whole point of the command: a non-zero exit CI can gate on.
        if (drifted > 0) process.exit(1);
      } catch (err) {
        console.error(`Error: ${formatCliError(err)}`);
        process.exit(2);
      }
    });
}

function printDiff(diff: ArtifactDiff, drifted: number): void {
  if (drifted === 0) {
    console.log("DKK artifacts are up to date with the bundled template.");
    return;
  }

  console.log("DKK artifacts have drifted from the bundled template:");
  console.log("");
  for (const p of diff.toAdd) console.log(`  + missing    ${p}`);
  for (const p of diff.toReplace) console.log(`  ~ outdated   ${p}`);
  for (const p of diff.toConflict) console.log(`  ! conflict   ${p}`);
  for (const p of diff.toRemove) console.log(`  - stale      ${p}`);
  // A case-only rename that never landed in git is invisible to `git status`
  // on macOS/Windows but very visible here — which is the point of running
  // this on Linux CI.
  for (const r of diff.caseRenames) console.log(`  ↻ miscased   ${r.fromRel} (should be ${basename(r.toRel)})`);
  console.log("");

  const noun = drifted === 1 ? "file" : "files";
  console.log(`${drifted} ${noun} out of sync. Run \`dkk update --skip-npm\` to reconcile.`);
  if (diff.toConflict.length > 0) {
    console.log("Files marked `conflict` were edited after dkk installed them; `update` keeps");
    console.log("your version and writes the new template alongside as <path>.new.");
  }
  if (diff.lockMissing) {
    console.log("No .dkk/artifacts.lock in this repo, so local edits can't be told apart from");
    console.log("stale copies. `dkk update` writes one.");
  }
}

/** Unified diff of local content vs. the bundled template, for `--diff`. */
function printContentDiffs(root: string, diff: ArtifactDiff): void {
  const changed = [...diff.toReplace, ...diff.toConflict];
  if (changed.length === 0) return;

  const templates = new Map(
    shippedArtifacts(root, detectAdoptedSurfaces(root)).files.map((f) => [f.rel, f.src]),
  );

  for (const rel of changed) {
    const src = templates.get(rel);
    if (!src) continue;
    const local = read(join(root, rel));
    const template = read(src);
    if (local === null || template === null) continue;
    const body = unifiedDiff(local, template, {
      fromLabel: `${rel} (local)`,
      toLabel: `${rel} (dkk ${pkgVersion})`,
    });
    if (!body) continue;
    console.log("");
    console.log(body);
  }
}

function read(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}
