/**
 * CLI error-formatting helpers.
 *
 * These are presentation-infrastructure utilities used by the CLI entry
 * point to turn raw errors into user-friendly messages.
 */

/**
 * Node.js system error shape (ENOENT, EACCES, EPERM, etc.).
 * Not all Error objects carry these, so we use a type guard.
 */
interface NodeSystemError extends Error {
  code: string;
  path?: string;
  syscall?: string;
}

export function isNodeSystemError(err: unknown): err is NodeSystemError {
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

export function isYAMLException(err: unknown): err is YAMLExceptionLike {
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
export function formatCliError(err: unknown): string {
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
