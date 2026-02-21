# Domain Knowledge Kit

A structured, YAML-based domain model with Architecture Decision Records (ADRs), full-text search, and generated Markdown documentation.

Domain Knowledge Kit lets you define bounded contexts, events, commands, policies, aggregates, read models, and glossary terms in YAML — then validate, render, and search them from the CLI.

## Quick Start

```bash
# Install dependencies
npm install

# Validate the domain model
npm run dev -- validate

# Render generated documentation
npm run dev -- render

# Search domain items
npm run dev -- search "order"
```

`npm run dev` is shorthand for `npx tsx src/cli.ts`. After building (`npm run build`), the CLI is also available as `domain-knowledge-kit`:

```bash
npm run build
npx domain-knowledge-kit validate
npx domain-knowledge-kit render
```

## Directory Layout

```
domain/
  index.yml              # Registered contexts + cross-context flows
  actors.yml             # Global actors (human | system | external)
  contexts/
    <name>.yml           # Bounded context definition

docs/
  adr/                   # Architecture Decision Records (Markdown + YAML frontmatter)
  domain/                # Generated documentation (do not edit by hand)

src/
  cli.ts                 # Slim CLI entry point (registers commands)
  features/              # Vertical feature slices
    query/               # List, show, search, related commands
      commands/          #   CLI command handlers
      searcher.ts        #   FTS5 search logic
      tests/             #   Co-located unit tests
    adr/                 # ADR show & related commands
      commands/          #   CLI command handlers
    pipeline/            # Validate, render, index pipeline
      commands/          #   CLI command handlers
      validator.ts       #   Schema + cross-ref validation
      renderer.ts        #   Handlebars doc generation
      indexer.ts          #   Search index builder
      tests/             #   Co-located unit tests
  shared/                # Cross-cutting infrastructure
    types/               #   DomainModel, SearchIndexRecord, etc.
    loader.ts            #   YAML model loading
    graph.ts             #   BFS graph traversal
    item-visitor.ts      #   Generic item iteration utility
    adr-parser.ts        #   ADR frontmatter parsing
    paths.ts             #   Path resolution helpers
    errors.ts            #   Error formatting
    yaml.ts              #   YAML I/O helpers
    tests/               #   Co-located unit tests

tools/
  domain-pack/
    schema/              # JSON Schemas for domain YAML validation
    templates/           # Handlebars templates for doc generation

test/
  cli-integration.ts     # End-to-end CLI integration tests

.github/
  copilot-instructions.md  # Copilot integration instructions
```

### Architecture: Vertical Feature Slices

The source code is organized into **vertical feature slices** rather than horizontal layers. Each feature slice (`query`, `adr`, `pipeline`) owns its commands, core logic, and tests. The `shared/` module contains cross-cutting infrastructure used by all slices (loader, graph traversal, type definitions, etc.).

This structure ensures that adding a new domain item type or feature requires changes localized to one slice, reducing coupling and making the codebase easier to navigate.

## Adding a Bounded Context

1. Create a new file `domain/contexts/<name>.yml`:

   ```yaml
   name: <name>
   description: A short description of this bounded context.
   events: []
   commands: []
   policies: []
   aggregates: []
   read_models: []
   glossary: []
   ```

2. Register it in `domain/index.yml`:

   ```yaml
   contexts:
     - name: <name>
   ```

3. Run quality gates:

   ```bash
   npx tsx src/cli.ts validate
   npx tsx src/cli.ts render
   ```

## Adding an ADR and Linking It

1. Create a Markdown file in `docs/adr/` following the naming convention `adr-NNNN.md` (e.g. `adr-0002.md`):

   ```markdown
   ---
   id: adr-NNNN
   title: Short Title
   status: proposed
   date: YYYY-MM-DD
   domain_refs:
     - <context>.<ItemName>
   ---

   ## Context
   ...

   ## Decision
   ...

   ## Consequences
   ...
   ```

2. Link back from domain items by adding the ADR id to their `adr_refs`:

   ```yaml
   # In domain/contexts/<name>.yml, on the relevant item:
   adr_refs:
     - adr-NNNN
   ```

3. Run quality gates:

   ```bash
   npx tsx src/cli.ts validate
   npx tsx src/cli.ts render
   ```

## CLI Command Reference

During development, substitute `npx tsx src/cli.ts` (or `npm run dev --`) for `domain-knowledge-kit`.

### `list`

List all domain items.

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --context <name>` | — | Filter by bounded context |
| `-t, --type <type>` | — | Filter by item type (`event`, `command`, `policy`, `aggregate`, `read_model`, `glossary`, `actor`, `adr`, `flow`, `context`) |
| `--json` | — | Output as JSON |
| `-r, --root <path>` | repo root | Override repository root |

### `show <id>`

Display the full YAML of a single domain item.

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Output as JSON |
| `-r, --root <path>` | repo root | Override repository root |

### `search <query>`

FTS5 full-text search with ranking. Requires a pre-built index — run `render` first.

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --context <name>` | — | Filter results to a bounded context |
| `-t, --type <type>` | — | Filter by item type |
| `--tag <tag>` | — | Filter by tag/keyword |
| `--limit <n>` | `20` | Maximum number of results |
| `--expand` | — | Expand top results with graph neighbours |
| `--json` | — | Output as JSON |
| `-r, --root <path>` | repo root | Override repository root |

### `related <id>`

BFS graph traversal of related items.

| Flag | Default | Description |
|------|---------|-------------|
| `-d, --depth <n>` | `1` | Maximum BFS traversal depth |
| `--json` | — | Output as JSON |
| `-r, --root <path>` | repo root | Override repository root |

### `validate`

Schema + cross-reference validation.

| Flag | Default | Description |
|------|---------|-------------|
| `--warn-missing-fields` | — | Warn about events/commands with no `fields` defined |
| `--json` | — | Output as JSON |
| `-r, --root <path>` | repo root | Override repository root |

### `render`

Validate → render Handlebars Markdown docs → rebuild FTS5 SQLite search index.

| Flag | Default | Description |
|------|---------|-------------|
| `--skip-validation` | — | Skip the schema + cross-ref validation step |
| `--json` | — | Output as JSON |
| `-r, --root <path>` | repo root | Override repository root |

### `adr show <id>`

Display ADR frontmatter as YAML.

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Output as JSON |
| `-r, --root <path>` | repo root | Override repository root |

### `adr related <id>`

Show bidirectional ADR ↔ domain links. Given an ADR id, lists domain items that reference it; given a domain item id, lists ADRs that reference it.

| Flag | Default | Description |
|------|---------|-------------|
| `-r, --root <path>` | repo root | Override repository root |

## ID Conventions

| Item Type    | Format                     | Example                  |
|--------------|----------------------------|--------------------------|
| Context item | `<context>.<ItemName>`     | `ordering.OrderPlaced`   |
| Actor        | `actor.<Name>`             | `actor.Customer`         |
| ADR          | `adr-NNNN`                 | `adr-0001`               |
| Flow         | `flow.<Name>`              | `flow.OrderFulfillment`  |
| Context      | `context.<name>`           | `context.ordering`       |

## Copilot Integration

[.github/copilot-instructions.md](.github/copilot-instructions.md) configures GitHub Copilot to understand the domain model structure and use domain-first retrieval (search → show → related → adr related).

## License

Elastic-2.0
