# Domain Knowledge Skill

> Portable Agent Skill for working with a Domain Knowledge Pack.

## Description

This skill enables an AI agent to understand, query, and maintain a structured domain model defined in YAML with linked Architecture Decision Records (ADRs). The domain model follows Domain-Driven Design (DDD) patterns: bounded contexts, events, commands, policies, aggregates, read models, glossary terms, actors, and cross-context flows.

## Canonical Model

The domain model is stored as YAML files on disk:

| Path | Content |
|------|---------|
| `domain/index.yml` | Registered bounded contexts and cross-context flows |
| `domain/actors.yml` | Global actors (human, system, external) |
| `domain/contexts/<name>.yml` | Bounded context: events, commands, policies, aggregates, read models, glossary |
| `docs/adr/adr-NNNN.md` | Architecture Decision Records with YAML frontmatter linking to domain items |

### Item Types

| Type | Description | Key Fields |
|------|-------------|------------|
| **Event** | Something that happened in the domain | `name`, `description`, `fields`, `raised_by`, `adr_refs` |
| **Command** | An instruction to change state | `name`, `description`, `fields`, `actor`, `handled_by`, `adr_refs` |
| **Policy** | Reactive logic triggered by events | `name`, `description`, `triggers`, `emits`, `adr_refs` |
| **Aggregate** | Consistency boundary handling commands | `name`, `description`, `handles`, `emits`, `adr_refs` |
| **Read Model** | Query-optimized projection | `name`, `description`, `subscribes_to`, `used_by`, `adr_refs` |
| **Glossary** | Ubiquitous language term | `term`, `definition`, `aliases`, `adr_refs` |
| **Actor** | Person or system interacting with the domain | `name`, `type`, `description`, `adr_refs` |
| **Flow** | Cross-context sequence of steps | `name`, `description`, `steps[]` |

### ID Conventions

| Scope | Format | Example |
|-------|--------|---------|
| Context item | `<context>.<ItemName>` | `ordering.OrderPlaced` |
| Actor | `actor.<Name>` | `actor.Customer` |
| ADR | `adr-NNNN` | `adr-0001` |
| Flow | `flow.<Name>` | `flow.OrderFulfillment` |
| Context | `context.<name>` | `context.ordering` |

## Retrieval Rules

When answering questions about the domain, always query the model rather than guessing:

1. **Search** — `npx tsx src/cli.ts search "<query>"` performs FTS5 full-text search with relevance ranking.
2. **Show** — `npx tsx src/cli.ts show <id>` returns the full YAML definition of any item.
3. **Related** — `npx tsx src/cli.ts related <id> --depth <n>` performs BFS graph traversal to find connected items.
4. **List** — `npx tsx src/cli.ts list [--context <name>] [--type <type>]` enumerates items with optional filtering.
5. **ADR links** — `npx tsx src/cli.ts adr related <id>` finds bidirectional ADR ↔ domain-item links.

## Update Rules

When modifying the domain model:

1. **Edit YAML files directly** — never generate domain items from application code.
2. **Maintain referential integrity:**
   - `adr_refs` must point to existing ADRs in `docs/adr/`.
   - `domain_refs` in ADR frontmatter must point to existing domain items.
   - Cross-references (`handles`, `emits`, `triggers`, `subscribes_to`, `used_by`, `raised_by`, `handled_by`, `actor`) must resolve within the same context or to global actors.
3. **Follow naming conventions:**
   - Items: PascalCase (`OrderPlaced`, `PlaceOrder`).
   - Contexts: kebab-case (`ordering`, `inventory-management`).
   - ADR ids: `adr-NNNN` (zero-padded).
4. **Run quality gates after every change:**
   ```bash
   npx tsx src/cli.ts validate   # Schema + cross-reference checks
   npx tsx src/cli.ts render     # Validate → render docs → rebuild search index
   ```
5. **Update ADRs** when changes affect architectural decisions — add `domain_refs` to the ADR and `adr_refs` to the domain items.

## Validation

The validator checks:
- **Schema conformance** — Each YAML file is validated against its JSON Schema (`tools/domain-pack/schema/`).
- **Cross-references** — All item-to-item, item-to-ADR, and ADR-to-item references resolve correctly.
- **Context registration** — Every context file in `domain/contexts/` is registered in `domain/index.yml`.

## Generated Documentation

Running `npx tsx src/cli.ts render` produces:
- `docs/domain/index.md` — Top-level domain overview.
- `docs/domain/<context>/index.md` — Per-context overview.
- `docs/domain/<context>/<ItemName>.md` — Per-item detail page.
- SQLite FTS5 search index for the `search` command.

Do not edit files under `docs/domain/` by hand; they are regenerated on each render.
