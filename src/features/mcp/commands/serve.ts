/**
 * `dkk mcp` command — run the DKK MCP server over stdio.
 *
 * Designed to be registered with Claude Code (or any MCP-aware client) via:
 *   claude mcp add dkk -- dkk mcp
 */
import type { Command as Cmd } from "commander";
import { runStdio } from "../server.js";

/** Register the top-level `mcp` command. */
export function registerMcp(program: Cmd): void {
  program
    .command("mcp")
    .description("Run the DKK Model Context Protocol server over stdio")
    .option("-r, --root <path>", "Override repository root for all tool calls")
    .action(async (opts: { root?: string }) => {
      await runStdio(opts.root);
    });
}
