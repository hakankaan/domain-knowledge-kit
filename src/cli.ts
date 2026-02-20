#!/usr/bin/env node
import { Command } from "commander";
import { registerList } from "./features/query/commands/list.js";
import { registerShow } from "./features/query/commands/show.js";
import { registerSearch } from "./features/query/commands/search.js";
import { registerRelated } from "./features/query/commands/related.js";
import { registerValidate } from "./features/pipeline/commands/validate.js";
import { registerRender } from "./features/pipeline/commands/render.js";
import { registerAdrShow } from "./features/adr/commands/adr-show.js";
import { registerAdrRelated } from "./features/adr/commands/adr-related.js";

// ── Error formatting ──────────────────────────────────────────────────

/** Whether to show full stack traces (set DEBUG=1 in env). */
const DEBUG = Boolean(process.env.DEBUG);

/**
 * Node.js system error shape (ENOENT, EACCES, EPERM, etc.).
 * Not all Error objects carry these, so we use a type guard.
 */
interface NodeSystemError extends Error {
  code: string;
  path?: string;
  syscall?: string;
}

function isNodeSystemError(err: unknown): err is NodeSystemError {
  return err instanceof Error && typeof (err as NodeSystemError).code === "string";
}

/**
 * js-yaml YAMLException shape.
 * We detect by `name` rather than importing the class to keep coupling low.
 */
interface YAMLExceptionLike extends Error {
  name: "YAMLException";
  reason?: string;
  mark?: { name?: string | null; line?: number; column?: number; snippet?: string };
}

function isYAMLException(err: unknown): err is YAMLExceptionLike {
  return err instanceof Error && err.name === "YAMLException";
}

/**
 * Format an error into a user-friendly CLI message.
 *
 * Categories handled:
 * - YAML parse errors  → clean "Failed to parse YAML" with location
 * - ENOENT             → "File not found" with path
 * - EACCES / EPERM     → "Permission denied" with path
 * - Everything else    → the error message without a stack trace
 */
function formatCliError(err: unknown): string {
  // 1. YAML parse errors
  if (isYAMLException(err)) {
    const reason = err.reason ?? "invalid YAML syntax";
    const mark = err.mark;
    if (mark && mark.line != null) {
      const file = mark.name ? `${mark.name} ` : "";
      // js-yaml lines are 0-based; display as 1-based
      const location = `line ${mark.line + 1}, column ${(mark.column ?? 0) + 1}`;
      let msg = `Failed to parse YAML — ${reason} (${file}${location})`;
      if (mark.snippet) {
        msg += `\n${mark.snippet}`;
      }
      return msg;
    }
    return `Failed to parse YAML — ${reason}`;
  }

  // 2. Node.js filesystem / system errors
  if (isNodeSystemError(err)) {
    const filePath = err.path ? ` "${err.path}"` : "";
    switch (err.code) {
      case "ENOENT":
        return `File not found:${filePath}. Check that the path exists and the domain/ directory is present.`;
      case "EACCES":
      case "EPERM":
        return `Permission denied:${filePath}. Check file permissions.`;
      case "EISDIR":
        return `Expected a file but found a directory:${filePath}.`;
      default:
        return `System error (${err.code}):${filePath} — ${err.message}`;
    }
  }

  // 3. Generic errors — just the message, no stack trace
  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
}

// ── CLI setup ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name("domain-knowledge-kit")
  .description("Domain Knowledge Pack CLI")
  .version("0.1.0");

// Top-level commands
registerList(program);
registerShow(program);
registerSearch(program);
registerRelated(program);
registerValidate(program);
registerRender(program);

// ADR sub-command group
const adrCmd = program
  .command("adr")
  .description("ADR-related commands");

registerAdrShow(adrCmd);
registerAdrRelated(adrCmd);

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${formatCliError(err)}`);
  if (DEBUG && err instanceof Error && err.stack) {
    console.error(`\nStack trace:\n${err.stack}`);
  }
  process.exit(1);
});
