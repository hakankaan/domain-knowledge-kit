/**
 * `dkk init` command — create or update AGENTS.md with a DKK section.
 *
 * Inserts a Domain Knowledge Kit section delimited by HTML comment markers.
 * Idempotent: replaces the section between markers on re-run, appends if
 * markers are absent, creates the file if it does not exist.
 */
import type { Command as Cmd } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../../shared/paths.js";

const START_MARKER = "<!-- dkk:start -->";
const END_MARKER = "<!-- dkk:end -->";

/** The DKK section content (without markers). */
function dkkSection(): string {
  return `
## Domain Knowledge Kit

This project uses a structured, YAML-based domain model managed by **dkk** (Domain Knowledge Kit).

Run \`dkk prime\` to get full agent context including domain structure, CLI commands, and workflows.

### Quick Reference

\`\`\`bash
dkk prime             # Output full agent context
dkk list              # List all domain items
dkk show <id>         # Display a domain item
dkk search "<query>"  # Full-text search
dkk related <id>      # Graph traversal of related items
dkk validate          # Schema + cross-reference validation
dkk render            # Validate, render docs, rebuild search index
\`\`\`

### Quality Gates

Before committing domain changes, run:

\`\`\`bash
dkk render              # Validates → renders docs → rebuilds search index
\`\`\`

\`dkk validate\` is available as a quick dry-run check (no rendering).
`.trimStart();
}

/** Build the full delimited block. */
function delimitedSection(): string {
  return `${START_MARKER}\n${dkkSection()}${END_MARKER}\n`;
}

/** Register the `init` subcommand. */
export function registerInit(program: Cmd): void {
  program
    .command("init")
    .description("Create or update AGENTS.md with DKK onboarding section")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: { root?: string }) => {
      const root = repoRoot(opts.root);
      const agentsPath = join(root, "AGENTS.md");
      const section = delimitedSection();

      if (!existsSync(agentsPath)) {
        // Create new file with the DKK section
        writeFileSync(agentsPath, `# Agent Instructions\n\n${section}`, "utf-8");
        console.log(`Created ${agentsPath}`);
        return;
      }

      const existing = readFileSync(agentsPath, "utf-8");
      const startIdx = existing.indexOf(START_MARKER);
      const endIdx = existing.indexOf(END_MARKER);

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        // Replace existing section between markers (include trailing newline if present)
        const markerEnd = endIdx + END_MARKER.length;
        const before = existing.slice(0, startIdx);
        const after = existing.slice(existing[markerEnd] === "\n" ? markerEnd + 1 : markerEnd);
        writeFileSync(agentsPath, `${before}${section}${after}`, "utf-8");
        console.log(`Updated DKK section in ${agentsPath}`);
      } else {
        // Append section at the end
        const separator = existing.endsWith("\n") ? "\n" : "\n\n";
        writeFileSync(agentsPath, `${existing}${separator}${section}`, "utf-8");
        console.log(`Appended DKK section to ${agentsPath}`);
      }
    });
}
