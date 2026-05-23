/**
 * `dkk new domain` command — scaffold a complete `.dkk/domain/` structure.
 *
 * Creates:
 *   .dkk/domain/index.yml          — domain index with one sample context
 *   .dkk/domain/actors.yml         — actors file with one sample actor
 *   .dkk/domain/contexts/sample/   — example bounded context with:
 *     context.yml, events/, commands/, aggregates/, policies/, read-models/
 *
 * Errors if `.dkk/domain/` already exists (use `--force` to overwrite).
 *
 * The scaffold logic is also exported as `scaffoldDomain()` so `dkk init`
 * can bootstrap the same structure during project initialization.
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { domainDir } from "../../../shared/paths.js";

// ── Template content ──────────────────────────────────────────────────

const INDEX_YML = `# Domain index — registered bounded contexts and cross-context flows.
contexts:
  - name: sample
    description: Example bounded context (replace with your own)
flows: []
`;

const ACTORS_YML = `# Actors — people and systems that interact with the domain.
actors:
  - name: User
    type: human
    description: A person who interacts with the system
`;

const CONTEXT_YML = `# Bounded context metadata and glossary.
name: sample
description: Example bounded context (replace with your own)
glossary:
  - term: Example
    definition: A sample glossary term to demonstrate the structure
`;

const SAMPLE_EVENT = `# Domain event — something that happened in the domain.
name: SampleCreated
description: Raised when a new sample entity is created
fields:
  - name: sampleId
    type: UUID
raised_by: Sample
`;

const SAMPLE_COMMAND = `# Command — an instruction to change domain state.
name: CreateSample
description: Create a new sample entity
actor: User
handled_by: Sample
`;

const SAMPLE_AGGREGATE = `# Aggregate — a consistency boundary that handles commands and emits events.
name: Sample
description: Sample aggregate root
handles:
  commands:
    - CreateSample
emits:
  events:
    - SampleCreated
`;

// ── Scaffold logic (shared with `dkk init`) ───────────────────────────

export type ScaffoldDomainStatus = "created" | "skipped" | "replaced";

export interface ScaffoldDomainResult {
  status: ScaffoldDomainStatus;
  path: string;
}

/**
 * Scaffold `.dkk/domain/` with sample content.
 *
 * - If the directory does not exist, creates it (`status: "created"`).
 * - If it exists and `force` is false, leaves it untouched (`status: "skipped"`).
 * - If it exists and `force` is true, removes it entirely first, then
 *   creates a fresh scaffold (`status: "replaced"`).
 */
export function scaffoldDomain(opts: { root?: string; force?: boolean } = {}): ScaffoldDomainResult {
  const dir = domainDir(opts.root);

  if (existsSync(dir) && !opts.force) {
    return { status: "skipped", path: dir };
  }

  const replaced = existsSync(dir) && (opts.force ?? false);
  if (replaced) {
    rmSync(dir, { recursive: true, force: true });
  }

  const contextsBase = join(dir, "contexts", "sample");
  const subDirs = ["events", "commands", "aggregates", "policies", "read-models"];
  for (const sub of subDirs) {
    mkdirSync(join(contextsBase, sub), { recursive: true });
  }

  writeFileSync(join(dir, "index.yml"), INDEX_YML, "utf-8");
  writeFileSync(join(dir, "actors.yml"), ACTORS_YML, "utf-8");
  writeFileSync(join(contextsBase, "context.yml"), CONTEXT_YML, "utf-8");
  writeFileSync(join(contextsBase, "events", "SampleCreated.yml"), SAMPLE_EVENT, "utf-8");
  writeFileSync(join(contextsBase, "commands", "CreateSample.yml"), SAMPLE_COMMAND, "utf-8");
  writeFileSync(join(contextsBase, "aggregates", "Sample.yml"), SAMPLE_AGGREGATE, "utf-8");

  return { status: replaced ? "replaced" : "created", path: dir };
}

/** Files created by a successful scaffold — used by callers that print their own report. */
export const SCAFFOLD_DOMAIN_FILES: readonly string[] = [
  "index.yml",
  "actors.yml",
  "contexts/sample/context.yml",
  "contexts/sample/events/SampleCreated.yml",
  "contexts/sample/commands/CreateSample.yml",
  "contexts/sample/aggregates/Sample.yml",
];

// ── Registration ──────────────────────────────────────────────────────

export function registerNewDomain(program: Cmd): void {
  program
    .command("domain")
    .description("Scaffold a complete .dkk/domain/ structure with sample content")
    .option("-r, --root <path>", "Override repository root")
    .option(
      "--force",
      "Replace the existing .dkk/domain/ directory entirely (destructive — all existing content is deleted)",
    )
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON")
    .action((opts: { root?: string; force?: boolean; json?: boolean; minify?: boolean }) => {
      const dir = domainDir(opts.root);

      if (existsSync(dir) && !opts.force) {
        console.error(
          `Error: ${dir} already exists. Use --force to replace it entirely.`,
        );
        process.exit(1);
      }

      const result = scaffoldDomain({ root: opts.root, force: opts.force });

      if (opts.json) {
         console.log(JSON.stringify({
            path: result.path,
            success: true,
         }, null, opts.minify ? 0 : 2));
         return;
      }

      console.log("Created .dkk/domain/ with sample content:");
      for (const f of SCAFFOLD_DOMAIN_FILES) console.log(`  ${f}`);
      console.log("\nRun `dkk render` to validate and generate documentation.");
    });
}
