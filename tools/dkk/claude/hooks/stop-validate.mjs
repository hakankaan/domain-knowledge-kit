#!/usr/bin/env node
/**
 * Stop hook — final validation gate before the agent ends a turn.
 *
 * Runs `dkk validate`. If the domain model is invalid, returns exit code 2
 * with the JSON error report on stderr. Claude Code feeds that back so the
 * agent must fix the broken model before declaring the work complete.
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
    const body =
      res.stdout ||
      res.stderr ||
      "(validator exited non-zero with no output — likely a tooling/wiring problem, not a domain issue)";
    process.stderr.write(
      `Domain validation failed — fix these before ending the turn:\n${body}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
});
