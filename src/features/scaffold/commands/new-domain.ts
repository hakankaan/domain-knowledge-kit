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
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

// ── Registration ──────────────────────────────────────────────────────

export function registerNewDomain(program: Cmd): void {
  program
    .command("domain")
    .description("Scaffold a complete .dkk/domain/ structure with sample content")
    .option("-r, --root <path>", "Override repository root")
    .option("--force", "Overwrite existing .dkk/domain/ directory")
    .action((opts: { root?: string; force?: boolean }) => {
      const dir = domainDir(opts.root);

      // Guard: refuse to overwrite unless --force
      if (existsSync(dir) && !opts.force) {
        console.error(
          `Error: ${dir} already exists. Use --force to overwrite.`,
        );
        process.exit(1);
      }

      // Create directory structure
      const contextsBase = join(dir, "contexts", "sample");
      const subDirs = ["events", "commands", "aggregates", "policies", "read-models"];
      for (const sub of subDirs) {
        mkdirSync(join(contextsBase, sub), { recursive: true });
      }

      // Write files
      writeFileSync(join(dir, "index.yml"), INDEX_YML, "utf-8");
      writeFileSync(join(dir, "actors.yml"), ACTORS_YML, "utf-8");
      writeFileSync(join(contextsBase, "context.yml"), CONTEXT_YML, "utf-8");
      writeFileSync(join(contextsBase, "events", "SampleCreated.yml"), SAMPLE_EVENT, "utf-8");
      writeFileSync(join(contextsBase, "commands", "CreateSample.yml"), SAMPLE_COMMAND, "utf-8");
      writeFileSync(join(contextsBase, "aggregates", "Sample.yml"), SAMPLE_AGGREGATE, "utf-8");

      console.log("Created .dkk/domain/ with sample content:");
      console.log("  index.yml");
      console.log("  actors.yml");
      console.log("  contexts/sample/");
      console.log("    context.yml");
      console.log("    events/SampleCreated.yml");
      console.log("    commands/CreateSample.yml");
      console.log("    aggregates/Sample.yml");
      console.log("\nRun `dkk render` to validate and generate documentation.");
    });
}
