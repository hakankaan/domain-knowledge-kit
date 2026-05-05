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
  const cliEntry = resolve(repoRoot, "src/cli.ts");

  // No domain model? Nothing to gate on.
  if (!existsSync(resolve(repoRoot, ".dkk/domain"))) process.exit(0);

  const [cmd, args] = existsSync(cliEntry)
    ? ["npx", ["tsx", cliEntry, "validate", "--json", "--minify"]]
    : ["dkk", ["validate", "--json", "--minify"]];

  const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });
  if (res.status !== 0) {
    process.stderr.write(
      `Domain validation failed — fix these before ending the turn:\n${res.stdout || res.stderr || ""}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
});
