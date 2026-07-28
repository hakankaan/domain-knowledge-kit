/**
 * Case-only renames of DKK-managed artifacts, routed through git.
 *
 * DKK ships files whose exact spelling is load-bearing — `SKILL.md` is
 * case-sensitive per the Agent Skills spec, so a lingering `skill.md` is
 * invisible to every consumer on a case-sensitive filesystem. Fixing that on
 * disk is easy; making it *stick in the repo* is the hard half:
 *
 * On macOS and Windows `core.ignorecase` is true, so git matches the
 * working-tree entry `SKILL.md` against the index entry `skill.md` and reports
 * no change at all. The rename never lands in a commit — Linux checkouts and
 * CI keep serving the lowercase file, and every subsequent `dkk update` on a
 * case-insensitive machine re-does the same invisible rename forever.
 *
 * `git mv -f` is the one operation that records a case-only rename on such a
 * filesystem, so that is what this module uses whenever the stale entry is
 * tracked. Untracked files (and non-git trees) fall back to a plain rename,
 * which is sufficient because there is no index to disagree with. A tracked
 * file whose `git mv` fails is reported so the user can fix it by hand rather
 * than shipping a rename that silently does not exist.
 */
import { readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { gitMove, isGitRepo, isPathTracked } from "../../shared/git.js";

export interface CaseRename {
  /** Repo-relative POSIX path of the wrongly-cased entry on disk. */
  fromRel: string;
  /** Repo-relative POSIX path it should be spelled as. */
  toRel: string;
}

/**
 * Find on-disk entries that differ from an expected artifact path by case
 * alone.
 *
 * `existsSync` cannot answer this: on APFS/NTFS it returns true for
 * `SKILL.md` when only `skill.md` is present, which is precisely the
 * confusion being untangled. The real directory listing is the only
 * authority on how a file is actually spelled.
 */
export function findCaseVariants(root: string, expectedFiles: readonly string[]): CaseRename[] {
  const found: CaseRename[] = [];
  const seen = new Set<string>();

  for (const dest of expectedFiles) {
    const dir = dirname(dest);
    const want = basename(dest);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === want) continue;
      if (entry.toLowerCase() !== want.toLowerCase()) continue;
      const fromRel = toRel(root, join(dir, entry));
      if (seen.has(fromRel)) continue;
      seen.add(fromRel);
      found.push({ fromRel, toRel: toRel(root, dest) });
    }
  }
  return found;
}

export interface CaseRenameResult {
  /** Renames that landed, as `from → to` strings, for the run report. */
  applied: string[];
  /** Renames that happened on disk but could not be recorded in git. */
  warnings: string[];
}

/**
 * Apply `renames`, preferring `git mv -f` so a case-only change is recorded.
 *
 * On a case-sensitive filesystem both spellings can coexist; `git mv -f` and
 * the `renameSync` fallback each overwrite the destination, collapsing them
 * to the canonical one.
 */
export function applyCaseRenames(root: string, renames: readonly CaseRename[]): CaseRenameResult {
  const applied: string[] = [];
  const warnings: string[] = [];
  if (renames.length === 0) return { applied, warnings };

  const inGitRepo = isGitRepo(root);

  for (const rename of renames) {
    const label = `${rename.fromRel} → ${basename(rename.toRel)}`;
    const tracked = inGitRepo && isPathTracked(root, rename.fromRel);

    if (tracked && gitMove(root, rename.fromRel, rename.toRel)) {
      applied.push(`${label} (recorded by git)`);
      continue;
    }

    try {
      // `renameSync` refuses to clobber a directory, and a stale entry could
      // in principle be one; force-remove the destination first only when the
      // two are genuinely distinct paths on this filesystem.
      const from = join(root, rename.fromRel);
      const to = join(root, rename.toRel);
      if (from !== to) {
        try { rmSync(to, { recursive: true, force: true }); } catch { /* best effort */ }
      }
      renameSync(from, to);
    } catch (err) {
      warnings.push(`could not rename ${label}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (tracked) {
      // The rename happened on disk but git refused to record it. On a
      // case-insensitive filesystem that means the repo still carries the old
      // spelling and the fix will not reach anyone else.
      warnings.push(
        `renamed ${label} on disk, but \`git mv\` failed — on a case-insensitive filesystem ` +
        `git will not see this rename. Record it by hand: ` +
        `\`git mv -f "${rename.fromRel}" "${rename.toRel}"\``,
      );
    }
    applied.push(label);
  }

  return { applied, warnings };
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).replace(/\\/g, "/");
}
