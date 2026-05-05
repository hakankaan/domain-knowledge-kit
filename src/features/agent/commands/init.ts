/**
 * `dkk init` command — create or update AGENTS.md with a DKK section.
 *
 * Inserts a Domain Knowledge Kit section delimited by HTML comment markers.
 * Idempotent: replaces the section between markers on re-run, appends if
 * markers are absent, creates the file if it does not exist.
 */
import type { Command as Cmd } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, packageSkillsDir, packageClaudeDir } from "../../../shared/paths.js";

const START_MARKER = "<!-- dkk:start -->";
const END_MARKER = "<!-- dkk:end -->";

/**
 * The DKK section content (without markers).
 * Keep the command list in sync with the CLI Reference tables in prime.ts#primeContent.
 */
function dkkSection(): string {
  return `
## Domain Knowledge Kit

This project uses a structured, YAML-based domain model managed by **dkk** (Domain Knowledge Kit).

Run \`dkk prime\` to get full agent context including domain structure, CLI commands, and workflows.

### ⚠️ Events vs Architecture

Events and Commands map business domain concepts. They **DO NOT** imply Event-Driven Architecture (EDA) or CQRS decisions.

### 🏗️ Structural vs. Content Edits

**Domain YAML is the single source of truth.** 

- **For structural changes (creates, renames, deletes):** ALWAYS use the DKK CLI commands (e.g., \`dkk add\`, \`dkk rename\`, \`dkk rm\`).
- **For content updates (descriptions, properties, references):** You MUST edit the YAML files directly, but you must respect the JSON Schemas (\`tools/dkk/schema/\`) and run \`dkk render\` immediately afterward to ensure cross-reference integrity and schema validation.

### 🏛️ Prioritize ADRs

**Always consult Architecture Decision Records.** Before proposing architectural refactors, making tech choices, or modifying domain logic, use \`dkk search "your topic"\` or \`dkk show <id>\` to understand existing constraints and decisions.

### Quick Reference

\`\`\`bash
# Query
dkk list                              # List all domain items (--context, --type filters)
dkk show <id>                         # Display full YAML of a domain item
dkk summary <id>                      # Concise item summary (AI-optimized)
dkk search "<query>"                  # Full-text search
dkk related <id>                      # Graph traversal of related items
dkk graph                             # Mermaid.js flowchart (--layout LR|TD, --node-types ...)

# Pipeline
dkk validate                          # Schema + cross-reference validation
dkk render                            # Validate, render docs, rebuild search index

# ADR

# Scaffold
dkk new domain                        # Scaffold .dkk/domain/ structure
dkk new context <name>                # Scaffold a new bounded context
dkk new adr "<title>"                 # Scaffold a new ADR file
dkk add <type> <name> --context <ctx> # Scaffold an individual domain item

# Refactor
dkk rename <old-id> <new-id>          # Rename item and update all references
dkk rm <id>                           # Remove item safely

# Audit
dkk stats                             # Domain statistics + orphaned items

# Agent
dkk init                              # Create/update AGENTS.md with DKK section
dkk init --claude                     # Also scaffold .claude/ (Claude Code hooks + permissions)
dkk init --skills                     # Also install agent skills into .github/skills/
dkk prime                             # Output full agent context
dkk mcp                               # Run the DKK MCP server (stdio) for Claude Code etc.
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

/**
 * Copy all skill files from the DKK package's `.github/skills/` directory
 * into the target project's `.github/skills/` directory.
 *
 * Each skill lives in a subdirectory (e.g. `story-analyst/skill.md`).
 * Files are skipped if they already exist, unless `force` is true.
 */
function installSkills(root: string, force: boolean): void {
  const srcDir = packageSkillsDir();
  const destDir = join(root, ".github", "skills");

  if (!existsSync(srcDir)) {
    console.warn(`Warning: DKK package skills directory not found at ${srcDir}`);
    return;
  }

  // Walk one level of subdirectories (skill-name/skill.md)
  for (const skillName of readdirSync(srcDir)) {
    const skillSrcDir = join(srcDir, skillName);
    if (!statSync(skillSrcDir).isDirectory()) continue;

    const skillDestDir = join(destDir, skillName);
    mkdirSync(skillDestDir, { recursive: true });

    for (const fileName of readdirSync(skillSrcDir)) {
      const srcFile = join(skillSrcDir, fileName);
      if (!statSync(srcFile).isFile()) continue;

      const destFile = join(skillDestDir, fileName);
      const relPath = `.github/skills/${skillName}/${fileName}`;

      if (existsSync(destFile) && !force) {
        console.log(`Skipped  ${relPath} (already exists — use --force to overwrite)`);
        continue;
      }

      const alreadyExisted = existsSync(destFile);
      const contents = readFileSync(srcFile, "utf-8");
      writeFileSync(destFile, contents, "utf-8");
      console.log(`${alreadyExisted ? "Updated" : "Created"}  ${relPath}`);
    }
  }
}

/**
 * Copy the bundled Claude Code config (`settings.json` + hook scripts)
 * from the DKK package into the consumer project's `.claude/` directory.
 *
 * - `settings.json` is skipped if present (use `--force` to overwrite).
 * - Hook scripts under `.claude/hooks/` are copied individually with the
 *   same skip-existing semantics.
 * - Hook scripts get the executable bit so they can run directly as well
 *   as via `node ...`.
 */
function installClaudeConfig(root: string, force: boolean): void {
  const srcDir = packageClaudeDir();
  const destDir = join(root, ".claude");

  if (!existsSync(srcDir)) {
    console.warn(`Warning: DKK package Claude template not found at ${srcDir}`);
    return;
  }

  mkdirSync(destDir, { recursive: true });

  // 1. settings.json
  const settingsSrc = join(srcDir, "settings.json");
  const settingsDest = join(destDir, "settings.json");
  if (existsSync(settingsSrc)) {
    if (existsSync(settingsDest) && !force) {
      console.log(`Skipped  .claude/settings.json (already exists — use --force to overwrite)`);
    } else {
      const alreadyExisted = existsSync(settingsDest);
      writeFileSync(settingsDest, readFileSync(settingsSrc, "utf-8"), "utf-8");
      console.log(`${alreadyExisted ? "Updated" : "Created"}  .claude/settings.json`);
    }
  }

  // 2. hooks/
  const hooksSrcDir = join(srcDir, "hooks");
  const hooksDestDir = join(destDir, "hooks");
  if (existsSync(hooksSrcDir)) {
    mkdirSync(hooksDestDir, { recursive: true });
    for (const fileName of readdirSync(hooksSrcDir)) {
      const srcFile = join(hooksSrcDir, fileName);
      if (!statSync(srcFile).isFile()) continue;

      const destFile = join(hooksDestDir, fileName);
      const relPath = `.claude/hooks/${fileName}`;

      if (existsSync(destFile) && !force) {
        console.log(`Skipped  ${relPath} (already exists — use --force to overwrite)`);
        continue;
      }

      const alreadyExisted = existsSync(destFile);
      writeFileSync(destFile, readFileSync(srcFile, "utf-8"), "utf-8");
      // Make the hook script executable so it can run directly too.
      try {
        chmodSync(destFile, 0o755);
      } catch {
        // Non-POSIX filesystems may reject chmod — safe to ignore.
      }
      console.log(`${alreadyExisted ? "Updated" : "Created"}  ${relPath}`);
    }
  }
}

/** Register the `init` subcommand. */
export function registerInit(program: Cmd): void {
  program
    .command("init")
    .description("Create or update AGENTS.md with DKK onboarding section")
    .option("--skills", "Also install DKK skill files into .github/skills/")
    .option("--claude", "Also install Claude Code config (.claude/settings.json + hooks)")
    .option("--force", "Overwrite existing skill or Claude files (applies with --skills or --claude)")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: { root?: string; skills?: boolean; claude?: boolean; force?: boolean }) => {
      const root = repoRoot(opts.root);
      const agentsPath = join(root, "AGENTS.md");
      const section = delimitedSection();

      if (!existsSync(agentsPath)) {
        // Create new file with the DKK section
        writeFileSync(agentsPath, `# Agent Instructions\n\n${section}`, "utf-8");
        console.log(`Created  AGENTS.md`);
      } else {
        const existing = readFileSync(agentsPath, "utf-8");
        const startIdx = existing.indexOf(START_MARKER);
        const endIdx = existing.indexOf(END_MARKER);

        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          // Replace existing section between markers (include trailing newline if present)
          const markerEnd = endIdx + END_MARKER.length;
          const before = existing.slice(0, startIdx);
          const after = existing.slice(existing[markerEnd] === "\n" ? markerEnd + 1 : markerEnd);
          writeFileSync(agentsPath, `${before}${section}${after}`, "utf-8");
          console.log(`Updated  AGENTS.md (DKK section refreshed)`);
        } else {
          // Append section at the end
          const separator = existing.endsWith("\n") ? "\n" : "\n\n";
          writeFileSync(agentsPath, `${existing}${separator}${section}`, "utf-8");
          console.log(`Appended DKK section to AGENTS.md`);
        }
      }

      if (opts.skills) {
        installSkills(root, opts.force ?? false);
      }

      if (opts.claude) {
        installClaudeConfig(root, opts.force ?? false);
      }
    });
}

