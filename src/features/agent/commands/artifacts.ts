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
import { repoRoot } from "../../../shared/paths.js";
import { formatCliError } from "../../../shared/errors.js";
import { computeArtifactDiff, type ArtifactDiff } from "../dkk-artifacts.js";

interface ArtifactsCheckOpts {
  root?: string;
  json?: boolean;
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
    .action((opts: ArtifactsCheckOpts) => {
      try {
        const root = repoRoot(opts.root);
        const diff = computeArtifactDiff(root);
        const drifted = diff.toAdd.length + diff.toReplace.length + diff.toRemove.length;

        if (opts.json) {
          console.log(JSON.stringify({ drifted, ...diff }));
        } else {
          printDiff(diff, drifted);
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
  for (const p of diff.toAdd) console.log(`  + missing   ${p}`);
  for (const p of diff.toReplace) console.log(`  ~ outdated  ${p}`);
  for (const p of diff.toRemove) console.log(`  - stale     ${p}`);
  console.log("");
  const noun = drifted === 1 ? "file" : "files";
  console.log(`${drifted} ${noun} out of sync. Run \`dkk update --skip-npm\` to reconcile.`);
}
