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

const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const res = spawnSync("dkk", ["prime"], { cwd: repoRoot, encoding: "utf8" });
if (res.status === 0 && res.stdout) {
  process.stdout.write(res.stdout);
}
// Always exit 0 — never block session start over a missing `dkk` binary or
// an empty/absent domain model. Priming is a best-effort context boost.
process.exit(0);
