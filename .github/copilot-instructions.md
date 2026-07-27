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

The `.dkk/domain/` directory in this repo contains a sample domain model used for testing the CLI. When editing domain YAML:

- Run `npx tsx src/cli.ts render` to verify changes (validates automatically, then renders docs and rebuilds search index).
- YAML files use `.yml` extension.
- Item names are PascalCase; context names and ADR ids are kebab-case.
- Generated docs go to `.dkk/docs/` — never edit by hand.

## Agent Integration Design

DKK provides two integration points for AI agents in user repos:

1. **`dkk init`** — Injects a DKK section into `AGENTS.md` (delimited by `<!-- dkk:start -->
# Domain Knowledge Kit — Agent Context

## Project Overview

This project uses a **Domain Knowledge Pack**: a structured, YAML-based domain model with Architecture Decision Records (ADRs), full-text search, and generated Markdown docs. The CLI is `dkk`.

DKK supports **multi-repo federation**: a `.dkk/service.yml` declares the repo a service and `.dkk/federation.yml` lists peers; the loader merges peer models so queries, search, graph traversal, and validation span every peer. Cross-service refs use `<service>:<context>.<Item>`; bare refs stay local. (Run `dkk_guide` topic `federation` for the full workflow.)

## Core Principles

1. **Domain YAML is the single source of truth.** Never generate domain knowledge from code.
   - **Structural changes (create, rename, delete):** ALWAYS use the dkk CLI (`dkk add`, `dkk rename`, `dkk rm`, `dkk new …`).
   - **Content updates (descriptions, fields, refs):** edit the YAML directly (respect the JSON Schemas in `tools/dkk/schema/`), then run `dkk render`.
2. **ADRs live in `.dkk/adr/`** as Markdown with YAML frontmatter; they link to items via `domain_refs` and items link back via `adr_refs`.
3. **Prioritize ADRs.** Before architectural refactors, tech choices, or domain-logic changes, consult existing decisions (`dkk_search`, `dkk_show`).
4. **Quality gate:** run `dkk render` before committing (validates → renders docs → rebuilds the search index). `dkk_validate` is a quick dry-run check.

## Retrieval — use the MCP tools

For all read/query operations, call the DKK MCP tools rather than shelling out to the CLI (same data, no shell-quoting):

| Tool | Use for |
|------|---------|
| `dkk_search` | Full-text search (filters: context, type, tag, service) |
| `dkk_summary` | Cheapest orientation around an id (+ direct neighbours) |
| `dkk_show` | Full definition of an item |
| `dkk_related` | Graph traversal / blast radius (depth ≥ 2) |
| `dkk_list` | List items by context/type |
| `dkk_story` | A flow's full story context |
| `dkk_stats` | Counts + orphan detection |
| `dkk_drift` | Model/code drift report (`code_refs` + git); pass `file` to map a source file to its context |
| `dkk_validate` | Schema + cross-reference validation |
| `dkk_guide` | On-demand deep reference: `yaml`, `update`, `federation`, `review`, `cli` |

When you're about to author or edit YAML, call `dkk_guide` topic `yaml`; before structural mutations, topic `update`.

## Mutations — CLI only (MCP is read-only)

| Command | Purpose |
|---------|---------|
| `dkk new domain` | Scaffold `.dkk/domain/` (one-time) |
| `dkk new context <name>` | Scaffold + register a bounded context |
| `dkk new adr "<title>"` | Scaffold a new ADR (auto-numbered) |
| `dkk add <type> <name> --context <ctx>` | Scaffold a domain item |
| `dkk rename <old-id> <new-id>` | Rename an item + update all refs |
| `dkk rm <id>` | Remove an item safely |
| `dkk render` | Validate → render docs → rebuild index |
| `dkk feedback add "<summary>" --kind <k>` | Record friction with **dkk itself** (local file, never transmitted) |

Run `dkk feedback add` only when the user hits a bug, confusing error, or missing capability in dkk itself, or asks you to record one — offer it, never file feedback unprompted.

## ID & Naming Conventions

| Item Type    | ID Format                | Example                  |
|--------------|--------------------------|--------------------------|
| Context item | `<context>.<ItemName>`   | `ordering.OrderPlaced`   |
| Actor        | `actor.<Name>`           | `actor.Customer`         |
| ADR          | `adr-NNNN`               | `adr-0001`               |
| Flow         | `flow.<Name>`            | `flow.OrderFulfillment`  |
| Context      | `context.<name>`         | `context.ordering`       |

Federated form: prefix any id with `<service>:` (e.g. `ordering:ordering.OrderPlaced`); bare ids resolve locally only.

Naming: items PascalCase (`OrderPlaced`), contexts kebab-case (`ordering`), ADR ids zero-padded `adr-NNNN`, actors PascalCase. YAML files use the `.yml` extension.

## Domain Model Layout

```
.dkk/
  service.yml / federation.yml   # OPTIONAL: federation (see dkk_guide federation)
  domain/
    index.yml                    # registered contexts + cross-context flows
    actors.yml                   # global actors (human | system | external)
    contexts/<name>/
      context.yml                # name, description, glossary
      events/ commands/ aggregates/ policies/ read-models/   # one .yml per item
  adr/adr-NNNN.md                # ADRs (YAML frontmatter)
  docs/                          # generated by `dkk render` — do not edit by hand
```

## Item Types

| Type | Description | Key Fields |
|------|-------------|------------|
| **Event** | Something that happened | `name`, `description`, `fields`, `raised_by`, `adr_refs` |
| **Command** | Instruction to change state | `name`, `description`, `fields`, `actor`, `handled_by`, `adr_refs` |
| **Policy** | Reactive logic on events | `name`, `description`, `when`, `then`, `adr_refs` |
| **Aggregate** | Consistency boundary | `name`, `description`, `handles`, `emits`, `adr_refs` |
| **Read Model** | Query projection | `name`, `description`, `fields`, `subscribes_to`, `used_by`, `adr_refs` |
| **Glossary** | Ubiquitous-language term | `term`, `definition`, `aliases`, `adr_refs` |
| **Actor** | Person or system | `name`, `type`, `description`, `capabilities`, `failure_modes` |
| **Flow** | Cross-context sequence | `name`, `description`, `steps[]` |

For full YAML examples of each item type, call `dkk_guide` topic `yaml`.

> **Live domain summary:** the context above is the *static* DKK contract, refreshed by `dkk update`. For the current model (contexts, items, ADRs) run `dkk prime` in the terminal, or call the `dkk` MCP server's `prime` tool. Prefer the `dkk_*` MCP tools for all queries; use the `dkk` CLI for mutations. Ready-made prompts live in `.github/prompts/dkk-*.prompt.md` (invoke as `/dkk-review`, `/dkk-impact`, …), and the `dkk-domain-reviewer` custom agent lives in `.github/agents/`.
<!-- dkk:end -->
` markers). The section is a hardcoded string in `init.ts`.
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