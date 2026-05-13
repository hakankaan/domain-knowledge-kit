/**
 * `dkk pull [<name>]` — fetch git-source peers into `.dkk/imports/`.
 *
 * Behaviour:
 *  - Local-source peers are silently skipped (always live from disk).
 *  - For each git-source peer, sparse-checkout `.dkk/` into the cache
 *    at `.dkk/imports/<service>/`, then record the resolved SHA in
 *    `.dkk/federation.lock.json`.
 *  - `--refresh` forces a re-fetch even when the cache already exists.
 *  - `--offline` skips all git calls; a warning is emitted if the
 *    cache is missing for any git peer.
 *
 * The command exits 0 if every git peer either fetched successfully
 * or was already up-to-date; exits 1 if any fetch errored.
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { repoRoot, importedServiceDir, importsDir, federationLockFile } from "../../../shared/paths.js";
import { loadFederation } from "../loader.js";
import { sparseFetch } from "../git-fetcher.js";
import { readLock, writeLock, makeEntry } from "../lock.js";
import type { PeerSpec, FederationLock } from "../../../shared/types/federation.js";

interface PullOpts {
  root?: string;
  refresh?: boolean;
  offline?: boolean;
  json?: boolean;
  minify?: boolean;
}

interface PullReport {
  /** Peer name. */
  name: string;
  /** What happened. */
  outcome: "fetched" | "cached" | "skipped-local" | "skipped-offline-cached" | "error" | "missing-cache-offline";
  /** SHA recorded in the lockfile after the operation (if known). */
  sha?: string;
  /** Error or warning message. */
  message?: string;
}

export function registerPull(program: Cmd): void {
  program
    .command("pull [name]")
    .description("Fetch git-source federation peers into .dkk/imports/")
    .option("-r, --root <path>", "Override repository root")
    .option("--refresh", "Re-fetch even if the cache is already populated")
    .option("--offline", "Use existing cache only; do not contact any remote")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .action((name: string | undefined, opts: PullOpts) => {
      const root = repoRoot(opts.root);
      const manifest = loadFederation(opts.root);

      if (!manifest || manifest.peers.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ peers: [] }, null, opts.minify ? 0 : 2));
          return;
        }
        console.log("No peers configured.");
        return;
      }

      // Optional filter to a single peer name.
      const targets = name
        ? manifest.peers.filter((p) => p.name === name)
        : manifest.peers;
      if (name && targets.length === 0) {
        console.error(`Error: no peer named "${name}" in federation.yml.`);
        process.exit(1);
      }

      // Ensure the imports cache directory is gitignored. We write a
      // self-contained `.gitignore` containing `*` inside .dkk/imports/
      // so the cache stays local to each developer regardless of what
      // the project's root .gitignore says. Cheap (~10 bytes) and
      // protects against accidental commits.
      ensureImportsGitignore(root);

      const lock: FederationLock = readLock(opts.root);
      const reports: PullReport[] = [];
      let anyError = false;

      for (const peer of targets) {
        if (peer.source.type === "local") {
          reports.push({ name: peer.name, outcome: "skipped-local" });
          continue;
        }

        // Git source.
        const cacheDir = importedServiceDir(peer.name, root);
        const cacheExists = existsSync(cacheDir + "/.dkk");

        if (opts.offline) {
          if (cacheExists) {
            reports.push({
              name: peer.name,
              outcome: "skipped-offline-cached",
              sha: lock[peer.name]?.sha,
            });
          } else {
            reports.push({
              name: peer.name,
              outcome: "missing-cache-offline",
              message: `cache missing and --offline set; run \`dkk pull ${peer.name}\` without --offline`,
            });
          }
          continue;
        }

        // Re-fetch only when forced, cache empty, or the recorded
        // source has drifted from the manifest (url/branch/path change).
        const recorded = lock[peer.name];
        const sourceChanged = !sourceMatches(recorded?.source, peer.source);
        const needFetch = opts.refresh || !cacheExists || sourceChanged;

        if (!needFetch) {
          reports.push({
            name: peer.name,
            outcome: "cached",
            sha: recorded?.sha,
          });
          continue;
        }

        try {
          const result = sparseFetch({
            url: peer.source.url,
            branch: peer.source.branch,
            subpath: peer.source.path ?? "",
            dest: cacheDir,
          });
          lock[peer.name] = makeEntry(peer.source, result.sha);
          reports.push({
            name: peer.name,
            outcome: "fetched",
            sha: result.sha,
          });
        } catch (err) {
          anyError = true;
          const msg = err instanceof Error ? err.message : String(err);
          reports.push({
            name: peer.name,
            outcome: "error",
            message: msg,
          });
        }
      }

      // Always re-serialize the lock so order stays stable, even when
      // nothing changed.
      writeLock(lock, opts.root);

      if (opts.json) {
        console.log(
          JSON.stringify(
            { lock: federationLockFile(opts.root), peers: reports },
            null,
            opts.minify ? 0 : 2,
          ),
        );
        if (anyError) process.exit(1);
        return;
      }

      for (const r of reports) {
        const tag = `[${r.outcome}]`;
        const sha = r.sha ? `  ${r.sha.slice(0, 12)}` : "";
        const msg = r.message ? `  ${r.message}` : "";
        console.log(`${r.name.padEnd(20)} ${tag}${sha}${msg}`);
      }
      if (anyError) process.exit(1);
    });
}

/**
 * Create `.dkk/imports/.gitignore` (containing `*`) if it doesn't
 * exist. Keeps the cache directory off git regardless of what the
 * project's root .gitignore says.
 */
function ensureImportsGitignore(root: string): void {
  const dir = importsDir(root);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const gi = `${dir}/.gitignore`;
  if (!existsSync(gi)) {
    writeFileSync(
      gi,
      "# Auto-generated by `dkk pull`. Keeps the federation peer cache\n# off git regardless of the project's root .gitignore.\n*\n",
      "utf-8",
    );
  }
}

/** Compare two source specs by value to detect manifest drift. */
function sourceMatches(
  a: PeerSpec["source"] | undefined,
  b: PeerSpec["source"],
): boolean {
  if (!a) return false;
  if (a.type !== b.type) return false;
  if (a.type === "git" && b.type === "git") {
    return a.url === b.url && a.branch === b.branch && (a.path ?? "") === (b.path ?? "");
  }
  if (a.type === "local" && b.type === "local") {
    return a.path === b.path;
  }
  return false;
}
