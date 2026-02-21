# Copilot Instructions — DKK Development

These instructions are for **contributing to the DKK codebase itself**, not for using DKK in your project. Users of DKK should run `dkk prime` for full agent context.

## What DKK Is

DKK (Domain Knowledge Kit) is a CLI tool that lets teams define their business domain as structured YAML, link it to Architecture Decision Records, validate cross-references, render Markdown docs, and expose full-text search — all designed for AI agent consumption.

## Development Setup

```bash
npm install              # Install dependencies
npm run dev -- <command> # Run CLI in dev (e.g. npm run dev -- validate)
npx tsx src/cli.ts       # Alternative: run CLI entry point directly
npm run build            # Compile TypeScript to dist/
npm run typecheck        # Type-check without emitting
npm run lint             # ESLint
npx vitest run           # Run tests
```

Published binary name: `dkk`. Dev equivalent: `npx tsx src/cli.ts`.

## Source Code Structure

```
src/
  cli.ts                          # Entry point — registers all commands with Commander
  features/
    query/                        # Read-only commands: list, show, search, related
      searcher.ts                 # SQLite FTS5 search logic
      commands/                   # Command registration (list.ts, show.ts, etc.)
      tests/                      # searcher.test.ts
    pipeline/                     # Write commands: validate, render
      validator.ts                # Schema + cross-reference validation
      renderer.ts                 # Handlebars doc generation
      indexer.ts                  # FTS5 index builder
      commands/                   # validate.ts, render.ts
      tests/                      # validator.test.ts, renderer.test.ts, etc.
    adr/                          # ADR sub-commands: adr show, adr related
      commands/
    agent/                        # Agent integration: init, prime
      commands/
        init.ts                   # Creates/updates AGENTS.md with DKK section
        prime.ts                  # Outputs comprehensive agent context to stdout
  shared/
    loader.ts                     # YAML file loader
    graph.ts                      # BFS graph traversal
    item-visitor.ts               # Visitor pattern for domain items
    adr-parser.ts                 # ADR markdown + frontmatter parser
    paths.ts                      # Path resolution (repoRoot, schema paths, etc.)
    errors.ts                     # Error formatting
    yaml.ts                       # YAML parse/serialize helpers
    types/
      domain.ts                   # TypeScript types for domain model
```

## Key Conventions

- **TypeScript strict mode**, ES2022 target, Node16 module resolution.
- **ESM only** — all imports use `.js` extensions.
- Each CLI command lives in `src/features/<area>/commands/<name>.ts` and exports a `register<Name>(program)` function.
- Commands are registered in `src/cli.ts`.
- JSON Schemas for domain YAML validation live in `tools/dkk/schema/`.
- Handlebars templates for doc rendering live in `tools/dkk/templates/`.
- Tests use **vitest** and live alongside source in `tests/` subdirectories.
- Integration tests are in `test/cli-integration.ts`.

## Domain Model

The `domain/` directory in this repo contains a sample domain model used for testing the CLI. When editing domain YAML:

- Run `npx tsx src/cli.ts validate` then `npx tsx src/cli.ts render` to verify changes.
- YAML files use `.yml` extension.
- Item names are PascalCase; context names and ADR ids are kebab-case.
- Generated docs go to `.dkk/docs/` — never edit by hand.

## Agent Integration Design

DKK provides two integration points for AI agents in user repos:

1. **`dkk init`** — Injects a DKK section into `AGENTS.md` (delimited by `<!-- dkk:start -->` / `<!-- dkk:end -->` markers). The section is a hardcoded string in `init.ts`.
2. **`dkk prime`** — Outputs a comprehensive agent context document to stdout. The content is a hardcoded string in `prime.ts` covering item types, retrieval/update/review workflows, YAML structure reference, validation, and all CLI commands.

When modifying agent-facing content, edit the string literals in `init.ts` or `prime.ts` directly — there are no external templates.

## Issue Tracking

This project uses **bd (beads)** for issue tracking.
Run `bd prime` for workflow context.

**Quick reference:**
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)