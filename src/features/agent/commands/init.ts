/**
 * `dkk init` command — create or update AGENTS.md with a DKK section, and
 * print conditional next-step guidance based on the current repo state.
 *
 * Inserts a Domain Knowledge Kit section delimited by HTML comment markers.
 * Idempotent: replaces the section between markers on re-run, appends if
 * markers are absent, creates the file if it does not exist.
 *
 * Does NOT scaffold `.dkk/domain/` — that is a separate, deliberate step
 * (`dkk new domain`). The intuition is that a domain model is intrinsic to
 * the project's business, not something to be templated. After writing
 * AGENTS.md, init prints next-step guidance tuned to whether the repo has
 * no domain, only the sample scaffold, or a real model.
 *
 * Optional flags layer in `.claude/` and `.github/skills/` for AI-agent
 * integrations.
 */
import type { Command as Cmd } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, packageSkillsDir, packageClaudeDir, packageCopilotDir, domainDir } from "../../../shared/paths.js";
import { loadDomainModel } from "../../../shared/loader.js";
import { isPathGitIgnored } from "../../../shared/git.js";
import { ensureMcpRegistered, ensureVscodeMcpRegistered, type McpRegisterOutcome } from "../mcp-register.js";
import { primeContent } from "./prime.js";

export const START_MARKER = "<!-- dkk:start -->";
const END_MARKER = "<!-- dkk:end -->";

/**
 * The DKK section content (without markers).
 * Keep the command list in sync with the CLI Reference tables in prime.ts (the `cli` guide section, GUIDE_CLI).
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
dkk new domain                        # Scaffold .dkk/domain/ structure (one-time, per project)
dkk new context <name>                # Scaffold a new bounded context
dkk new adr "<title>"                 # Scaffold a new ADR file
dkk add <type> <name> --context <ctx> # Scaffold an individual domain item

# Refactor
dkk rename <old-id> <new-id>          # Rename item and update all references
dkk rm <id>                           # Remove item safely

# Audit
dkk stats                             # Domain statistics + orphaned items
dkk drift                             # Model/code drift report (code_refs bindings + git; --strict for CI)
dkk drift ack <context>               # Mark a flagged context reviewed-and-accurate at HEAD
dkk drift map <file>                  # Which context binds a source file (staleness + ADRs)

# Agent
dkk init                              # Create/update AGENTS.md with DKK section + print next steps
dkk init --claude                     # Also scaffold .claude/ (settings, hooks, skills, agents, commands)
dkk init --copilot                    # Also scaffold GitHub Copilot config (.github/ prompts, agent, skills, copilot-instructions.md, .vscode/mcp.json)
dkk init --skills                     # Also install agent skills into .github/skills/
dkk init --all                        # Install both Claude Code and Copilot config
dkk update                            # Upgrade dkk via npm + refresh .claude/.github/skills/Copilot artifacts + MCP
dkk prime                             # Output full agent context
dkk mcp                               # MCP server entrypoint — auto-spawned by the client via .mcp.json / .vscode/mcp.json (do not run by hand)

# Feedback (about dkk itself, not this project's domain)
dkk feedback add "<summary>"          # Record friction with dkk (--kind bug|friction|idea|docs, --detail, --command)
dkk feedback                          # List recorded feedback (--kind, --unshared)
dkk feedback export                   # Paste-ready Markdown report on stdout (--all, --mark-shared)
dkk feedback rm <id>                  # Drop an entry (redaction escape hatch)
\`\`\`

Feedback is a local file (\`.dkk/feedback.yml\`) — nothing is transmitted. Offer to record it when the user hits a dkk bug or rough edge; never file it unprompted.

### Model Context Protocol (MCP)

\`dkk init\` writes a committed \`.mcp.json\` registering the **dkk** MCP server (\`dkk init --copilot\` also writes \`.vscode/mcp.json\` for VS Code Copilot). Once committed, every clone gets the server automatically — the client spawns it on session start (approve the "dkk" server once when prompted). **Prefer the MCP tools** (\`dkk_search\`, \`dkk_show\`, \`dkk_summary\`, \`dkk_related\`, \`dkk_list\`, \`dkk_story\`, \`dkk_validate\`, …) over shelling out to the CLI for queries — they hit the same data with no shell-quoting fragility.

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
 * Each skill lives in a subdirectory (e.g. `dkk-story-analyst/skill.md`).
 * Files are skipped if they already exist, unless `force` is true.
 */
export function installSkills(root: string, force: boolean): void {
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
export function extractHookBasename(cmd: unknown): string | null {
  if (typeof cmd !== "string") return null;
  const match = cmd.match(/\.claude\/hooks\/([\w.-]+\.mjs)/);
  return match ? match[1] : null;
}

export interface ClaudeSettings {
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
export function mergeClaudeSettings(
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
export interface InstallClaudeOpts {
  /** Skip writing/merging `.claude/settings.json`. Used by `dkk update` so its
   *  prune + re-merge phase can handle settings independently from artifact
   *  refresh. Defaults to false. */
  skipSettings?: boolean;
}

export function installClaudeConfig(root: string, force: boolean, opts: InstallClaudeOpts = {}): void {
  const srcDir = packageClaudeDir();
  const destDir = join(root, ".claude");

  if (!existsSync(srcDir)) {
    console.warn(`Warning: DKK package Claude template not found at ${srcDir}`);
    return;
  }

  mkdirSync(destDir, { recursive: true });

  // 1. settings.json — additive merge by default, full overwrite with --force.
  //    `skipSettings` lets callers (notably `dkk update`) handle settings
  //    via the dedicated prune+merge path instead.
  const settingsSrc = join(srcDir, "settings.json");
  const settingsDest = join(destDir, "settings.json");
  if (!opts.skipSettings && existsSync(settingsSrc)) {
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

/**
 * Copy the bundled GitHub Copilot config from the DKK package into the
 * consumer project's `.github/` directory, install the portable skills, write
 * the `.github/copilot-instructions.md` DKK section, and register the MCP
 * server in `.vscode/mcp.json`.
 *
 * Layout produced:
 *   .github/
 *     copilot-instructions.md    (static DKK context section — marker-delimited)
 *     prompts/dkk-<name>.prompt.md
 *     agents/dkk-domain-reviewer.agent.md
 *     skills/dkk-<skill>/skill.md
 *   .vscode/mcp.json             (dkk MCP server, `servers` key)
 *
 * `.mcp.json` is written separately by the caller (`dkk init`'s default MCP
 * step), so `dkk init --copilot` ends up with both MCP config files.
 */
export interface InstallCopilotOpts {
  /** Skip writing/merging `.vscode/mcp.json`. Used by `dkk update` (its MCP
   *  phase handles registration) and by `--no-mcp`. Defaults to false. */
  skipMcp?: boolean;
  /** Skip refreshing `.github/copilot-instructions.md`. Used by `dkk update`
   *  so its refresh phase owns the section. Defaults to false. */
  skipInstructions?: boolean;
  /** Skip installing the portable `.github/skills/`. Used by `dkk update`,
   *  which already installs the skills once in its artifact phase, to avoid a
   *  redundant second copy. Defaults to false. */
  skipSkills?: boolean;
}

export function installCopilotConfig(root: string, force: boolean, opts: InstallCopilotOpts = {}): void {
  const srcDir = packageCopilotDir();

  if (!existsSync(srcDir)) {
    console.warn(`Warning: DKK package Copilot template not found at ${srcDir}`);
  } else {
    // prompts/<name>.prompt.md (flat)
    copyFlatDir({
      srcDir: join(srcDir, "prompts"),
      destDir: join(root, ".github", "prompts"),
      relSubpath: ".github/prompts",
      force,
    });
    // agents/<name>.agent.md (flat)
    copyFlatDir({
      srcDir: join(srcDir, "agents"),
      destDir: join(root, ".github", "agents"),
      relSubpath: ".github/agents",
      force,
    });
  }

  // Portable skills (the same set installed by `--skills`).
  if (!opts.skipSkills) installSkills(root, force);

  // .github/copilot-instructions.md — static DKK context section.
  if (!opts.skipInstructions) {
    const status = refreshCopilotInstructions(root);
    if (status === "created") console.log(`Created  .github/copilot-instructions.md`);
    else if (status === "updated") console.log(`Updated  .github/copilot-instructions.md (DKK section refreshed)`);
    else console.log(`Appended DKK section to .github/copilot-instructions.md`);
  }

  // .vscode/mcp.json — VS Code Copilot MCP registration.
  if (!opts.skipMcp) {
    const outcome = ensureVscodeMcpRegistered(root);
    printVscodeMcpOutcome(outcome);
    // The whole point of a committed .vscode/mcp.json is team sharing; warn if
    // .vscode/ is git-ignored (common) so the registration doesn't silently
    // fail to reach teammates.
    if (outcome.status !== "failed" && isPathGitIgnored(root, ".vscode/mcp.json")) {
      console.warn(`         Note: .vscode/ looks git-ignored — add \`!.vscode/mcp.json\` to .gitignore so teammates inherit the dkk server.`);
    }
  }
}

/**
 * Insert, replace, or append a marker-delimited section in a markdown file.
 *
 * Three outcomes:
 * - `created`: the file did not exist; it was written with `header` + section.
 * - `updated`: the file existed and contained the delimited section; it was
 *   replaced in place.
 * - `appended`: the file existed without markers; the section was appended.
 *
 * Shared by `refreshAgentsMd` (AGENTS.md) and `refreshCopilotInstructions`
 * (.github/copilot-instructions.md).
 */
function upsertDelimitedSection(
  filePath: string,
  section: string,
  header: string,
): "created" | "updated" | "appended" {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${header}${section}`, "utf-8");
    return "created";
  }

  const existing = readFileSync(filePath, "utf-8");
  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const markerEnd = endIdx + END_MARKER.length;
    const before = existing.slice(0, startIdx);
    const after = existing.slice(existing[markerEnd] === "\n" ? markerEnd + 1 : markerEnd);
    writeFileSync(filePath, `${before}${section}${after}`, "utf-8");
    return "updated";
  }

  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(filePath, `${existing}${separator}${section}`, "utf-8");
  return "appended";
}

/**
 * Create or refresh the DKK section in `AGENTS.md` at the repo root.
 *
 * Used by both `dkk init` and `dkk update`.
 */
export function refreshAgentsMd(root: string): "created" | "updated" | "appended" {
  return upsertDelimitedSection(join(root, "AGENTS.md"), delimitedSection(), "# Agent Instructions\n\n");
}

/**
 * The DKK section embedded in `.github/copilot-instructions.md`.
 *
 * Unlike Claude Code (whose SessionStart hook runs `dkk prime` dynamically),
 * GitHub Copilot has no session hook — so we bake the **static** agent
 * contract (`primeContent()`) into the instructions file and point at
 * `dkk prime` / the `dkk_prime` MCP tool for the live domain summary. The
 * section is refreshed by `dkk update`, so it never drifts from the tool.
 */
function copilotSection(): string {
  return `${primeContent()}
> **Live domain summary:** the context above is the *static* DKK contract, refreshed by \`dkk update\`. For the current model (contexts, items, ADRs) run \`dkk prime\` in the terminal, or call the \`dkk\` MCP server's \`prime\` tool. Prefer the \`dkk_*\` MCP tools for all queries; use the \`dkk\` CLI for mutations. Ready-made prompts live in \`.github/prompts/dkk-*.prompt.md\` (invoke as \`/dkk-review\`, \`/dkk-impact\`, …), and the \`dkk-domain-reviewer\` custom agent lives in \`.github/agents/\`.
`;
}

/** Build the full delimited Copilot block. */
function delimitedCopilotSection(): string {
  return `${START_MARKER}\n${copilotSection()}${END_MARKER}\n`;
}

/**
 * Create or refresh the DKK section in `.github/copilot-instructions.md`.
 * Mirrors {@link refreshAgentsMd}; ensures `.github/` exists first.
 *
 * Used by both `dkk init --copilot` and `dkk update`.
 */
export function refreshCopilotInstructions(root: string): "created" | "updated" | "appended" {
  mkdirSync(join(root, ".github"), { recursive: true });
  return upsertDelimitedSection(
    join(root, ".github", "copilot-instructions.md"),
    delimitedCopilotSection(),
    "# Copilot Instructions\n\n",
  );
}

/**
 * Detect the current state of the repo's domain model and return a
 * one-of-four state tag for `printNextSteps` to dispatch on.
 *
 * Mirrors the detection ladder used by `prime.ts#buildDomainSummary`:
 * - No `.dkk/domain/` directory          → `"missing"`
 * - Loader throws (malformed/incomplete) → `"broken"`
 * - Loader returns an empty model        → `"missing"` (same guidance)
 * - Only a `sample` context exists       → `"sample-only"`
 * - At least one real context exists     → `"ready"`
 */
type DomainState = "missing" | "broken" | "sample-only" | "ready";

function detectDomainState(root: string): DomainState {
  if (!existsSync(domainDir(root))) return "missing";
  try {
    const model = loadDomainModel({ root });
    if (model.contexts.size === 0 && model.actors.length === 0 && model.adrs.size === 0) {
      return "missing";
    }
    if (model.contexts.size === 1 && model.contexts.has("sample")) {
      return "sample-only";
    }
    return "ready";
  } catch {
    return "broken";
  }
}

/**
 * Report the result of writing the `.mcp.json` MCP registration. Mirrors the
 * `Created/Skipped/Warning` vocabulary the rest of init uses for file output.
 */
function printMcpOutcome(outcome: McpRegisterOutcome): void {
  switch (outcome.status) {
    case "registered":
      console.log(`Created  .mcp.json (registered dkk MCP server: \`${outcome.command}\`)`);
      console.log(`         → Commit it, then restart Claude Code and approve the "dkk" server when prompted.`);
      break;
    case "already-registered":
      console.log(`Skipped  .mcp.json (dkk MCP server already registered)`);
      break;
    case "failed":
      console.warn(`Warning: could not write .mcp.json (${outcome.reason}).`);
      console.warn(`         Add it manually: {"mcpServers":{"dkk":{"command":"dkk","args":["mcp"]}}}`);
      break;
  }
}

/**
 * Report the result of writing the `.vscode/mcp.json` registration (VS Code
 * GitHub Copilot). Same vocabulary as {@link printMcpOutcome}.
 */
function printVscodeMcpOutcome(outcome: McpRegisterOutcome): void {
  switch (outcome.status) {
    case "registered":
      console.log(`Created  .vscode/mcp.json (registered dkk MCP server: \`${outcome.command}\`)`);
      console.log(`         → Commit it; VS Code Copilot will offer to start the "dkk" server.`);
      break;
    case "already-registered":
      console.log(`Skipped  .vscode/mcp.json (dkk MCP server already registered)`);
      break;
    case "failed":
      console.warn(`Warning: could not write .vscode/mcp.json (${outcome.reason}).`);
      console.warn(`         Add it manually: {"servers":{"dkk":{"type":"stdio","command":"dkk","args":["mcp"]}}}`);
      break;
  }
}

/**
 * Print a "Next steps" block tuned to what the repo currently looks like.
 * Called at the end of `dkk init` so users always get an actionable nudge
 * regardless of whether they just ran init for the first time or are
 * refreshing AGENTS.md on a populated model.
 */
function printNextSteps(root: string): void {
  const state = detectDomainState(root);
  console.log("");
  console.log("Next steps:");
  switch (state) {
    case "missing":
      console.log("  1. Scaffold the domain:        dkk new domain");
      console.log("  2. Create your first context:  dkk new context <name>");
      console.log("  3. Add domain items:           dkk add <type> <name> --context <ctx>");
      console.log("  4. Validate + render docs:     dkk render");
      break;
    case "sample-only":
      console.log("  Your domain only has the `sample` scaffold. Replace it with real");
      console.log("  bounded contexts that match your business (e.g. billing, inventory):");
      console.log("    dkk new context <name>");
      console.log("    dkk add <type> <name> --context <ctx>");
      console.log("    dkk rm sample.SampleCreated   # (and the rest, once replacements exist)");
      break;
    case "ready":
      console.log("  You're set. Common daily commands:");
      console.log("    dkk search \"<query>\"           # find items");
      console.log("    dkk add <type> <name> --context <ctx>");
      console.log("    dkk render                     # after changes");
      console.log("    dkk prime                      # full AI-agent context");
      break;
    case "broken":
      console.log("  `.dkk/domain/` exists but could not be loaded. Run:");
      console.log("    dkk validate                   # see what's wrong");
      break;
  }
}

/** Register the `init` subcommand. */
export function registerInit(program: Cmd): void {
  program
    .command("init")
    .description("Create or update AGENTS.md with DKK onboarding section + print next-step guidance")
    .option("--skills", "Also install DKK skill files into .github/skills/")
    .option("--claude", "Also install Claude Code config (.claude/ settings, hooks, skills, agents, commands)")
    .option("--copilot", "Also install GitHub Copilot config (.github/ prompts, agent, skills, copilot-instructions.md, .vscode/mcp.json)")
    .option("--all", "Install both Claude Code and GitHub Copilot config (implies --skills and MCP registration)")
    .option("--no-mcp", "Don't write the .mcp.json / .vscode/mcp.json MCP server registration")
    .option("--force", "Overwrite existing skill, Claude, or Copilot files (applies with --skills/--claude/--copilot/--all)")
    .option("-r, --root <path>", "Override repository root")
    .action((opts: { root?: string; skills?: boolean; claude?: boolean; copilot?: boolean; all?: boolean; mcp?: boolean; force?: boolean }) => {
      const root = repoRoot(opts.root);
      const force = opts.force ?? false;
      const wantClaude = Boolean(opts.claude || opts.all);
      const wantCopilot = Boolean(opts.copilot || opts.all);
      const wantSkills = Boolean(opts.skills || opts.all);

      // AGENTS.md — create, refresh in place, or append the DKK section.
      const status = refreshAgentsMd(root);
      if (status === "created") console.log(`Created  AGENTS.md`);
      else if (status === "updated") console.log(`Updated  AGENTS.md (DKK section refreshed)`);
      else console.log(`Appended DKK section to AGENTS.md`);

      if (wantClaude) {
        installClaudeConfig(root, force);
      }

      if (wantCopilot) {
        // installCopilotConfig also installs the portable skills, so a
        // separate installSkills call would just re-report "Skipped".
        installCopilotConfig(root, force, { skipMcp: opts.mcp === false });
      } else if (wantSkills) {
        installSkills(root, force);
      }

      // MCP registration — commander sets `mcp` false only when `--no-mcp`
      // is passed; default (undefined/true) writes the committed .mcp.json.
      if (opts.mcp !== false) {
        printMcpOutcome(ensureMcpRegistered(root));
      }

      printNextSteps(root);
    });
}

