/**
 * Federation lockfile (.dkk/federation.lock.json).
 *
 * Records the resolved commit SHA each git-source peer was fetched at,
 * along with a snapshot of the source spec used. Committing the
 * lockfile means two developers running `dkk pull` see the same peer
 * state until someone explicitly re-pulls with `--refresh`.
 *
 * Local-source peers have no lockfile entry — they're always live from
 * disk.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { federationLockFile } from "../../shared/paths.js";
import type { FederationLock, LockEntry } from "../../shared/types/federation.js";

/**
 * Read the lockfile from disk. Returns an empty record when the file
 * is absent. Malformed JSON throws (the file is committed, so a parse
 * failure should be loud).
 */
export function readLock(root?: string): FederationLock {
  const path = federationLockFile(root);
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf-8");
  if (text.trim().length === 0) return {};
  return JSON.parse(text) as FederationLock;
}

/** Write the lockfile to disk with stable formatting. */
export function writeLock(lock: FederationLock, root?: string): void {
  const path = federationLockFile(root);
  mkdirSync(dirname(path), { recursive: true });
  // Stable key ordering (sorted by service name) keeps diffs minimal.
  const sorted: FederationLock = {};
  for (const key of Object.keys(lock).sort()) {
    sorted[key] = lock[key];
  }
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
}

/** Build a fresh lock entry from a fetch result. */
export function makeEntry(
  source: LockEntry["source"],
  sha: string | undefined,
): LockEntry {
  const entry: LockEntry = { source };
  if (sha) entry.sha = sha;
  entry.fetchedAt = new Date().toISOString();
  return entry;
}
