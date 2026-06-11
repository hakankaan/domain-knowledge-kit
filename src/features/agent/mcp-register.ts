/**
 * Register the DKK MCP server with Claude Code (and any MCP-aware client)
 * by writing a project-scoped `.mcp.json` — the committed, shareable
 * registration that every clone of the repo inherits automatically.
 *
 * Why a committed `.mcp.json` rather than `claude mcp add`:
 *
 * `claude mcp add dkk -- dkk mcp` (no `--scope`) writes a *local*-scope
 * entry into the running user's `~/.claude.json`. That entry is private to
 * that machine and never committed, so every teammate who clones the repo
 * has to re-register by hand — the exact "I forgot, so the agent silently
 * has no domain tools" failure we want to eliminate. A committed `.mcp.json`
 * is registered once and shared with the whole team: Claude Code picks it up
 * (after a one-time approval prompt) on every session, and it needs no
 * `claude` CLI on PATH to work.
 *
 * Note: nobody runs `dkk mcp` by hand. It's a long-lived stdio server that
 * Claude Code spawns and manages itself once `.mcp.json` declares it.
 *
 * Idempotent: if `.mcp.json` already declares a `dkk` server we leave it
 * untouched (never clobber a user's customised entry); otherwise we merge a
 * `dkk` entry in, preserving any other servers already registered there.
 *
 * Failures are reported, never thrown — callers continue regardless.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectInstallMode } from "./install-mode.js";

export type McpRegisterOutcome =
  | { status: "already-registered"; path: string }
  | { status: "registered"; path: string; command: string }
  | { status: "failed"; reason: string };

interface McpJsonShape {
  mcpServers?: Record<string, { command?: string; args?: string[]; [k: string]: unknown }>;
  [k: string]: unknown;
}

const SERVER_NAME = "dkk";

/**
 * Ensure the project's `.mcp.json` declares the `dkk` server. Returns a
 * structured outcome rather than logging, so callers can fold the result
 * into their own summary output.
 */
export function ensureMcpRegistered(root: string): McpRegisterOutcome {
  const path = join(root, ".mcp.json");

  if (isRegisteredInProject(path)) {
    return { status: "already-registered", path: ".mcp.json" };
  }

  try {
    const entry = writeToMcpJson(path);
    return {
      status: "registered",
      path: ".mcp.json",
      command: `${entry.command} ${entry.args.join(" ")}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", reason: msg };
  }
}

function isRegisteredInProject(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const config = JSON.parse(readFileSync(path, "utf-8")) as McpJsonShape;
    return Boolean(config.mcpServers && SERVER_NAME in config.mcpServers);
  } catch {
    return false;
  }
}

/**
 * The command a committed `.mcp.json` should use to launch the server. It
 * must resolve on *every* teammate's machine, not just on whoever ran init,
 * so we key off how this repo's `dkk` is installed:
 *
 * - global / unknown → `dkk` is on PATH everywhere → invoke it directly.
 * - local devDependency → `dkk` is NOT on PATH, but `npx` resolves the
 *   project-local `node_modules/.bin/dkk` first (no network once installed),
 *   so the whole team gets the version pinned in `package.json`.
 *
 * Teams with a mixed setup can edit the generated `.mcp.json` by hand.
 */
export function mcpServerEntry(): { command: string; args: string[] } {
  if (detectInstallMode().mode === "local") {
    return { command: "npx", args: [SERVER_NAME, "mcp"] };
  }
  return { command: SERVER_NAME, args: ["mcp"] };
}

function writeToMcpJson(path: string): { command: string; args: string[] } {
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
  const entry = mcpServerEntry();
  config.mcpServers[SERVER_NAME] = entry;
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return entry;
}
