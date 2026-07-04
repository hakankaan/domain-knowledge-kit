#!/usr/bin/env node
/**
 * PostToolUse hook — two feedback loops, routed by what was edited.
 *
 * 1. Domain files (`.dkk/domain/**.yml`, `.dkk/adr/*.md`):
 *    run `dkk validate --file <path>` — SCHEMA-ONLY validation of the
 *    edited file. Deliberately not full cross-ref validation: a
 *    logically-atomic change (aggregate + commands + events + ADR)
 *    spans several files, and validating the whole model after each
 *    single edit fails N−1 times on refs to files not yet written.
 *    Schema checks can't false-positive that way. Full cross-reference
 *    validation runs at the batch boundary (the Stop hook / `dkk render`).
 *
 * 2. Everything else (code edits): emit a one-line relevance nudge when
 *    the file maps to a bounded context via `code_refs` — the context
 *    name, model staleness, and linked ADRs — so the agent knows the
 *    edit lands on modeled ground. Throttled to once per context per
 *    session. This is the loop that fires on CODE changes; without it
 *    every DKK signal presupposes you are already inside `.dkk/`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

/** Extensions that never warrant a domain-relevance nudge. */
const NUDGE_SKIP_EXT =
  /\.(md|mdx|txt|json|jsonc|yml|yaml|lock|svg|png|jpe?g|gif|ico|webp|snap|map|log|csv)$/i;

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  const filePath =
    payload?.tool_input?.file_path ??
    payload?.tool_input?.notebook_path ??
    "";
  if (!filePath) process.exit(0);

  const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  const isDomainFile =
    /\.dkk\/domain\/.*\.ya?ml$/.test(filePath) ||
    /\.dkk\/adr\/[^/]+\.md$/.test(filePath);

  if (isDomainFile) {
    validateDomainFile(filePath, repoRoot);
    return;
  }

  nudgeCodeEdit(filePath, repoRoot, payload?.session_id ?? "default");
});

/** Schema-only validation of one edited domain file. */
function validateDomainFile(filePath, repoRoot) {
  const res = spawnSync("dkk", ["validate", "--file", filePath, "--json", "--minify"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  // Tooling problem (dkk not on PATH, spawn error, etc.) — surface a clear
  // setup error to the user, but don't block the agent with a phantom
  // "validation failure" it has no way to fix.
  if (res.error?.code === "ENOENT") {
    process.stderr.write(
      "dkk post-edit hook: 'dkk' CLI not found on PATH — install with `npm i -g domain-knowledge-kit` to enable auto-validation.\n",
    );
    process.exit(1);
  }
  if (res.error) {
    process.stderr.write(
      `dkk post-edit hook: failed to invoke validator — ${res.error.message}\n`,
    );
    process.exit(1);
  }

  // If validate fails, surface the JSON output to the model via stderr (exit 2
  // makes Claude Code feed stderr back as a tool-result correction signal).
  if (res.status !== 0) {
    const body =
      res.stdout ||
      res.stderr ||
      "(validator exited non-zero with no output — likely a tooling/wiring problem, not a domain issue)";
    process.stderr.write(
      `dkk schema validation failed for ${filePath} (cross-refs are checked at turn end):\n${body}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
}

/**
 * Relevance nudge for a code edit: if the file maps to a context via
 * code_refs, inject one line of additionalContext. Silent on any
 * failure — this path must never nag or block.
 */
function nudgeCodeEdit(filePath, repoRoot, sessionId) {
  // Fast bails before paying for a spawn.
  if (filePath.includes("/.dkk/") || filePath.includes("/node_modules/")) process.exit(0);
  if (NUDGE_SKIP_EXT.test(filePath)) process.exit(0);
  if (!existsSync(join(repoRoot, ".dkk", "domain"))) process.exit(0);
  if (!existsSync(resolve(filePath))) process.exit(0);

  const res = spawnSync("dkk", ["drift", "map", filePath, "--json", "--minify"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (res.error || res.status !== 0) process.exit(0);

  let info;
  try {
    info = JSON.parse(res.stdout);
  } catch {
    process.exit(0);
  }
  if (!info?.context) process.exit(0);

  // Throttle: one nudge per context per session.
  const stateFile = join(tmpdir(), `dkk-nudge-${sanitize(sessionId)}.json`);
  let seen = {};
  try {
    seen = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    /* first nudge this session */
  }
  if (seen[info.context]) process.exit(0);
  seen[info.context] = true;
  try {
    writeFileSync(stateFile, JSON.stringify(seen), "utf8");
  } catch {
    /* non-fatal — worst case we nudge twice */
  }

  const staleness =
    info.daysSinceModelChange !== null && info.daysSinceModelChange !== undefined
      ? ` (last modeled ${info.daysSinceModelChange}d ago; ${info.commitsSinceModelChange} commit(s) to bound code since)`
      : "";
  const adrs = info.adrs?.length ? `; decisions: ${info.adrs.join(", ")}` : "";
  const context =
    `DKK: ${info.file} is modeled by bounded context \`${info.context}\`${staleness}${adrs}. ` +
    `If this change adds/renames/removes domain behaviour, update the pack (dkk_guide topic 'update'); ` +
    `if it implements an architectural decision, check those ADRs first (dkk_show).`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: context,
      },
    }),
  );
  process.exit(0);
}

/** Keep tmp filenames safe regardless of what the harness sends as session id. */
function sanitize(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
