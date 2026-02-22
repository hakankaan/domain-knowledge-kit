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
| `-r, --root <path>` | repo root | Override repository root |

---

## `validate`

Run schema validation (JSON Schema) and cross-reference checks on the entire domain model.

```bash
dkk validate
dkk validate --warn-missing-fields
dkk validate --json
```

Checks performed:
- **Schema conformance** — Each YAML file is validated against its JSON Schema in `tools/dkk/schema/`.
- **Cross-references** — All item-to-item, item-to-ADR, and ADR-to-item references resolve correctly.
- **Context registration** — Every context directory in `.dkk/domain/contexts/` is registered in `.dkk/domain/index.yml`.

| Flag | Default | Description |
|------|---------|-------------|
| `--warn-missing-fields` | — | Warn about events/commands with no `fields` defined |
| `--json` | — | Output as JSON |
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

## `adr show <id>`

Display the YAML frontmatter of an Architecture Decision Record.

```bash
dkk adr show adr-0001
dkk adr show adr-0001 --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Output as JSON |
| `-r, --root <path>` | repo root | Override repository root |

→ See [ADR Guide](adr-guide.md) for the full ADR workflow.

---

## `adr related <id>`

Show bidirectional ADR ↔ domain links. Given an ADR ID, lists domain items that reference it. Given a domain item ID, lists ADRs that reference it.

```bash
dkk adr related adr-0001
dkk adr related ordering.OrderPlaced
```

| Flag | Default | Description |
|------|---------|-------------|
| `-r, --root <path>` | repo root | Override repository root |

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
| `-r, --root <path>` | Override the repository root path |
| `--help` | Display help for a command |

---

## What's Next?

- **[Getting Started](getting-started.md)** — Step-by-step first project setup.
- **[Domain Modeling Guide](domain-modeling.md)** — Item types, naming conventions, cross-references.
- **[ADR Guide](adr-guide.md)** — Architecture Decision Records workflow.
- **[AI Agent Integration](ai-agent-integration.md)** — AI agent onboarding and domain-first retrieval.
