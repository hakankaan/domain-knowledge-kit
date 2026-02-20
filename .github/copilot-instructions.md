# Copilot Instructions — Domain Knowledge Kit

## Project Overview

This repository defines a **Domain Knowledge Pack**: a structured, YAML-based domain model with Architecture Decision Records (ADRs), full-text search, and generated Markdown documentation. The CLI tool is `domain-knowledge-kit` (dev: `npx tsx src/cli.ts`).

## Core Principles

1. **Domain YAML is the single source of truth.** Never generate domain knowledge from code; always read and edit the YAML files under `domain/`.
2. **ADRs live in `docs/adr/`** as Markdown files with YAML frontmatter. They link to domain items via `domain_refs` and domain items link back via `adr_refs`.
3. **Every change to domain files must pass quality gates:** run `npx tsx src/cli.ts validate` then `npx tsx src/cli.ts render` before committing.

## Domain Model Structure

```
domain/
  index.yml          # Top-level: registered contexts + cross-context flows
  actors.yml          # Global actors (human | system | external)
  contexts/
    <name>.yml        # Bounded context with events, commands, policies,
                      #   aggregates, read_models, glossary
docs/adr/
  adr-NNNN.md        # Architecture Decision Records (YAML frontmatter)
```

## Domain-First Retrieval

When answering questions about the domain:

1. **Search first.** Use `npx tsx src/cli.ts search "<query>"` to find relevant domain items.
2. **Show details.** Use `npx tsx src/cli.ts show <id>` to inspect a specific item (e.g. `ordering.OrderPlaced`, `actor.Customer`, `adr-0001`).
3. **Explore relationships.** Use `npx tsx src/cli.ts related <id>` to discover connected items via BFS graph traversal.
4. **Check ADR links.** Use `npx tsx src/cli.ts adr related <id>` to find bidirectional ADR ↔ domain links.
5. **List items.** Use `npx tsx src/cli.ts list` with optional `--context` and `--type` filters.

Always ground answers in the actual domain model data rather than assumptions.

## Making Domain Changes

When modifying the domain model:

1. **Edit YAML files directly** — add or modify items in the appropriate context file under `domain/contexts/`, or in `domain/actors.yml` / `domain/index.yml`.
2. **Maintain referential integrity:**
   - `adr_refs` values must match existing ADR ids in `docs/adr/`.
   - `domain_refs` in ADR frontmatter must match existing domain item ids (`context.ItemName`).
   - Cross-references (`handles`, `emits`, `triggers`, `subscribes_to`, `used_by`, `raised_by`, `handled_by`, `actor`) must reference items that exist in the same bounded context (or global actors).
3. **Update related ADRs** when a change alters an architectural decision.
4. **Run quality gates after every change:**
   ```bash
   npx tsx src/cli.ts validate
   npx tsx src/cli.ts render
   ```

## ID Conventions

| Item Type    | ID Format                          | Example                    |
|--------------|------------------------------------|----------------------------|
| Context item | `<context>.<ItemName>`             | `ordering.OrderPlaced`     |
| Actor        | `actor.<Name>`                     | `actor.Customer`           |
| ADR          | `adr-NNNN`                         | `adr-0001`                 |
| Flow         | `flow.<Name>`                      | `flow.OrderFulfillment`    |
| Context      | `context.<name>`                   | `context.ordering`         |

## CLI Command Reference

| Command                       | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| `domain list`                 | List all domain items (filterable by `--context`, `--type`) |
| `domain show <id>`            | Display full YAML of a domain item                   |
| `domain search <query>`       | FTS5 full-text search with ranking                   |
| `domain related <id>`         | BFS graph traversal of related items                 |
| `domain validate`             | Schema + cross-reference validation                  |
| `domain render`               | Validate → render docs → rebuild search index        |
| `domain adr show <id>`        | Display ADR frontmatter                              |
| `domain adr related <id>`     | Show bidirectional ADR ↔ domain links                |

## File Conventions

- YAML files use `.yml` extension.
- Names are PascalCase for items (events, commands, etc.) and kebab-case for contexts and ADR ids.
- JSON Schemas live in `tools/domain-pack/schema/`; Handlebars templates in `tools/domain-pack/templates/`.
- Generated documentation goes to `docs/domain/` (do not edit by hand).
