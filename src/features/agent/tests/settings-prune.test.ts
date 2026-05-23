/**
 * Tests for the settings.json prune logic used by `dkk update`.
 *
 * Covers the three scenarios the update flow cares about:
 *   1. DKK-only `permissions.allow` entries are removed; user entries stay.
 *   2. Hook entries whose every command is DKK-owned are removed; mixed
 *      entries (DKK + user) are kept with a warning.
 *   3. Empty settings are handled without throwing.
 */
import { pruneDkkEntries } from "../settings-prune.js";
import type { ClaudeSettings } from "../commands/init.js";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  OK: ${label}`);
    passed++;
  } else {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// Canonical DKK identifiers (subset — enough to exercise the prune logic).
const DKK_ALLOW = new Set([
  "Bash(dkk list:*)",
  "Bash(dkk show:*)",
  "Bash(dkk validate:*)",
]);
const DKK_HOOKS = new Set([
  "session-start-prime.mjs",
  "post-edit-validate.mjs",
]);

console.log("\n=== prune: removes only DKK-owned permissions.allow entries ===");
{
  const input: ClaudeSettings = {
    permissions: {
      allow: [
        "Bash(dkk list:*)",          // DKK-owned
        "Bash(dkk show:*)",          // DKK-owned
        "Bash(myproject build:*)",   // user-authored
        "Bash(custom thing:*)",      // user-authored
      ],
    },
  };
  const { pruned, removed } = pruneDkkEntries(input, DKK_ALLOW, DKK_HOOKS);
  assert(
    "user entries preserved",
    pruned.permissions?.allow?.includes("Bash(myproject build:*)") === true &&
    pruned.permissions?.allow?.includes("Bash(custom thing:*)") === true,
  );
  assert(
    "DKK entries removed from permissions.allow",
    pruned.permissions?.allow?.includes("Bash(dkk list:*)") === false &&
    pruned.permissions?.allow?.includes("Bash(dkk show:*)") === false,
  );
  assert("removed list reports DKK entries", removed.length === 2);
}

console.log("\n=== prune: removes hook entries whose every command is DKK ===");
{
  const input: ClaudeSettings = {
    hooks: {
      SessionStart: [
        {
          // DKK-only entry — should be dropped.
          hooks: [
            { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start-prime.mjs"' },
          ],
        },
        {
          // User-only entry — should be preserved.
          hooks: [{ type: "command", command: "echo user-hook" }],
        },
      ],
    },
  };
  const { pruned } = pruneDkkEntries(input, DKK_ALLOW, DKK_HOOKS);
  const remaining = pruned.hooks?.SessionStart ?? [];
  assert("DKK-only hook entry removed", remaining.length === 1);
  assert(
    "user hook entry preserved",
    remaining[0]?.hooks?.[0]?.command === "echo user-hook",
  );
}

console.log("\n=== prune: leaves mixed hook entries alone with a warning ===");
{
  const input: ClaudeSettings = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start-prime.mjs"' },
            { type: "command", command: "echo also-user-hook" },
          ],
        },
      ],
    },
  };
  const { pruned, mixedHookWarnings } = pruneDkkEntries(input, DKK_ALLOW, DKK_HOOKS);
  assert("mixed entry preserved verbatim", pruned.hooks?.SessionStart?.length === 1);
  assert("mixed warning emitted", mixedHookWarnings.length === 1);
  assert(
    "mixed warning names the DKK hook",
    mixedHookWarnings[0].includes("session-start-prime.mjs"),
  );
}

console.log("\n=== prune: tolerates empty / missing fields ===");
{
  const empty: ClaudeSettings = {};
  const { pruned, removed, mixedHookWarnings } = pruneDkkEntries(empty, DKK_ALLOW, DKK_HOOKS);
  assert("empty settings → no removed entries", removed.length === 0);
  assert("empty settings → no mixed warnings", mixedHookWarnings.length === 0);
  // Deep clone returns an object that's structurally equivalent (also empty).
  assert("empty settings round-trip", JSON.stringify(pruned) === "{}");
}

console.log("\n=== prune: drops empty allow list entries cleanly ===");
{
  const input: ClaudeSettings = {
    permissions: {
      allow: ["Bash(dkk list:*)", "Bash(dkk show:*)", "Bash(dkk validate:*)"],
    },
  };
  const { pruned, removed } = pruneDkkEntries(input, DKK_ALLOW, DKK_HOOKS);
  assert("all DKK entries removed", pruned.permissions?.allow?.length === 0);
  assert("removed list has 3 entries", removed.length === 3);
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
