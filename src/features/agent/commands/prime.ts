/**
 * `dkk prime` command — output full agent context to stdout.
 *
 * Prints a comprehensive DKK usage guide for AI agent consumption.
 * Hardcoded template covering project overview, core principles,
 * domain structure, retrieval workflow, change workflow, ID conventions,
 * CLI reference, and file conventions.
 */
import type { Command as Cmd } from "commander";

/** The full agent context document. */
function primeContent(): string {
  return `# Domain Knowledge Kit — Agent Context

## Project Overview

This project uses a **Domain Knowledge Pack**: a structured, YAML-based domain model with Architecture Decision Records (ADRs), full-text search, and generated Markdown documentation. The CLI tool is \`dkk\`.

## Core Principles

1. **Domain YAML is the single source of truth.** Never generate domain knowledge from code; always read and edit the YAML files under \`domain/\`.
2. **ADRs live in \`.dkk/adr/\`** as Markdown files with YAML frontmatter. They link to domain items via \`domain_refs\` and domain items link back via \`adr_refs\`.
3. **Every change to domain files must pass quality gates:** run \`dkk validate\` then \`dkk render\` before committing.

## Domain Model Structure

\`\`\`
domain/
  index.yml          # Top-level: registered contexts + cross-context flows
  actors.yml          # Global actors (human | system | external)
  contexts/
    <name>/           # Bounded context directory
      context.yml     # Context metadata, glossary
      events/         # Domain events
      commands/       # Commands
      aggregates/     # Aggregate roots
      policies/       # Policies / reactors
      read_models/    # Read models / projections
.dkk/
  adr/
    adr-NNNN.md        # Architecture Decision Records (YAML frontmatter)
\`\`\`

## Domain-First Retrieval

When answering questions about the domain:

1. **Search first.** Use \`dkk search "<query>"\` to find relevant domain items.
2. **Show details.** Use \`dkk show <id>\` to inspect a specific item (e.g. \`ordering.OrderPlaced\`, \`actor.Customer\`, \`adr-0001\`).
3. **Explore relationships.** Use \`dkk related <id>\` to discover connected items via BFS graph traversal.
4. **Check ADR links.** Use \`dkk adr related <id>\` to find bidirectional ADR ↔ domain links.
5. **List items.** Use \`dkk list\` with optional \`--context\` and \`--type\` filters.

Always ground answers in the actual domain model data rather than assumptions.

## Making Domain Changes

When modifying the domain model:

1. **Edit YAML files directly** — add or modify items in the appropriate context file under \`domain/contexts/\`, or in \`domain/actors.yml\` / \`domain/index.yml\`.
2. **Maintain referential integrity:**
   - \`adr_refs\` values must match existing ADR ids in \`.dkk/adr/\`.
   - \`domain_refs\` in ADR frontmatter must match existing domain item ids (\`context.ItemName\`).
   - Cross-references (\`handles\`, \`emits\`, \`triggers\`, \`subscribes_to\`, \`used_by\`, \`raised_by\`, \`handled_by\`, \`actor\`) must reference items that exist in the same bounded context (or global actors).
3. **Update related ADRs** when a change alters an architectural decision.
4. **Run quality gates after every change:**
   \`\`\`bash
   dkk validate
   dkk render
   \`\`\`

## ID Conventions

| Item Type    | ID Format                          | Example                    |
|--------------|------------------------------------|----------------------------|
| Context item | \`<context>.<ItemName>\`             | \`ordering.OrderPlaced\`     |
| Actor        | \`actor.<Name>\`                     | \`actor.Customer\`           |
| ADR          | \`adr-NNNN\`                         | \`adr-0001\`                 |
| Flow         | \`flow.<Name>\`                      | \`flow.OrderFulfillment\`    |
| Context      | \`context.<name>\`                   | \`context.ordering\`         |

## CLI Command Reference

| Command                       | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| \`dkk list\`                    | List all domain items (filterable by \`--context\`, \`--type\`) |
| \`dkk show <id>\`               | Display full YAML of a domain item                   |
| \`dkk search <query>\`          | FTS5 full-text search with ranking                   |
| \`dkk related <id>\`            | BFS graph traversal of related items                 |
| \`dkk validate\`                | Schema + cross-reference validation                  |
| \`dkk render\`                  | Validate → render docs → rebuild search index        |
| \`dkk adr show <id>\`           | Display ADR frontmatter                              |
| \`dkk adr related <id>\`        | Show bidirectional ADR ↔ domain links                |
| \`dkk init\`                    | Create/update AGENTS.md with DKK section             |
| \`dkk prime\`                   | Output this agent context to stdout                  |

## File Conventions

- YAML files use \`.yml\` extension.
- Names are PascalCase for items (events, commands, etc.) and kebab-case for contexts and ADR ids.
- JSON Schemas live in \`tools/dkk/schema/\`; Handlebars templates in \`tools/dkk/templates/\`.
- Generated documentation goes to \`.dkk/docs/\` (do not edit by hand).
`;
}

/** Register the `prime` subcommand. */
export function registerPrime(program: Cmd): void {
  program
    .command("prime")
    .description("Output full DKK agent context to stdout")
    .action(() => {
      process.stdout.write(primeContent());
    });
}
