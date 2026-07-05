/**
 * Register the DKK MCP server with MCP-aware clients by writing project-scoped,
 * committed config that every clone of the repo inherits automatically.
 *
 * Two targets, same `dkk mcp` server:
 *
 * - **`.mcp.json`** (`mcpServers` key) — Claude Code and other clients that
 *   read the repo-root convention.
 * - **`.vscode/mcp.json`** (`servers` key, `type: "stdio"`) — VS Code's
 *   GitHub Copilot, which reads its own per-workspace location.
 *
 * Why committed config rather than `claude mcp add` / hand-registration:
 * a local-scope entry is private to one machine and never committed, so every
 * teammate who clones the repo has to re-register by hand — the exact "I
 * forgot, so the agent silently has no domain tools" failure we want to
 * eliminate. A committed file is registered once and shared with the whole
 * team (after a one-time approval prompt), and needs no client CLI on PATH.
 *
 * Note: nobody runs `dkk mcp` by hand. It's a long-lived stdio server that the
 * client spawns and manages itself once the config declares it.
 *
 * Idempotent: if the target file already declares a `dkk` server we leave it
 * untouched (never clobber a user's customised entry); otherwise we merge a
 * `dkk` entry in, preserving any other servers already registered there.
 *
 * Failures are reported, never thrown — callers continue regardless.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectInstallMode } from "./install-mode.js";

export type McpRegisterOutcome =
  | { status: "already-registered"; path: string }
  | { status: "registered"; path: string; command: string }
  | { status: "failed"; reason: string };

interface McpJsonShape {
  [k: string]: unknown;
}

const SERVER_NAME = "dkk";

/**
 * Describes one registration target: the file it writes, the top-level key
 * that holds the server map, and any extra fields to fold into the server
 * entry (e.g. VS Code wants `type: "stdio"`).
 */
interface McpTarget {
  /** Repo-relative path used in the returned outcome (POSIX form). */
  relPath: string;
  /** Absolute filesystem path. */
  absPath: string;
  /** Top-level key holding the server map (`mcpServers` or `servers`). */
  serversKey: string;
  /** Extra fields merged into the server entry. */
  entryExtras?: Record<string, unknown>;
}

/**
 * Ensure the project's `.mcp.json` declares the `dkk` server (Claude Code and
 * other clients that read the repo-root convention).
 */
export function ensureMcpRegistered(root: string): McpRegisterOutcome {
  return registerInto({
    relPath: ".mcp.json",
    absPath: join(root, ".mcp.json"),
    serversKey: "mcpServers",
  });
}

/**
 * Ensure the project's `.vscode/mcp.json` declares the `dkk` server (VS Code
 * GitHub Copilot). Uses the `servers` key and a `type: "stdio"` entry.
 */
export function ensureVscodeMcpRegistered(root: string): McpRegisterOutcome {
  return registerInto({
    relPath: ".vscode/mcp.json",
    absPath: join(root, ".vscode", "mcp.json"),
    serversKey: "servers",
    entryExtras: { type: "stdio" },
  });
}

function registerInto(target: McpTarget): McpRegisterOutcome {
  if (isRegistered(target)) {
    return { status: "already-registered", path: target.relPath };
  }

  try {
    const entry = writeToMcpJson(target);
    return {
      status: "registered",
      path: target.relPath,
      command: `${entry.command} ${entry.args.join(" ")}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", reason: msg };
  }
}

function isRegistered(target: McpTarget): boolean {
  if (!existsSync(target.absPath)) return false;
  try {
    const config = JSON.parse(readFileSync(target.absPath, "utf-8")) as McpJsonShape;
    const servers = config[target.serversKey];
    return Boolean(servers && typeof servers === "object" && SERVER_NAME in servers);
  } catch {
    return false;
  }
}

/**
 * The command a committed config should use to launch the server. It must
 * resolve on *every* teammate's machine, not just on whoever ran init, so we
 * key off how this repo's `dkk` is installed:
 *
 * - global / unknown → `dkk` is on PATH everywhere → invoke it directly.
 * - local devDependency → `dkk` is NOT on PATH, but `npx` resolves the
 *   project-local `node_modules/.bin/dkk` first (no network once installed),
 *   so the whole team gets the version pinned in `package.json`.
 *
 * Teams with a mixed setup can edit the generated config by hand.
 */
export function mcpServerEntry(): { command: string; args: string[] } {
  if (detectInstallMode().mode === "local") {
    return { command: "npx", args: [SERVER_NAME, "mcp"] };
  }
  return { command: SERVER_NAME, args: ["mcp"] };
}

function writeToMcpJson(target: McpTarget): { command: string; args: string[] } {
  let config: McpJsonShape = {};
  if (existsSync(target.absPath)) {
    try {
      config = JSON.parse(readFileSync(target.absPath, "utf-8")) as McpJsonShape;
    } catch {
      // Corrupt file — refuse to clobber it.
      throw new Error(`${target.relPath} exists but is not valid JSON; cannot merge dkk entry`);
    }
  }

  const servers = (config[target.serversKey] ??= {}) as Record<string, unknown>;
  const entry = mcpServerEntry();
  servers[SERVER_NAME] = { ...target.entryExtras, ...entry };

  mkdirSync(dirname(target.absPath), { recursive: true });
  writeFileSync(target.absPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return entry;
}
