/**
 * Prune DKK-owned entries from a Claude `settings.json` payload.
 *
 * Used by `dkk update` to clear stale entries (e.g. hooks for scripts that
 * have been renamed or removed) before re-applying the additive merge with
 * the new template. User-authored entries are preserved untouched.
 *
 * Decision boundaries (see [[dkk-artifacts]] for the predicate source of
 * truth):
 *
 * - A `permissions.allow` entry is DKK-owned iff it appears verbatim in
 *   the bundled template's allow list. Exact string equality is the right
 *   bar because the template's allow patterns are stable identifiers.
 * - A `hooks.<event>` sub-entry is DKK-owned iff **every** `hooks[].command`
 *   inside it resolves via {@link extractHookBasename} to a DKK basename.
 *   Mixed entries (some DKK, some user-authored) are left intact and
 *   reported as warnings — pruning them partially would mutate
 *   user-authored data.
 */
import { extractHookBasename, type ClaudeSettings } from "./commands/init.js";

export interface PruneResult {
  pruned: ClaudeSettings;
  /** Human-readable summary of what was removed. */
  removed: string[];
  /** Hook entries that contained a mix of DKK + user-owned commands; left intact. */
  mixedHookWarnings: string[];
}

export function pruneDkkEntries(
  settings: ClaudeSettings,
  dkkAllow: ReadonlySet<string>,
  dkkHookBasenames: ReadonlySet<string>,
): PruneResult {
  // Deep-clone so callers can compare before/after without surprise.
  const pruned: ClaudeSettings = JSON.parse(JSON.stringify(settings));
  const removed: string[] = [];
  const mixedHookWarnings: string[] = [];

  // permissions.allow — drop exact-string matches.
  if (Array.isArray(pruned.permissions?.allow)) {
    const before = pruned.permissions!.allow;
    const kept: string[] = [];
    for (const entry of before) {
      if (dkkAllow.has(entry)) {
        removed.push(`permissions.allow: ${entry}`);
      } else {
        kept.push(entry);
      }
    }
    pruned.permissions!.allow = kept;
  }

  // hooks.* — drop entries whose every command resolves to a DKK basename.
  if (pruned.hooks && typeof pruned.hooks === "object") {
    for (const [event, entries] of Object.entries(pruned.hooks)) {
      if (!Array.isArray(entries)) continue;
      const kept = [];
      for (const entry of entries) {
        const commands = entry.hooks ?? [];
        if (commands.length === 0) {
          kept.push(entry);
          continue;
        }
        const basenames = commands.map((h) => extractHookBasename(h.command));
        const dkkOwned = basenames.filter((b): b is string => b !== null && dkkHookBasenames.has(b));
        const allDkk = basenames.every((b) => b !== null && dkkHookBasenames.has(b));
        const someDkk = dkkOwned.length > 0;
        if (allDkk) {
          removed.push(`hooks.${event}: ${basenames.filter(Boolean).join(", ")}`);
          continue;
        }
        if (someDkk) {
          mixedHookWarnings.push(
            `hooks.${event}: mixed DKK/user commands left intact (DKK: ${dkkOwned.join(", ")})`,
          );
        }
        kept.push(entry);
      }
      pruned.hooks[event] = kept;
    }
  }

  return { pruned, removed, mixedHookWarnings };
}
