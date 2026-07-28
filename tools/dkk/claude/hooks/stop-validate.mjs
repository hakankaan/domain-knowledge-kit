#!/usr/bin/env node
/**
 * Stop hook — final validation gate before the agent ends a turn.
 *
 * Runs `dkk validate`. If the domain model is invalid, returns exit code 2
 * with the JSON error report on stderr. Claude Code feeds that back so the
 * agent must fix the broken model before declaring the work complete.
 *
 * **Exit 2 is gated on the validator having produced a report**, not merely on
 * a non-zero status. Those are different failures with opposite remedies:
 *
 * - a parseable report means the domain model is broken — the agent can and
 *   should fix it, so blocking the turn is correct;
 * - no report means `dkk validate` itself failed (not on PATH, crashed, or —
 *   the common one — a Stop hook under nvm/asdf handed an older Node than
 *   dkk's `>=21.2` requirement, where `import.meta.dirname` throws
 *   `ERR_INVALID_ARG_TYPE`). Exit 2 there tells the agent "domain validation
 *   failed" about something it has no way to repair, so every turn re-fires
 *   the hook and the session wedges.
 *
 * Tooling failures therefore exit 1: surfaced to the human, non-blocking for
 * the agent.
 *
 * `stop_hook_active` is honoured to prevent infinite loops if Claude tries
 * to stop again after the hook already fired once.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  if (payload?.stop_hook_active) {
    process.exit(0);
  }

  const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  // No domain model? Nothing to gate on.
  if (!existsSync(resolve(repoRoot, ".dkk/domain"))) process.exit(0);

  const res = spawnSync("dkk", ["validate", "--json", "--minify"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  // Tooling problem (dkk not on PATH, spawn error, etc.) — surface a clear
  // setup error to the user, but don't block the agent with a phantom
  // "domain failure" it has no way to fix.
  if (res.error?.code === "ENOENT") {
    process.stderr.write(
      "dkk stop hook: 'dkk' CLI not found on PATH — install with `npm i -g domain-knowledge-kit` to enable the domain validation gate.\n",
    );
    process.exit(1);
  }
  if (res.error) {
    process.stderr.write(
      `dkk stop hook: failed to invoke validator — ${res.error.message}\n`,
    );
    process.exit(1);
  }

  if (res.status !== 0) {
    // Did the validator actually produce a report? That, not the exit status,
    // is what separates "the agent broke the model" from "the toolchain is
    // broken" — and only the first is something the agent can act on.
    const report = parseReport(res.stdout);
    if (report) {
      process.stderr.write(
        `Domain validation failed — fix these before ending the turn:\n${res.stdout.trim()}\n`,
      );
      process.exit(2);
    }

    const detail = (res.stderr || res.stdout || "(no output)").trim();
    process.stderr.write(
      `dkk stop hook: \`dkk validate\` exited ${res.status} without producing a report. ` +
      `This is a tooling failure, not a domain failure — not blocking the turn.\n` +
      `dkk requires Node >= 21.2; check the version this hook is invoked with ` +
      `(nvm/asdf shims often hand hooks an older one).\n${detail}\n`,
    );
    process.exit(1);
  }
  process.exit(0);
});

/**
 * Parse `dkk validate --json` output, returning the report only if it really
 * is one. A crashing validator can still write to stdout, so shape is checked
 * rather than just JSON-parseability.
 */
function parseReport(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.valid !== "boolean" || !Array.isArray(parsed.errors)) return null;
    return parsed;
  } catch {
    return null;
  }
}
