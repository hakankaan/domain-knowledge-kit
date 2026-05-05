#!/usr/bin/env node
/**
 * PostToolUse hook — auto-validate after edits to domain YAML.
 *
 * When Claude Code edits or writes a file under `.dkk/domain/`, run
 * `dkk validate` so any broken cross-references or schema violations
 * surface back into the agent loop immediately, before the next step.
 *
 * Stays silent for unrelated edits (no-op, exit 0).
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

  const filePath =
    payload?.tool_input?.file_path ??
    payload?.tool_input?.notebook_path ??
    "";

  // Only act on domain YAML edits.
  const isDomainYaml = /\.dkk\/domain\/.*\.ya?ml$/.test(filePath);
  if (!isDomainYaml) process.exit(0);

  const repoRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const cliEntry = resolve(repoRoot, "src/cli.ts");

  const [cmd, args] = existsSync(cliEntry)
    ? ["npx", ["tsx", cliEntry, "validate", "--json", "--minify"]]
    : ["dkk", ["validate", "--json", "--minify"]];

  const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });
  // If validate fails, surface the JSON output to the model via stderr (exit 2
  // makes Claude Code feed stderr back as a tool-result correction signal).
  if (res.status !== 0) {
    process.stderr.write(
      `dkk validate failed after edit to ${filePath}:\n${res.stdout || res.stderr || ""}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
});
