# CLI Reference

← [Back to README](../README.md)

All commands use `dkk` (the installed CLI binary). During local development of DKK itself, substitute `npm run dev --` or `npx tsx src/cli.ts` for `dkk`.

```bash
# Installed
dkk <command> [options]

# Local development
npm run dev -- <command> [options]
npx tsx src/cli.ts <command> [options]
```


## Agent Mode (Opt-In)

DKK CLI includes an opt-in **Agent Mode** designed specifically for AI contexts.
You can enable it by:
- Passing the `--agent` global flag
- Setting the environment variable `DKK_AGENT_MODE=1`

**Behavior changes in Agent Mode:**
- For commands that support it, `--json` and `--minify` are **enabled by default**.
- Human-friendly tabular or formatted text outputs are skipped in favor of compact JSON.
- If you need to override the agent mode default for a specific invocation, pass `--no-json` or `--no-minify`.


## Agent Mode (Opt-In)

DKK CLI includes an opt-in **Agent Mode** designed specifically for AI contexts.
You can enable it by:
- Passing the `--agent` global flag
- Setting the environment variable `DKK_AGENT_MODE=1`

**Behavior changes in Agent Mode:**
- For commands that support it, `--json` and `--minify` are **enabled by default**.
- Human-friendly tabular or formatted text outputs are skipped in favor of compact JSON.
- If you need to override the agent mode default for a specific invocation, pass `--no-json` or `--no-minify`.

---

## `list`

List all domain items. Useful for getting an overview of what's defined in your model.

```bash
dkk list
dkk list --context ordering
dkk list --type event
dkk list --context ordering --type command --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --context <name>` | — | Filter by bounded context |
| `-t, --type <type>` | — | Filter by item type (see [Item Types](#item-types)) |
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output (AI-optimized) |
| `-r, --root <path>` | repo root | Override repository root |

---

## `summary <id>`

Provide a concise overview of a domain item, including its ID, name, kind, context, and immediate graph neighbors (depth 1). Designed for minimal token consumption by AI agents.

```bash
dkk summary ordering.OrderPlaced
dkk summary ordering.Order --json --minify
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output |
| `-r, --root <path>` | repo root | Override repository root |

---

## `show <id>`

Display the full YAML definition of a single domain item.

```bash
dkk show ordering.OrderPlaced
dkk show actor.Customer
dkk show adr-0001 --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output |
| `-r, --root <path>` | repo root | Override repository root |

→ See [ID Conventions](domain-modeling.md#id-conventions) for the ID format.

---

## `search <query>`

Full-text search across all domain items with relevance ranking. Uses FTS5 (SQLite). Requires a pre-built index — run `dkk render` first.

```bash
dkk search "order"
dkk search "payment" --context billing --type event
dkk search "customer" --expand --limit 5
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --context <name>` | — | Filter results to a bounded context |
| `-t, --type <type>` | — | Filter by item type |
| `--tag <tag>` | — | Filter by tag/keyword |
| `--limit <n>` | `20` | Maximum number of results |
| `--expand` | — | Expand top results with graph neighbours |
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output |
| `-r, --root <path>` | repo root | Override repository root |

---

## `related <id>`

BFS graph traversal from a given item — discover everything connected to it.

```bash
dkk related ordering.Order
dkk related ordering.OrderPlaced --depth 2
dkk related actor.Customer --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `-d, --depth <n>` | `1` | Maximum BFS traversal depth |
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output |
| `-r, --root <path>` | repo root | Override repository root |

---

## `graph`

Generate a Mermaid.js flowchart of the domain model, capturing all nodes and their interactions.

```bash
dkk graph
dkk graph --layout TD
dkk graph --context ordering --depth 2 --node-types event,command,aggregate
dkk graph --output .dkk/docs/graph.md
```

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <file>` | `.dkk/docs/graph.md` | Output file path |
| `-d, --depth <n>` | `3` | Maximum traversal depth |
| `-l, --layout <dir>` | `LR` | Flowchart direction: `LR` (left-to-right) or `TD` (top-down) |
| `-n, --node-types <types>` | *(all)* | Comma-separated node kinds to include (e.g. `event,command,aggregate`) |
| `-c, --context <name>` | — | Render only items from this bounded context |
| `-r, --root <path>` | repo root | Override repository root |

**Focused-view pattern:**

```bash
# Flow-focused: commands and events only, left-to-right
dkk graph --node-types event,command,aggregate --layout LR

# Context-scoped: everything in one bounded context, shallow depth
dkk graph --context payments --depth 2

# Structural overview: aggregates and actors only
dkk graph --node-types aggregate,actor
```

---

## `rename <old-id> <new-id>`

Rename a domain item and automatically update all its references across other YAML items and Markdown ADRs.

```bash
dkk rename ordering.OrderPlaced ordering.OrderShipped
```

| Flag | Default | Description |
|------|---------|-------------|
| `--diff` | — | Output a unified diff of all resulting file changes |
| `-r, --root <path>` | repo root | Override repository root |

---

## `rm <id>` (or `remove`, `delete`)

Remove a domain item securely. The command validates the domain graph and blocks deletion if other items depend on it.

```bash
dkk rm ordering.OrderShipped
dkk rm ordering.OrderShipped --force
```

| Flag | Default | Description |
|------|---------|-------------|
| `-f, --force` | — | Force removal even if there are dependents |
| `--diff` | — | Output a diff representation of the resulting changes |
| `-r, --root <path>` | repo root | Override repository root |

---

## `stats`

Print domain model statistics and summarize model health by identifying orphaned items (items with no connections).

```bash
dkk stats
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output (AI-optimized) |
| `-r, --root <path>` | repo root | Override repository root |

---

## `validate`

Run schema validation (JSON Schema) and cross-reference checks on the entire domain model.

```bash
dkk validate
dkk validate ordering.OrderPlaced
dkk validate --json --minify
```

Checks performed:
- **Schema conformance** — Each YAML file is validated against its JSON Schema in `tools/dkk/schema/`.
- **Cross-references** — All item-to-item, item-to-ADR, and ADR-to-item references resolve correctly.
- **Context registration** — Every context directory in `.dkk/domain/contexts/` is registered in `.dkk/domain/index.yml`.

| Flag | Default | Description |
|------|---------|-------------|
| `--warn-missing-fields` | — | Warn about events/commands with no `fields` defined |
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output |
| `-r, --root <path>` | repo root | Override repository root |

---

## `render`

Run the full pipeline: validate → render Handlebars Markdown docs → rebuild FTS5 SQLite search index.

```bash
dkk render
dkk render --skip-validation
```

Output:
- `.dkk/docs/index.md` — Top-level domain overview.
- `.dkk/docs/<context>/index.md` — Per-context overview.
- `.dkk/docs/<context>/<ItemName>.md` — Per-item detail page.
- `.dkk/index.db` — SQLite FTS5 search index (used by `search` command).

| Flag | Default | Description |
|------|---------|-------------|
| `--skip-validation` | — | Skip the schema + cross-ref validation step |
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output (AI-optimized) |
| `-r, --root <path>` | repo root | Override repository root |

---

## `init`

Create or update `AGENTS.md` with a DKK onboarding section. The section is delimited by `<!-- dkk:start -->` / `<!-- dkk:end -->` HTML comment markers, making the operation idempotent — re-running replaces the section in place.

```bash
dkk init
```

| Flag | Default | Description |
|------|---------|-------------|
| `-r, --root <path>` | repo root | Override repository root |

→ See [AI Agent Integration](ai-agent-integration.md) for the full agent onboarding workflow.

---

## `prime`

Output comprehensive DKK agent context to stdout. Designed for AI agent consumption — covers project overview, core principles, domain structure, retrieval workflow, change workflow, ID conventions, CLI reference, and file conventions.

```bash
dkk prime
```

→ See [AI Agent Integration](ai-agent-integration.md) for details.

---

## `show <id>`

Display the YAML frontmatter of an Architecture Decision Record.

```bash
dkk show adr-0001
dkk show adr-0001 --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output |
| `-r, --root <path>` | repo root | Override repository root |

→ See [ADR Guide](adr-guide.md) for the full ADR workflow.

---

## `related <id>`

Show bidirectional ADR ↔ domain links. Given an ADR ID, lists domain items that reference it. Given a domain item ID, lists ADRs that reference it.

```bash
dkk related adr-0001
dkk related ordering.OrderPlaced
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output |
| `-r, --root <path>` | repo root | Override repository root |

---

## `new`

Scaffold new domain structures. Automates creating standard directory layouts and boilerplate files.
There are three sub-commands under `new`.

```bash
# Set up a complete .dkk/ structure in your repository:
dkk new domain

# Add a bounded context (registers in index.yml and creates structure):
dkk new context <name>

# Scaffold a new Architecture Decision Record:
dkk new adr "<title>"
```

| Sub-Command | Description | Flags |
|-------------|-------------|-------|
| `domain` | Scaffold `.dkk/domain` structure, schemas, and a base `actors.yml` and `index.yml`. | `--json`, `--minify`, `-r, --root <path>`, `--force` |
| `context` | Scaffold a new bounded context with its metadata and subdirectories. | `--json`, `--minify`, `-d, --description <text>`, `-r, --root <path>` |
| `adr` | Generate a new Markdown file with frontmatter in `.dkk/adr/`. Auto-increments IDs. | `--json`, `--minify`, `--domain-refs <ids>`, `--deciders <names>`, `-s, --status <status>`, `-r, --root <path>` |

---

## `add <type> <name>`

Scaffold a domain item. Creates the specific YAML file with correct basic schema structure within a bounded context.

```bash
dkk add event OrderPlaced --context ordering
dkk add command PlaceOrder --context ordering
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --context <name>` | — | Target bounded context (kebab-case) (required). |
| `-d, --description <text>` | — | Brief description of the item. |
| `--raised-by <id>` | — | (Event) Aggregate that raises this event. |
| `--handled-by <id>` | — | (Command) Aggregate that handles this command. |
| `--actor <id>` | — | (Command) Actor that initiates this command. |
| `--triggers <ids>` | — | (Policy) Events that trigger this policy (comma-separated). |
| `--emits <ids>` | — | Commands emitted by policy / events emitted by aggregate (comma-separated). |
| `--handles <ids>` | — | (Aggregate) Commands handled by aggregate (comma-separated). |
| `--subscribes-to <ids>` | — | (Read-model) Events subscribed to (comma-separated). |
| `--used-by <ids>` | — | (Read-model) Actors that use this read_model (comma-separated). |
| `--from <id>` | — | Clone structure and description from an existing item. |
| `--json` | — | Output created item path and ID as JSON. |
| `--minify` | — | Minify JSON output. |
| `-r, --root <path>` | repo root | Override repository root |

See below for the list of available Types.

---

## Item Types

The `--type` flag on `list` and `search` accepts these values:

| Type | Description |
|------|-------------|
| `event` | Domain events |
| `command` | Commands |
| `policy` | Reactive policies |
| `aggregate` | Aggregates |
| `read_model` | Read models |
| `glossary` | Glossary terms |
| `actor` | Actors |
| `adr` | Architecture Decision Records |
| `flow` | Cross-context flows |
| `context` | Bounded contexts |

---

## Global Flags

These flags work on most commands:

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON instead of human-readable format |
| `--minify` | Minify JSON output (remove whitespace/formatting) |
| `-r, --root <path>` | Override the repository root path |
| `--help` | Display help for a command |

---

## What's Next?

- **[Getting Started](getting-started.md)** — Step-by-step first project setup.
- **[Domain Modeling Guide](domain-modeling.md)** — Item types, naming conventions, cross-references.
- **[ADR Guide](adr-guide.md)** — Architecture Decision Records workflow.
- **[AI Agent Integration](ai-agent-integration.md)** — AI agent onboarding and domain-first retrieval.
