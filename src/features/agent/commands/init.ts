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
dkk init --claude                     # Also scaffold .claude/ (settings, hooks, skills, agents, commands)
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
 * Copy every file in `srcDir` (one level deep) into `destDir`. Skips files
 * that already exist unless `force` is true. Reports each file with a
 * `.claude/<relSubpath>/<filename>` label.
 *
 * If `executable` is true, sets 0o755 on each copied file (used for hook
 * scripts).
 */
function copyFlatDir(opts: {
  srcDir: string;
  destDir: string;
  relSubpath: string;
  force: boolean;
  executable?: boolean;
}): void {
  const { srcDir, destDir, relSubpath, force, executable } = opts;
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const fileName of readdirSync(srcDir)) {
    const srcFile = join(srcDir, fileName);
    if (!statSync(srcFile).isFile()) continue;

    const destFile = join(destDir, fileName);
    const relPath = `${relSubpath}/${fileName}`;

    if (existsSync(destFile) && !force) {
      console.log(`Skipped  ${relPath} (already exists — use --force to overwrite)`);
      continue;
    }

    const alreadyExisted = existsSync(destFile);
    writeFileSync(destFile, readFileSync(srcFile, "utf-8"), "utf-8");
    if (executable) {
      try {
        chmodSync(destFile, 0o755);
      } catch {
        // Non-POSIX filesystems may reject chmod — safe to ignore.
      }
    }
    console.log(`${alreadyExisted ? "Updated" : "Created"}  ${relPath}`);
  }
}

/**
 * Copy a directory of skill subdirectories. Layout is `<srcDir>/<skill>/<file>`,
 * mirrored under `<destDir>/<skill>/<file>`. Skips files that already exist
 * unless `force` is true.
 */
function copyNestedDir(opts: {
  srcDir: string;
  destDir: string;
  relSubpath: string;
  force: boolean;
}): void {
  const { srcDir, destDir, relSubpath, force } = opts;
  if (!existsSync(srcDir)) return;
  for (const subName of readdirSync(srcDir)) {
    const subSrc = join(srcDir, subName);
    if (!statSync(subSrc).isDirectory()) continue;

    const subDest = join(destDir, subName);
    mkdirSync(subDest, { recursive: true });

    for (const fileName of readdirSync(subSrc)) {
      const srcFile = join(subSrc, fileName);
      if (!statSync(srcFile).isFile()) continue;

      const destFile = join(subDest, fileName);
      const relPath = `${relSubpath}/${subName}/${fileName}`;

      if (existsSync(destFile) && !force) {
        console.log(`Skipped  ${relPath} (already exists — use --force to overwrite)`);
        continue;
      }

      const alreadyExisted = existsSync(destFile);
      writeFileSync(destFile, readFileSync(srcFile, "utf-8"), "utf-8");
      console.log(`${alreadyExisted ? "Updated" : "Created"}  ${relPath}`);
    }
  }
}

/** Pull `<filename>.mjs` out of a hook command string (e.g.
 *  `node "$CLAUDE_PROJECT_DIR/.claude/hooks/foo.mjs"` → `foo.mjs`).
 *  Used to dedupe DKK hooks across re-runs and merges. */
function extractHookBasename(cmd: unknown): string | null {
  if (typeof cmd !== "string") return null;
  const match = cmd.match(/\.claude\/hooks\/([\w.-]+\.mjs)/);
  return match ? match[1] : null;
}

interface ClaudeSettings {
  $schema?: string;
  permissions?: { allow?: string[]; [k: string]: unknown };
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string }> }>>;
  [k: string]: unknown;
}

/**
 * Additive merge of the DKK template into an existing Claude settings file.
 *
 * - `$schema` is set only when absent.
 * - `permissions.allow` gains any DKK entries not already present (string-equal dedup).
 * - For each hook event, a template entry is appended only when no existing
 *   entry under that event already references the same hook script basename
 *   (so users can rename `matcher` or wrap the command and we still recognise
 *   it as the same DKK hook on subsequent runs).
 *
 * Never removes or rewrites existing entries — user customisations survive.
 */
function mergeClaudeSettings(
  existing: ClaudeSettings,
  template: ClaudeSettings,
): { merged: ClaudeSettings; changes: string[] } {
  const changes: string[] = [];
  const merged: ClaudeSettings = JSON.parse(JSON.stringify(existing));

  if (!merged.$schema && template.$schema) {
    merged.$schema = template.$schema;
    changes.push("$schema");
  }

  const templateAllow = template.permissions?.allow ?? [];
  if (templateAllow.length > 0) {
    if (!merged.permissions) merged.permissions = {};
    if (!Array.isArray(merged.permissions.allow)) merged.permissions.allow = [];
    for (const entry of templateAllow) {
      if (!merged.permissions.allow.includes(entry)) {
        merged.permissions.allow.push(entry);
        changes.push(`permissions.allow: ${entry}`);
      }
    }
  }

  if (template.hooks) {
    if (!merged.hooks) merged.hooks = {};
    for (const [event, templateEntries] of Object.entries(template.hooks)) {
      if (!Array.isArray(merged.hooks[event])) merged.hooks[event] = [];
      const existingBasenames = new Set<string>();
      for (const entry of merged.hooks[event]) {
        for (const h of entry.hooks ?? []) {
          const b = extractHookBasename(h.command);
          if (b) existingBasenames.add(b);
        }
      }
      for (const templateEntry of templateEntries) {
        const templateBasenames = (templateEntry.hooks ?? [])
          .map((h) => extractHookBasename(h.command))
          .filter((b): b is string => b !== null);
        if (templateBasenames.length === 0) continue;
        if (templateBasenames.every((b) => existingBasenames.has(b))) continue;
        merged.hooks[event].push(templateEntry);
        for (const b of templateBasenames) existingBasenames.add(b);
        changes.push(`hooks.${event}: ${templateBasenames.join(", ")}`);
      }
    }
  }

  return { merged, changes };
}

/**
 * Copy the bundled Claude Code config (`settings.json`, hooks, skills,
 * subagents, slash commands) from the DKK package into the consumer
 * project's `.claude/` directory.
 *
 * `settings.json` is merged additively when it already exists (user
 * customisations preserved); all other files skip-if-present unless
 * `--force` overwrites them.
 *
 * Layout produced:
 *   .claude/
 *     settings.json
 *     hooks/<hook>.mjs            (executable bit set)
 *     skills/<skill>/SKILL.md
 *     agents/<agent>.md
 *     commands/<command>.md
 */
function installClaudeConfig(root: string, force: boolean): void {
  const srcDir = packageClaudeDir();
  const destDir = join(root, ".claude");

  if (!existsSync(srcDir)) {
    console.warn(`Warning: DKK package Claude template not found at ${srcDir}`);
    return;
  }

  mkdirSync(destDir, { recursive: true });

  // 1. settings.json — additive merge by default, full overwrite with --force.
  const settingsSrc = join(srcDir, "settings.json");
  const settingsDest = join(destDir, "settings.json");
  if (existsSync(settingsSrc)) {
    const templateRaw = readFileSync(settingsSrc, "utf-8");
    if (!existsSync(settingsDest)) {
      writeFileSync(settingsDest, templateRaw, "utf-8");
      console.log(`Created  .claude/settings.json`);
    } else if (force) {
      writeFileSync(settingsDest, templateRaw, "utf-8");
      console.log(`Updated  .claude/settings.json (overwritten with --force)`);
    } else {
      const existingRaw = readFileSync(settingsDest, "utf-8");
      try {
        const existing = JSON.parse(existingRaw) as ClaudeSettings;
        const template = JSON.parse(templateRaw) as ClaudeSettings;
        const { merged, changes } = mergeClaudeSettings(existing, template);
        if (changes.length === 0) {
          console.log(`Skipped  .claude/settings.json (DKK config already present)`);
        } else {
          writeFileSync(settingsDest, JSON.stringify(merged, null, 2) + "\n", "utf-8");
          const noun = changes.length === 1 ? "entry" : "entries";
          console.log(`Merged   .claude/settings.json (added ${changes.length} ${noun}):`);
          for (const change of changes) console.log(`         + ${change}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Warning: could not merge .claude/settings.json (${msg}).`);
        console.warn(`Merge the following into .claude/settings.json manually, or re-run with --force to overwrite:`);
        console.warn("");
        console.warn(templateRaw);
      }
    }
  }

  // 2. hooks/ (flat, executable)
  copyFlatDir({
    srcDir: join(srcDir, "hooks"),
    destDir: join(destDir, "hooks"),
    relSubpath: ".claude/hooks",
    force,
    executable: true,
  });

  // 3. skills/<skill>/SKILL.md (nested)
  copyNestedDir({
    srcDir: join(srcDir, "skills"),
    destDir: join(destDir, "skills"),
    relSubpath: ".claude/skills",
    force,
  });

  // 4. agents/<agent>.md (flat)
  copyFlatDir({
    srcDir: join(srcDir, "agents"),
    destDir: join(destDir, "agents"),
    relSubpath: ".claude/agents",
    force,
  });

  // 5. commands/<command>.md (flat)
  copyFlatDir({
    srcDir: join(srcDir, "commands"),
    destDir: join(destDir, "commands"),
    relSubpath: ".claude/commands",
    force,
  });
}

/** Register the `init` subcommand. */
export function registerInit(program: Cmd): void {
  program
    .command("init")
    .description("Create or update AGENTS.md with DKK onboarding section")
    .option("--skills", "Also install DKK skill files into .github/skills/")
    .option("--claude", "Also install Claude Code config (.claude/ settings, hooks, skills, agents, commands)")
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

