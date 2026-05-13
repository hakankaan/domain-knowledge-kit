/**
 * Sparse-checkout fetcher for git-source peers.
 *
 * Clones a peer repository into a local cache, pulling only the
 * subdirectory containing `.dkk/` to keep disk cost minimal — a
 * typical peer is well under a megabyte.
 *
 * The user's existing git credential helper / SSH agent is what
 * authenticates the clone. DKK never handles tokens directly.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Options for {@link sparseFetch}.
 */
export interface SparseFetchOptions {
  /** Git URL (https / ssh). */
  url: string;
  /** Branch to track. */
  branch: string;
  /**
   * Sub-path inside the peer repo where the service lives (i.e. the
   * directory whose child is `.dkk/`). Empty string for repos that
   * have `.dkk/` at the root.
   */
  subpath: string;
  /**
   * Absolute destination directory. Will be wiped if it exists.
   * After fetch, the peer's repo content lives at `<dest>` and the
   * service's `.dkk/` lives at `<dest>/<subpath>/.dkk` (or
   * `<dest>/.dkk` when subpath is empty).
   */
  dest: string;
}

/** Result of a successful sparse fetch. */
export interface SparseFetchResult {
  /** Resolved commit SHA at HEAD of the fetched branch. */
  sha: string;
}

/**
 * Run `git` with the given args inside `cwd`. Throws on non-zero exit.
 * Captures stdout for callers that need it (e.g. `rev-parse`).
 */
function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim();
}

/**
 * Clone a peer repository into `dest` using a sparse-checkout of only
 * the `.dkk/` subtree. The clone is depth-1 + blobless to keep it fast
 * and small. Returns the resolved commit SHA.
 *
 * Steps:
 *   1. Wipe `dest` if it exists (a stale partial clone is worse than no clone).
 *   2. `git clone --filter=blob:none --depth 1 --no-checkout --branch <b> <url> <dest>`.
 *   3. `git sparse-checkout init --no-cone` inside `dest`.
 *   4. `git sparse-checkout set <subpath>/.dkk` (or `.dkk` when subpath empty).
 *   5. `git checkout <branch>` to materialise the sparse set on disk.
 *   6. `git rev-parse HEAD` to capture the SHA.
 *
 * Errors from `git` propagate as thrown exceptions with their stderr
 * attached, so the caller can surface a meaningful message to the user.
 */
export function sparseFetch(opts: SparseFetchOptions): SparseFetchResult {
  if (existsSync(opts.dest)) {
    rmSync(opts.dest, { recursive: true, force: true });
  }
  mkdirSync(dirname(opts.dest), { recursive: true });

  // Step 2: blobless, depth-1, no checkout yet.
  git(
    [
      "clone",
      "--filter=blob:none",
      "--depth",
      "1",
      "--no-checkout",
      "--branch",
      opts.branch,
      opts.url,
      opts.dest,
    ],
    process.cwd(),
  );

  // Steps 3-4: enable sparse-checkout, restrict to the .dkk/ subtree.
  git(["sparse-checkout", "init", "--no-cone"], opts.dest);
  const sparsePattern = opts.subpath
    ? `${opts.subpath.replace(/\/$/, "")}/.dkk/*`
    : ".dkk/*";
  git(["sparse-checkout", "set", sparsePattern], opts.dest);

  // Step 5: materialise.
  git(["checkout", opts.branch], opts.dest);

  // Step 6: capture HEAD SHA.
  const sha = git(["rev-parse", "HEAD"], opts.dest);

  return { sha };
}
