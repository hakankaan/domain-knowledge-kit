/**
 * Register the DKK MCP server with Claude Code, with a fallback for
 * environments where the `claude` CLI is unavailable.
 *
 * Order of attempts:
 *
 * 1. If a `dkk` MCP server is already present in the project's `.mcp.json`,
 *    skip — we don't want to overwrite a user's customised entry.
 * 2. If `which claude` succeeds, run `claude mcp add dkk -- dkk mcp`.
 *    This writes into the user's Claude config (`~/.claude.json` or
 *    equivalent), which is the canonical place for project-agnostic
 *    Claude Code config.
 * 3. Fallback: merge `{ "mcpServers": { "dkk": { "command": "dkk", "args": ["mcp"] } } }`
 *    into the project's `.mcp.json`, preserving any other servers
 *    already registered there.
 *
 * Failures are reported but never throw — `dkk update` continues even if
 * MCP registration can't be completed automatically.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type McpRegisterOutcome =
  | { status: "already-registered"; via: "project" | "claude-cli" }
  | { status: "registered"; via: "claude-cli" | "mcp-json" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

interface McpJsonShape {
  mcpServers?: Record<string, { command?: string; args?: string[]; [k: string]: unknown }>;
  [k: string]: unknown;
}

const SERVER_NAME = "dkk";

/**
 * Detect existing registration → register via `claude mcp add` → fall back
 * to writing `.mcp.json`. Returns a structured outcome rather than logging
 * so callers can format the result as part of a larger summary.
 */
export function ensureMcpRegistered(root: string): McpRegisterOutcome {
  if (isRegisteredInProject(root)) {
    return { status: "already-registered", via: "project" };
  }

  if (isRegisteredInClaudeCli()) {
    return { status: "already-registered", via: "claude-cli" };
  }

  if (hasClaudeCli()) {
    const result = spawnSync("claude", ["mcp", "add", SERVER_NAME, "--", "dkk", "mcp"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 20_000,
    });
    if (result.status === 0) {
      return { status: "registered", via: "claude-cli" };
    }
    // Fall through to .mcp.json if `claude mcp add` failed for some reason;
    // we'd rather have a working entry than fail loudly here.
  }

  try {
    writeToMcpJson(root);
    return { status: "registered", via: "mcp-json" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", reason: msg };
  }
}

function isRegisteredInProject(root: string): boolean {
  const path = join(root, ".mcp.json");
  if (!existsSync(path)) return false;
  try {
    const config = JSON.parse(readFileSync(path, "utf-8")) as McpJsonShape;
    return Boolean(config.mcpServers && SERVER_NAME in config.mcpServers);
  } catch {
    return false;
  }
}

function hasClaudeCli(): boolean {
  try {
    execFileSync("which", ["claude"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function isRegisteredInClaudeCli(): boolean {
  if (!hasClaudeCli()) return false;
  try {
    const out = execFileSync("claude", ["mcp", "list"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 10_000,
    });
    // `claude mcp list` prints one server per line; match a token-bounded
    // `dkk` rather than a substring so we don't false-positive on
    // names like `dkk-extended`.
    return new RegExp(`(^|\\s|:)${SERVER_NAME}(\\s|:|$)`, "m").test(out);
  } catch {
    return false;
  }
}

function writeToMcpJson(root: string): void {
  const path = join(root, ".mcp.json");
  let config: McpJsonShape = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, "utf-8")) as McpJsonShape;
    } catch {
      // Corrupt .mcp.json — refuse to clobber it.
      throw new Error(`.mcp.json exists but is not valid JSON; cannot merge dkk entry`);
    }
  }
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers[SERVER_NAME] = { command: "dkk", args: ["mcp"] };
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
