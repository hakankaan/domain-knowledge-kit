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

Full-text search across all domain items with relevance ranking. Uses FTS5 (SQLite). Requires a pre-built index — run `dkk render` first. **Federation-aware:** when peers are configured, results include items from every loaded peer (id prefixed `<service>:<context>.<Name>`, with a `service` field on each row).

```bash
dkk search "order"
dkk search "payment" --context billing --type event
dkk search "customer" --expand --limit 5
dkk search "order" --service ordering          # only peer "ordering"
dkk search "invoice" --service billing         # only local rows (when local svc is "billing")
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --context <name>` | — | Filter results to a bounded context |
| `-t, --type <type>` | — | Filter by item type |
| `--tag <tag>` | — | Filter by tag/keyword |
| `-s, --service <name>` | — | Filter to one service (local name or peer name; empty matches unfederated local rows) |
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
| `--federation <mode>` | `lenient` | Federation strictness: `lenient` (unreachable peers warn) or `strict` (errors). Use `strict` in CI gates. |
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

Create or update `AGENTS.md` with a DKK onboarding section, then print conditional next-step guidance based on the current repo state.

The DKK section is delimited by `<!-- dkk:start -->` / `<!-- dkk:end -->` HTML comment markers, making the operation idempotent — re-running replaces the section in place. `dkk init` does **not** scaffold `.dkk/domain/`; the domain is the project's business and is created deliberately with [`dkk new domain`](#new).

After writing AGENTS.md, init prints a "Next steps" block tuned to whichever state it detects:

| Detected state | Guidance |
|---|---|
| `.dkk/domain/` missing or empty | "Scaffold the domain: `dkk new domain` …" |
| Only the `sample` context exists | "Replace the `sample` scaffold with real bounded contexts (`dkk new context <name>` …)" |
| Real model present | "You're set. Common daily commands: `dkk search`, `dkk add`, `dkk render`, `dkk prime`" |
| `.dkk/domain/` exists but loader throws | "Run `dkk validate` to see what's wrong." |

```bash
dkk init                  # AGENTS.md + next-step guidance
dkk init --claude         # also install Claude Code config under .claude/
dkk init --skills         # also install agent skills into .github/skills/
```

| Flag | Default | Description |
|------|---------|-------------|
| `--claude` | — | Also install Claude Code config under `.claude/` (settings, hooks, skills, agents, commands). |
| `--skills` | — | Also install DKK skill files into `.github/skills/`. |
| `--force` | — | Overwrite existing files under `.claude/` or `.github/skills/`. |
| `-r, --root <path>` | repo root | Override repository root. |

→ See [AI Agent Integration](ai-agent-integration.md) for the full agent onboarding workflow.

---

## `update`

Upgrade `dkk` to the latest npm release **and** refresh every DKK-managed AI assistant artifact in this project — `.claude/skills/dkk-*`, `.claude/agents/dkk-*.md`, `.claude/commands/dkk-*.md`, `.claude/hooks/*`, `.github/skills/dkk-*`, the DKK section of `AGENTS.md`, and the DKK MCP server registration.

```bash
dkk update                  # default: upgrade + apply
dkk update --check          # dry-run; print the diff without writing
dkk update --yes            # skip the interactive confirm prompt
dkk update --skip-npm       # only refresh artifacts, no npm upgrade
```

Pipeline:

1. **Pre-flight** — verify `.dkk/` exists; detect global vs. local install (`npx` is refused).
2. **npm upgrade** — `npm install -g domain-knowledge-kit@latest` (or `--save-dev` for local installs). Skipped on `--skip-npm` or when already on the latest version.
3. **Re-exec** — after upgrade, re-launch the freshly-installed binary so subsequent steps read the **new** bundled templates.
4. **Artifact diff** — compute add / replace / remove against the bundled template, print, and confirm. Includes legacy paths that previous releases installed (e.g., the retired `dkk-domain-knowledge` skill).
5. **Settings prune + merge** — remove DKK-owned entries from `.claude/settings.json` (anything matching the template's allow list and DKK hook basenames), then run the additive merge to add the new template entries. User-authored entries are preserved; mixed hook entries (DKK + user commands in one entry) are left intact with a warning.
6. **MCP register** — if no `dkk` MCP server is already registered (project `.mcp.json` or `claude mcp list`), run `claude mcp add dkk -- dkk mcp`. Falls back to writing `.mcp.json` if the `claude` CLI is unavailable.
7. **AGENTS.md refresh** — replaces the DKK section in place.

| Flag | Default | Description |
|------|---------|-------------|
| `-y, --yes` | — | Skip interactive confirmation for the artifact diff. |
| `--check` | — | Dry-run: print the diff and plan, make no changes. |
| `--skip-npm` | — | Don't run npm upgrade (use the already-installed version). |
| `--skip-artifacts` | — | Don't sweep/reinstall `.claude/` and `.github/skills/` files. |
| `--skip-mcp` | — | Don't auto-register the DKK MCP server. |
| `-r, --root <path>` | repo root | Override repository root. |

→ See [AI Agent Integration](ai-agent-integration.md) for the artifacts that `update` refreshes.

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
# One-time per project: scaffold the .dkk/domain/ tree with a sample bounded context.
dkk new domain

# Add a bounded context (registers in index.yml and creates structure):
dkk new context <name>

# Scaffold a new Architecture Decision Record:
dkk new adr "<title>"
```

> Run [`dkk init`](#init) first — it writes `AGENTS.md` and then tells you to run `dkk new domain` next. The two commands intentionally do different jobs: `init` configures AI-agent integration, `new domain` materializes the domain skeleton.

| Sub-Command | Description | Flags |
|-------------|-------------|-------|
| `domain` | Scaffold `.dkk/domain/` with `index.yml`, `actors.yml`, and a sample bounded context. Errors if `.dkk/domain/` already exists unless `--force` is passed (which deletes the existing directory entirely). | `--json`, `--minify`, `-r, --root <path>`, `--force` |
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

## Federation

DKK supports multi-repo federation: a repo declares itself a service with `.dkk/service.yml` and lists peer services in `.dkk/federation.yml`. Peer `.dkk/` trees are merged read-only into the loaded model, and cross-service references use the `<service>:<context>.<Item>` grammar.

### `service init`

Declare this repo as a federated service. Writes `.dkk/service.yml`.

```bash
dkk service init --name billing --export billing
dkk service init --name ordering --export ordering --export returns
dkk service init --name billing --export billing --force   # overwrite
```

| Flag | Default | Description |
|------|---------|-------------|
| `--name <name>` | — | Kebab-case service name (required) |
| `--export <ctx...>` | — | Bounded-context name(s) this service publishes. Repeatable, or comma-separate. |
| `--description <text>` | — | Optional human-readable description |
| `--force` | — | Overwrite an existing `service.yml` |
| `--json` / `--minify` | — | JSON output |
| `-r, --root <path>` | repo root | Override repository root |

### `peers add <name>`

Append a peer service to `.dkk/federation.yml`. Pick either `--local` (filesystem path) or `--git` (URL + branch).

```bash
# Local-path peer (no fetch needed — read live from disk)
dkk peers add ordering --local ../order-svc

# Git peer (fetch with dkk pull)
dkk peers add ordering --git git@github.com:acme/order-svc.git --branch main
dkk peers add ordering --git ... --branch feature/v2 --git-path services/ordering
```

| Flag | Default | Description |
|------|---------|-------------|
| `--local <path>` | — | Filesystem path to the peer's repo root (absolute or repo-root-relative) |
| `--git <url>` | — | Git URL (https or ssh) |
| `--branch <branch>` | `main` | Branch to track for git sources |
| `--git-path <subpath>` | — | Sub-path inside the peer repo where `.dkk/` lives (monorepo support) |
| `--force` | — | Replace an existing entry for this peer |
| `--json` / `--minify` | — | JSON output |
| `-r, --root <path>` | repo root | Override repository root |

The env-var `DKK_PEER_<NAME>=<path>` (uppercase, hyphens → underscores) overrides a peer's resolved path. Useful for per-developer redirection to local checkouts without editing the committed manifest.

### `peers list`

List configured peers and reachability. Reads `federation.yml` but doesn't load peer models.

```bash
dkk peers list
dkk peers list --json
```

### `peers status`

Detailed peer status: source, env override, reachability, loaded service identity, exports, contexts, and any peer-load warnings.

```bash
dkk peers status
dkk peers status --json
```

### `pull [name]`

Sparse-checkout git-source peers into `.dkk/imports/`. Local-source peers are no-ops (always live from disk). On first pull, writes `.dkk/imports/.gitignore` so the cache stays off git regardless of the project's root `.gitignore`. Records resolved commit SHAs in `.dkk/federation.lock.json` (committed) so two developers see the same peer state.

```bash
dkk pull                   # all git peers
dkk pull ordering          # one peer
dkk pull --refresh         # re-fetch even when cached
dkk pull --offline         # use cache only; no network
```

| Flag | Default | Description |
|------|---------|-------------|
| `--refresh` | — | Re-fetch even if the cache exists and the SHA matches the lockfile |
| `--offline` | — | Use cache only; warn if cache missing |
| `--json` / `--minify` | — | JSON output |
| `-r, --root <path>` | repo root | Override repository root |

### `consumers <id>`

Reverse-lookup across federation: list every reference to a local item across loaded peers. Use to answer "who breaks if I rename this?" before deprecating an event.

```bash
dkk consumers ordering.OrderPlaced
dkk consumers actor.PaymentGateway --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` / `--minify` | — | JSON output |
| `-r, --root <path>` | repo root | Override repository root |

### Federated ID forms

| Form | Example | When to use |
|------|---------|-------------|
| Bare | `ordering.OrderPlaced` | Local-only; never falls through to peers |
| Service-prefixed item | `ordering:ordering.OrderPlaced` | Cross-service reference in any YAML field |
| Service-prefixed actor | `payments:actor.PaymentGateway` | Cross-service actor reference |
| Service-prefixed ADR | `ordering:adr-0007` | Cross-service ADR link |
| Show shorthand | `ordering:OrderPlaced` | `dkk show` only — resolves via peer's exports |

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
