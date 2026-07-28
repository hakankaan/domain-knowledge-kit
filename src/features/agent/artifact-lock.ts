/**
 * `.dkk/artifacts.lock` — a record of what DKK last wrote to this repo.
 *
 * Without it, "the file on disk differs from the bundled template" conflates
 * two opposite situations:
 *
 *   1. the file is a *previous DKK version's* copy — overwriting is the whole
 *      point of an upgrade;
 *   2. the user *deliberately edited it* — overwriting destroys their work.
 *
 * A sha256 per shipped artifact separates them. Hash matches what DKK last
 * wrote → the local file is untouched, overwrite silently. Hash differs → the
 * file was edited after install, so `dkk update` keeps the local copy and
 * drops the new template alongside it as `<name>.new`.
 *
 * The lock is derived, never hand-maintained: {@link writeArtifactLock}
 * records a hash only for artifacts whose on-disk content *equals* the
 * bundled template after an install run. A conflicted file therefore never
 * gets its hash refreshed — it keeps reporting as a conflict until the user
 * resolves it, which is the safe direction to fail.
 *
 * Commit it: teammates and CI need the same conflict detection.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ShippedArtifact } from "./dkk-artifacts.js";
import { pkgVersion } from "../../version.js";

/** Bumped only on an incompatible change to the on-disk shape. */
export const ARTIFACT_LOCK_VERSION = 1;

/**
 * Suffix DKK appends when it refuses to overwrite a locally-edited artifact:
 * the local file stays put and the new template lands beside it as
 * `<name>.new` for the user to merge.
 *
 * These copies are DKK-written but are *not* themselves managed artifacts —
 * every scan must skip them, or the next run would flag them for deletion and
 * throw away the very template the user still needs.
 */
export const CONFLICT_SUFFIX = ".new";

export interface ArtifactLockFile {
  version: number;
  /** DKK version that last wrote the lock — diagnostic only. */
  dkk: string;
  /** Repo-relative POSIX path → sha256 hex of the content DKK wrote. */
  artifacts: Record<string, string>;
}

/** Absolute path to `.dkk/artifacts.lock`. */
export function artifactLockPath(root: string): string {
  return join(root, ".dkk", "artifacts.lock");
}

/** sha256 hex of a UTF-8 string. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** sha256 hex of a file's contents, or `null` if it can't be read. */
export function sha256File(absPath: string): string | null {
  try {
    return sha256(readFileSync(absPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Read `.dkk/artifacts.lock`.
 *
 * Returns `null` when the file is absent, unparseable, or carries a version
 * this build doesn't understand. Callers must treat `null` as "no provenance
 * information" — which means they cannot tell an edit from a stale copy and
 * must say so, rather than guessing.
 */
export function readArtifactLock(root: string): ArtifactLockFile | null {
  const path = artifactLockPath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<ArtifactLockFile>;
    if (parsed.version !== ARTIFACT_LOCK_VERSION) return null;
    if (!parsed.artifacts || typeof parsed.artifacts !== "object") return null;
    const artifacts: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.artifacts)) {
      if (typeof v === "string") artifacts[k] = v;
    }
    return { version: ARTIFACT_LOCK_VERSION, dkk: String(parsed.dkk ?? ""), artifacts };
  } catch {
    return null;
  }
}

/**
 * Rewrite `.dkk/artifacts.lock` after an install/refresh run.
 *
 * For every shipped artifact whose on-disk content now equals the bundled
 * template, record the template's hash — that file is provably DKK's. Every
 * other entry is carried forward from the previous lock, so a conflicted file
 * keeps the hash of the version DKK *did* write; if the user later reverts
 * their edit, the hash matches again and the file goes back to being a clean
 * overwrite instead of a permanent conflict.
 *
 * Entries whose file no longer exists are dropped, so retired templates don't
 * accumulate.
 */
export function writeArtifactLock(root: string, shipped: readonly ShippedArtifact[]): void {
  const previous = readArtifactLock(root);
  const artifacts: Record<string, string> = {};

  // Carry forward anything still on disk (covers conflicts and artifacts
  // belonging to a surface this run didn't touch).
  for (const [rel, hash] of Object.entries(previous?.artifacts ?? {})) {
    if (existsSync(join(root, rel))) artifacts[rel] = hash;
  }

  for (const artifact of shipped) {
    const template = readIfPresent(artifact.src);
    const onDisk = readIfPresent(artifact.dest);
    if (template === null || onDisk === null) continue;
    if (template === onDisk) artifacts[artifact.rel] = sha256(template);
  }

  const payload: ArtifactLockFile = {
    version: ARTIFACT_LOCK_VERSION,
    dkk: pkgVersion,
    // Sorted so the committed file has a stable, review-friendly diff.
    artifacts: Object.fromEntries(Object.entries(artifacts).sort(([a], [b]) => (a < b ? -1 : 1))),
  };

  const path = artifactLockPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

function readIfPresent(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}
