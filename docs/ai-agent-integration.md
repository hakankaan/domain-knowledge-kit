# AI Agent Integration

← [Back to README](../README.md)

Domain Knowledge Kit is designed to work with AI coding agents — giving them structured, queryable access to your domain model so they can make domain-aware decisions when writing, reviewing, or refactoring code.

## Why AI + Domain Models?

AI agents work better when they understand your business domain, not just your code. DKK provides:

- **Structured context** — Agents can query events, commands, aggregates, and their relationships instead of parsing unstructured documentation.
- **Context Optimization** — The `summary` command and `--minify` flag provide the minimal token-efficient payload needed for high-frequency reasoning tasks.
- **Referential integrity** — The validated YAML model ensures agents get accurate, consistent information.
- **Searchable knowledge** — Full-text search lets agents find relevant domain items quickly.
- **Graph traversal** — Agents can explore how domain items connect, discovering blast radius and dependencies.
- **Decision history** — ADRs give agents the *why* behind design choices, not just the *what*.

## Quick Setup

Two commands get your project ready for AI agents:

```bash
# 1. Add a DKK section to AGENTS.md (idempotent). Init prints the next steps
#    to run based on whether you already have a domain model.
dkk init

# 2. Scaffold the .dkk/domain/ tree if you haven't already (one-time per project).
dkk new domain

# 3. Verify it works — output agent context to stdout
dkk prime
```

## `dkk init` — Agent Onboarding

`dkk init` creates or updates `AGENTS.md` with a DKK-specific section. The section is delimited by HTML comments (`<!-- dkk:start -->` / `<!-- dkk:end -->`), making the operation idempotent — re-running replaces only the DKK section without affecting other content.

After writing AGENTS.md, init prints a **Next steps** block tuned to the current state of your repo:

- **No `.dkk/domain/` yet** → tells you to run `dkk new domain`, then `dkk new context`, then `dkk add`.
- **Only the `sample` scaffold exists** → nudges you to replace `sample` with real bounded contexts.
- **Real domain model present** → shows the everyday workflow (`dkk search`, `dkk add`, `dkk render`, `dkk prime`).
- **Loader can't read `.dkk/domain/`** → suggests `dkk validate` to diagnose.

The injected AGENTS.md section tells AI agents:
- What DKK is and how to use it
- Available CLI commands for querying the domain
- Quality gates to run after domain changes

`dkk init` does **not** scaffold `.dkk/domain/`. The domain model is intrinsic to your business — it's created deliberately with `dkk new domain` (once per project), not templated by init.

## `dkk update` — Refresh the AI-assistant artifacts

When a newer release of `dkk` ships new skills, hooks, slash commands, or MCP wiring, `dkk update` is the canonical way to pull them in:

```bash
dkk update            # bump npm + refresh .claude/, .github/skills/, Copilot, MCP, AGENTS.md
dkk update --check    # preview the diff without applying
```

It runs the npm install for you (global or local install — `npx` is refused), re-execs onto the freshly-installed binary, then refreshes the DKK-managed artifacts. `AGENTS.md` and the repo-root `.mcp.json` are the **universal base** — every `dkk init` writes them, so `update` always refreshes them.

Everything else is **adoption-gated**: `update` refreshes a surface only if the repo already installed it, so it never pushes a toolchain you didn't opt into.

- **Claude** (`.claude/`) — when adopted: sweeps every `dkk-*` artifact in `.claude/{skills,agents,commands}/` plus the DKK-owned hook scripts and replaces them with the current template; stale paths from older releases are removed cleanly. `.claude/settings.json` is mutated additively: DKK-owned `permissions.allow` and `hooks.*` entries are pruned and re-added from the new template, while user-authored entries are preserved untouched.
- **Portable skills** (`.github/skills/dkk-*`) — refreshed when present.
- **Copilot** — when adopted: refreshes `.github/prompts/dkk-*.prompt.md`, `.github/agents/dkk-*.agent.md`, the `.github/copilot-instructions.md` DKK section, and `.vscode/mcp.json`.

So a Claude-only repo is never given Copilot files, a Copilot-only repo is never given a `.claude/` tree, and a bare `dkk init` repo gets only the `AGENTS.md` + `.mcp.json` refresh.

## `dkk prime` — Full Agent Context

`dkk prime` outputs a comprehensive context document to stdout. It's designed to be consumed by AI agents at the start of a conversation or session. The output covers:

- **Project overview** and core principles
- **Item types** — All 8 domain item types with their key fields
- **Domain model structure** — File paths and conventions
- **Search workflow** — Step-by-step domain search: parse → search → show → related → ADR links → compile results
- **Update workflow** — Making domain changes: inspect → use DKK CLI commands (e.g., `dkk add`, `dkk rename`, `dkk rm`) → maintain referential integrity → update ADRs → quality gates, plus a full YAML structure reference
- **Change review workflow** — Reviewing for domain impact: identify affected items → trace blast radius → check invariants → find linked ADRs → compile analysis
- **Validation checks** — Schema conformance, cross-references, context registration
- **ID conventions** and naming rules
- **Full CLI reference**
- **File conventions**

Agents that run `dkk prime` get everything they need to understand, query, modify, and review the domain model.

## Domain-First Retrieval

AI agents should query the domain model rather than guessing about business logic. For maximum efficiency, use the `--json --minify` flags.

### 1. Summary (Fast Overview)

Get a high-level overview of an item and its immediate neighbors without reading the full YAML content. This is the most token-efficient way to get context:

```bash
dkk summary ordering.OrderPlaced --json --minify
```

### 2. Search

Find relevant domain items by keyword:

```bash
dkk search "order"
dkk search "payment" --context billing --type event
```

### 2. Show

Inspect a specific item's full definition:

```bash
dkk show ordering.OrderPlaced
dkk show actor.Customer
```

### 3. Explore Relationships

Discover connected items via graph traversal:

```bash
dkk related ordering.Order --depth 2
```

This reveals which commands an aggregate handles, which events it emits, which policies react to those events, and which read models subscribe to them.

### 4. Check ADR Links

Find architecture decisions connected to a domain item:

```bash
dkk adr related ordering.OrderPlaced
```

### 5. List Items

Get an overview of what's defined:

```bash
dkk list --context ordering
dkk list --type event --json --minify
```

## AI-Optimized JSON Output

All retrieval and creation commands support the `--json` flag for machine readability and the `--minify` flag to strip whitespace and newlines, reducing the token count for AI context.

```bash
dkk show ordering.Order --json --minify
```

## Domain-Aware Changes

When AI agents modify domain YAML files, they should follow this workflow:

1. **Inspect current state** — Use `show` and `related` to understand what exists.
2. **Use DKK CLI commands** — Add, rename, or remove items using `dkk add`, `dkk rename`, and `dkk rm`. Do not manually edit the underlying YAML files directly.
3. **Maintain referential integrity** — Update cross-references (`handles`, `emits`, `raised_by`, `handled_by`, `actor`, `subscribes_to`, `used_by`).
4. **Update ADR links** — If the change affects an architectural decision, update `adr_refs` on domain items and `domain_refs` in ADR frontmatter.
5. **Run quality gates:**
   ```bash
   dkk render    # Validates → renders docs → rebuilds search index
   ```

## What Agents Can Do

With DKK integration, AI agents can:

- **Answer domain questions** — "What events does the Order aggregate emit?" → `dkk related ordering.Order`
- **Check impact** — "What would break if I rename OrderPlaced?" → `dkk related ordering.OrderPlaced --depth 2`
- **Find decisions** — "Why do we use event sourcing?" → `dkk search "event sourcing" --type adr`
- **Make changes** — Add new events/commands/policies with proper cross-references and ADR links
- **Review PRs** — Identify domain items affected by code changes and flag broken invariants

## Claude Code Integration

DKK ships with a native **Model Context Protocol (MCP) server** plus reference Claude Code hooks. Once configured, Claude Code can introspect the domain model directly through MCP tools — no Bash, no shell quoting, no CLI parsing — and a small set of hooks keeps the model valid as the agent edits.

### MCP server

`dkk init` registers the server for you by writing a committed, project-scoped `.mcp.json`:

```json
{ "mcpServers": { "dkk": { "command": "dkk", "args": ["mcp"] } } }
```

This is the recommended setup: because `.mcp.json` is committed, **every teammate who clones the repo gets the server automatically** — there is nothing to remember per-session and nothing to register per-machine. Claude Code spawns the server on session start (the first time it sees `.mcp.json`, it asks you to approve the `dkk` server once).

> **You never run `dkk mcp` by hand.** It is a long-lived stdio server that Claude Code launches and manages itself — running it in a terminal just hangs, waiting for a client on stdin. The one-time setup is *registration* (the `.mcp.json` entry), not *running*.

If a project pins `dkk` as a devDependency rather than a global install, `dkk init` writes `npx dkk mcp` so the command resolves to the version in `package.json` on every machine.

Prefer `claude mcp add` only when you deliberately want a private, uncommitted entry scoped to your machine (note the default scope is *local* — not shared with the team):

```bash
claude mcp add --scope project dkk -- dkk mcp   # writes the same committed .mcp.json
claude mcp add dkk -- dkk mcp                    # local scope: private to you, not committed
```

Either way, Claude Code exposes the following tools (all read-only except `dkk_validate`):

| Tool | Purpose |
|------|---------|
| `dkk_search` | FTS5 keyword search with context/type/tag filters |
| `dkk_show` | Full YAML/JSON for an item id |
| `dkk_summary` | Concise summary + direct neighbours (cheapest orientation tool) |
| `dkk_related` | BFS graph traversal — use depth ≥ 2 for blast radius |
| `dkk_list` | List all items, filterable by context/type |
| `dkk_story` | Aggregate a flow's full story context (markdown or JSON) |
| `dkk_locate` | Absolute file path(s) for an item |
| `dkk_stats` | Domain counts + orphaned-item detection |
| `dkk_prime` | Lean agent context + live domain summary (`verbose: true` for the full reference) |
| `dkk_guide` | On-demand deep reference by topic: `yaml`, `update`, `federation`, `review`, `cli` |
| `dkk_validate` | Schema + cross-reference validation |

The server reuses the same in-process modules the CLI uses, so the output is identical and there's no shell-escaping fragility.

`dkk_prime` is deliberately lean — it carries only the behavioural contract an agent can't discover through a tool call. When the agent needs the full YAML structure, the change workflow, or the federation guide, it calls `dkk_guide` with the relevant topic, so that reference material is paid for only when used rather than injected into every session.

### Hooks (one-shot install)

DKK ships a working `.claude/` template — `settings.json` plus four hook scripts — that you can scaffold into your repo with a single command:

```bash
dkk init --claude
```

Re-run with `--force` to overwrite local edits. The scaffolder creates:

- **`.claude/settings.json`** — pre-approved permissions for read-only `dkk` commands, plus the four hooks below wired in.
- **`.claude/hooks/session-start-prime.mjs`** (`SessionStart`) — pipes `dkk prime` into the conversation context so the agent is domain-aware from turn 1.
- **`.claude/hooks/pre-edit-block-generated.mjs`** (`PreToolUse` on `Edit|Write|MultiEdit|NotebookEdit`) — blocks writes to `.dkk/docs/` and `dist/` since those are regenerated outputs.
- **`.claude/hooks/post-edit-validate.mjs`** (`PostToolUse` on `Edit|Write|MultiEdit`) — when a file under `.dkk/domain/*.yml` changes, runs `dkk validate` so cross-reference breaks surface back into the agent loop immediately.
- **`.claude/hooks/stop-validate.mjs`** (`Stop`) — runs `dkk validate` as a quality gate before the agent finishes a turn; an invalid model returns exit 2 with the error report so the agent must fix it before declaring the work done.

Each hook script auto-detects whether it's running inside the DKK source repo (where it uses `npx tsx src/cli.ts`) or in a downstream consumer repo (where it uses the published `dkk` binary). They work unchanged in both contexts.

## GitHub Copilot Integration

GitHub Copilot is a first-class target alongside Claude Code. One command installs the full Copilot surface:

```bash
dkk init --copilot   # (or `dkk init --all` for Claude Code + Copilot together)
```

This scaffolds:

- **`.github/copilot-instructions.md`** — the DKK agent context, embedded in a marker-delimited section (`<!-- dkk:start -->` / `<!-- dkk:end -->`) so re-runs and hand edits both survive. Copilot has no session-start hook, so unlike Claude Code (whose hook runs `dkk prime` dynamically) DKK bakes the **static** contract into this file. For the *live* domain summary the agent runs `dkk prime` or calls the `dkk_prime` MCP tool. `dkk update` refreshes the section so it never drifts from the installed tool version.
- **`.github/prompts/dkk-*.prompt.md`** — eight reusable prompt files (`/dkk-prime`, `/dkk-impact`, `/dkk-review`, `/dkk-adr`, `/dkk-implement`, `/dkk-story`, `/dkk-feedback`, `/dkk-feedback-export`), the Copilot equivalents of the `.claude/commands/` slash commands.
- **`.github/agents/dkk-domain-reviewer.agent.md`** — a read-only custom agent that reviews a diff/PR for domain impact (blast radius, broken refs, ADR drift), mirroring the Claude subagent.
- **`.github/skills/dkk-*/skill.md`** — the portable, CLI-first Agent Skills (`dkk-adr-author`, `dkk-flow-implementer`, `dkk-story-analyst`).
- **`.vscode/mcp.json`** — registers the same `dkk` MCP server for VS Code Copilot:

  ```json
  { "servers": { "dkk": { "type": "stdio", "command": "dkk", "args": ["mcp"] } } }
  ```

  `dkk init --copilot` writes **both** `.vscode/mcp.json` and the repo-root `.mcp.json`, so the server is discoverable by VS Code Copilot and by Claude Code / other MCP clients. The server is client-agnostic — the exact same `dkk mcp` process and 14 `dkk_*` tools serve every client.

  > If your repo's `.gitignore` excludes `.vscode/`, add an exception so the registration is shared with the team: `!.vscode/mcp.json`. Otherwise each teammate has to run `dkk init --copilot` themselves.

Re-run with `--force` to overwrite local edits. Copilot has no hook mechanism, so the `SessionStart`/validate-gate behaviors from the Claude Code hooks have no direct Copilot equivalent — the static instructions file is the substitute for session-start priming.

## Reporting DKK Issues

When dkk itself misbehaves, the friction is felt mid-task inside an agent session — and by the time you'd file an issue, the details are gone. `dkk feedback` captures it where it happens:

```bash
/dkk-feedback              # Claude Code (or the dkk-feedback prompt in Copilot)
/dkk-feedback-export       # produce the paste-ready report
```

The agent drafts the entry from what it just observed — the failing invocation, the actual error output — shows you the draft, and records it only after you confirm. `dkk feedback export` then prints a Markdown report for https://github.com/hakankaan/domain-knowledge-kit/issues.

**Nothing is transmitted.** Entries live in `.dkk/feedback.yml` in your repo; export writes to stdout and you decide where it goes. The auto-captured context is dkk version, Node version, platform, agent, and pack size **as counts only** — never a context, item, actor, ADR, or flow name.

`dkk feedback` is a CLI command with no MCP tool, deliberately. Every mutation in DKK goes through the CLI and the MCP server stays read-only; the agent shells out, gated by the `Bash(dkk feedback:*)` permission that `dkk init --claude` installs. See [ADR-0005](../.dkk/adr/adr-0005.md) and the [CLI reference](cli-reference.md#feedback).

## What's Next?

- **[Getting Started](getting-started.md)** — Set up your first domain model.
- **[Domain Modeling Guide](domain-modeling.md)** — Item types, naming conventions, cross-references.
- **[Iterative Modeling](iterative-modeling.md)** — Decision patterns, modeling phases, external constraints.
- **[CLI Reference](cli-reference.md)** — Full command and flag reference.
- **[ADR Guide](adr-guide.md)** — Architecture Decision Records workflow.
