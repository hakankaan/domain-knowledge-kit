/**
 * Thin, defensive wrappers around the `git` CLI.
 *
 * Used by freshness features (`dkk prime` staleness headline, `dkk drift`)
 * that correlate the domain model's history with the code's history.
 *
 * Every helper degrades to `null` when git is unavailable, the directory
 * is not a repository, or the query fails — callers treat `null` as
 * "no git signal" and stay silent rather than erroring. DKK must keep
 * working in non-git environments.
 */
import { spawnSync } from "node:child_process";

/** Result of a `git log -1` style lookup. */
export interface CommitInfo {
  /** Full commit SHA. */
  sha: string;
  /** Committer timestamp (unix seconds). */
  timestamp: number;
}

/** Run a git command in `cwd`; return trimmed stdout or null on any failure. */
function git(cwd: string, args: string[]): string | null {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.error || res.status !== 0) return null;
  return res.stdout.trim();
}

/** True when `cwd` is inside a git work tree. */
export function isGitRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/**
 * True only when `relPath` is git-ignored in `cwd`. `git check-ignore -q`
 * exits 0 when the path is ignored, 1 when not, and 128 on any error (git
 * missing, not a repo). We treat *only* a clean exit 0 as "ignored", so every
 * other outcome — including non-git environments — returns false and callers
 * act only on a confident positive.
 */
export function isPathGitIgnored(cwd: string, relPath: string): boolean {
  const res = spawnSync("git", ["check-ignore", "-q", relPath], { cwd });
  return !res.error && res.status === 0;
}

/** SHA of HEAD, or null. */
export function headSha(cwd: string): string | null {
  return git(cwd, ["rev-parse", "HEAD"]);
}

/**
 * Most recent commit touching any of `paths` (repo-relative). Empty
 * `paths` means "any path". Returns null when there is no such commit.
 */
export function lastCommitTouching(cwd: string, paths: string[]): CommitInfo | null {
  const out = git(cwd, ["log", "-1", "--format=%H %ct", "--", ...paths]);
  if (!out) return null;
  const [sha, ts] = out.split(" ");
  const timestamp = Number(ts);
  if (!sha || !Number.isFinite(timestamp)) return null;
  return { sha, timestamp };
}

/** Committer timestamp (unix seconds) of a commit, or null. */
export function commitTimestamp(cwd: string, sha: string): number | null {
  const out = git(cwd, ["show", "-s", "--format=%ct", sha]);
  const ts = Number(out);
  return out && Number.isFinite(ts) ? ts : null;
}

/**
 * Number of commits in `sinceSha..HEAD`, optionally restricted to
 * `pathspecs`. Pathspecs are passed through verbatim — callers wanting
 * `**` glob semantics should prefix with `:(glob)`.
 */
export function countCommitsSince(
  cwd: string,
  sinceSha: string,
  pathspecs: string[] = [],
): number | null {
  const args = ["rev-list", "--count", `${sinceSha}..HEAD`];
  if (pathspecs.length > 0) args.push("--", ...pathspecs);
  const out = git(cwd, args);
  const n = Number(out);
  return out !== null && Number.isFinite(n) ? n : null;
}

/**
 * Wrap a POSIX glob in git's `:(glob)` pathspec magic so `**` spans
 * directories (plain git pathspec `*` does not cross `/`).
 */
export function globPathspec(glob: string): string {
  return `:(glob)${glob}`;
}
