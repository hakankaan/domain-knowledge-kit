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

  const res = spawnSync("dkk", ["validate", "--json", "--minify"], {
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
      `dkk validate failed after edit to ${filePath}:\n${body}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
});
