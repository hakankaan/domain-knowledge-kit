#!/usr/bin/env node
/**
 * SessionStart hook — pipe `dkk prime` output into Claude Code's context.
 *
 * The hook prints the agent context document (item types, retrieval/update
 * workflows, current domain summary) to stdout, which Claude Code surfaces
 * as additional context for the session. Any errors fall through silently
 * so a missing domain model never blocks session start.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const cliEntry = resolve(repoRoot, "src/cli.ts");

let cmd, args;
if (existsSync(cliEntry)) {
  // Local DKK development: run via tsx.
  cmd = "npx";
  args = ["tsx", cliEntry, "prime"];
} else {
  // Downstream consumer: rely on the published `dkk` binary.
  cmd = "dkk";
  args = ["prime"];
}

const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });
if (res.status === 0 && res.stdout) {
  process.stdout.write(res.stdout);
}
// Always exit 0 — never block session start over a missing/empty model.
process.exit(0);
