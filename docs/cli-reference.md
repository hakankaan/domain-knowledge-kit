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
dkk list --type adr --status proposed
```

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --context <name>` | — | Filter by bounded context |
| `-t, --type <type>` | — | Filter by item type (see [Item Types](#item-types)) |
| `--status <status>` | — | Filter by lifecycle status (ADRs: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded`) |
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

Display the full definition of a single domain item.

For an ADR the output is its frontmatter as YAML plus the **Markdown body kept intact** — headings, lists and tables survive, so *Context*, *Decision* and *Consequences* stay distinguishable. `--section` narrows it to one level-2 section; the full output lists the available names.

```bash
dkk show ordering.OrderPlaced
dkk show actor.Customer
dkk show adr-0001 --json
dkk show adr-0001 --section decision
dkk show adr-0001 --section alt        # prefix match → "Alternatives Considered"
```

| Flag | Default | Description |
|------|---------|-------------|
| `--section <name>` | — | ADRs only: show one section of the body by its heading (prefix matching) |
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
dkk search "storage" --type adr --status accepted   # decisions currently in effect
```

Result excerpts are centred on the first place a query term appears, not on the head of the document.

| Flag | Default | Description |
|------|---------|-------------|
| `-c, --context <name>` | — | Filter results to a bounded context |
| `-t, --type <type>` | — | Filter by item type |
| `--tag <tag>` | — | Filter by tag/keyword |
| `--status <status>` | — | Filter by lifecycle status (ADRs) |
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

Print domain model statistics and summarize model health by identifying orphaned items (items with no connections) and ADRs linked to no domain item.

ADRs are excluded from the graph-based orphan walk on purpose — an ADR's edges are links, not structure — so decision health is computed separately. `dkk adr audit` is the full report.

```bash
dkk stats
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Output as JSON |
| `--minify` | — | Minify JSON output (AI-optimized) |
| `-r, --root <path>` | repo root | Override repository root |

---

## `drift`

Git-aware model/code freshness checks driven by `code_refs` bindings (repo-relative globs on `context.yml` linking a context to the source paths it models). `dkk validate` measures only the pack's *internal* consistency; `drift` answers whether the pack still matches the code.

```bash
dkk drift                        # report (exit 0 — advisory)
dkk drift --strict               # exit 1 on findings (CI gate)
dkk drift --threshold 10         # commits touching bound code before "stale"
dkk drift ack ordering           # record "reviewed, still accurate" at HEAD
dkk drift map apps/api/src/x.ts  # which context binds this file?
```

Findings reported:
- **Stale contexts** — ≥ threshold commits touched a context's bound paths since its model directory last changed (or since its last `ack`).
- **Dead bindings** — a `code_refs` glob matches no files (bound code deleted or moved).
- **Uncovered source dirs** — top-level source units (`apps/*`, `packages/*`, `libs/*`, `services/*`, `src` by default; override with `source_roots` in `.dkk/drift.yml`) that no context's bindings reach.
- **Unbound contexts** — contexts without `code_refs`, i.e. invisible to drift.

`dkk drift ack <context…>` records the current HEAD SHA in `.dkk/drift.yml` so "I reviewed it, the model is still accurate" doesn't require a meaningless YAML touch. Commit `.dkk/drift.yml` with your change.

Without git, staleness checks are skipped (dead bindings + coverage still run).

| Flag (on `drift`) | Default | Description |
|------|---------|-------------|
| `--threshold <n>` | `5` | Commits touching bound code before a context counts as stale |
| `--strict` | — | Exit non-zero when drift is found (CI gate) |
| `--json` / `--minify` | — | JSON output |
| `-r, --root <path>` | repo root | Override repository root |

---

## `validate`

Run schema validation (JSON Schema) and cross-reference checks on the entire domain model.

```bash
dkk validate
dkk validate ordering.OrderPlaced
dkk validate --file .dkk/domain/contexts/ordering/events/OrderPlaced.yml
dkk validate --json --minify
```

Checks performed:
- **Schema conformance** — Each YAML file is validated against its JSON Schema in `tools/dkk/schema/`.
- **Cross-references** — All item-to-item, item-to-ADR, and ADR-to-item references resolve correctly. ADR `domain_refs` may target items, contexts, actors, or flows.
- **ADR file identity** — Every ADR's `id` matches its filename, and no two ADRs claim the same id. A file that fails to parse is reported against its path instead of aborting the load.
- **ADR link reciprocity** *(warning)* — A `domain_refs` entry with no matching `adr_refs` (or vice versa) is reported with the `dkk adr link` command that fixes it.
- **Context registration** — Every context directory in `.dkk/domain/contexts/` is registered in `.dkk/domain/index.yml`.
- **ADR supersession consistency** — `superseded_by` and `status: superseded` must appear together (warns when they disagree).
- **`code_refs` liveness** — a context binding glob that matches no files warns.

`--file <path>` validates **one** file against its schema only — no cross-reference checks — so it never false-fails on refs to files not yet written. This is the per-edit gate used by the shipped PostToolUse hook; run the full `dkk validate` (or `dkk render`) once a multi-file change is complete.

| Flag | Default | Description |
|------|---------|-------------|
| `--file <path>` | — | Schema-only validation of a single file (skips cross-refs; not combinable with an id filter) |
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

Create or update `AGENTS.md` with a DKK onboarding section, register the MCP server via a committed `.mcp.json`, then print conditional next-step guidance based on the current repo state.

The DKK section is delimited by `<!-- dkk:start -->` / `<!-- dkk:end -->` HTML comment markers, making the operation idempotent — re-running replaces the section in place. `dkk init` does **not** scaffold `.dkk/domain/`; the domain is the project's business and is created deliberately with [`dkk new domain`](#new).

By default init also writes a project-scoped `.mcp.json` registering the `dkk` MCP server (skip with `--no-mcp`). Because it's committed, every clone of the repo gets the server automatically — you don't run `dkk mcp` yourself; Claude Code spawns it on session start. Existing `.mcp.json` entries are preserved, and an existing `dkk` entry is left untouched. See [AI Agent Integration → MCP server](ai-agent-integration.md#mcp-server).

After writing AGENTS.md, init prints a "Next steps" block tuned to whichever state it detects:

| Detected state | Guidance |
|---|---|
| `.dkk/domain/` missing or empty | "Scaffold the domain: `dkk new domain` …" |
| Only the `sample` context exists | "Replace the `sample` scaffold with real bounded contexts (`dkk new context <name>` …)" |
| Real model present | "You're set. Common daily commands: `dkk search`, `dkk add`, `dkk render`, `dkk prime`" |
| `.dkk/domain/` exists but loader throws | "Run `dkk validate` to see what's wrong." |

```bash
dkk init                  # AGENTS.md + .mcp.json + next-step guidance
dkk init --claude         # also install Claude Code config under .claude/
dkk init --copilot        # also install GitHub Copilot config under .github/ + .vscode/mcp.json
dkk init --all            # install both Claude Code and Copilot config
dkk init --skills         # also install agent skills into .github/skills/
dkk init --no-mcp         # skip writing .mcp.json / .vscode/mcp.json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--claude` | — | Also install Claude Code config under `.claude/` (settings, hooks, skills, agents, commands). |
| `--copilot` | — | Also install GitHub Copilot config under `.github/` (prompts, agent, skills, `copilot-instructions.md`) plus `.vscode/mcp.json`. |
| `--all` | — | Install both Claude Code and GitHub Copilot config (implies `--skills` and MCP registration). |
| `--skills` | — | Also install DKK skill files into `.github/skills/`. |
| `--no-mcp` | MCP on | Don't write the `.mcp.json` / `.vscode/mcp.json` MCP server registration. |
| `--force` | — | Overwrite existing files under `.claude/`, `.github/`, or `.github/skills/`. |
| `-r, --root <path>` | repo root | Override repository root. |

→ See [AI Agent Integration](ai-agent-integration.md) for the full agent onboarding workflow.

---

## `update`

Upgrade `dkk` to the latest npm release **and** refresh the DKK-managed AI assistant artifacts in this project. `AGENTS.md` and the repo-root `.mcp.json` are always refreshed (the universal base every `dkk init` writes). Every other surface is **adoption-gated** — refreshed only if already installed, so `update` never pushes a toolchain you didn't opt into:

- **Claude** (`.claude/skills/dkk-*`, `.claude/agents/dkk-*.md`, `.claude/commands/dkk-*.md`, `.claude/hooks/*`, `.claude/settings.json`) — when a DKK `.claude/` artifact is present.
- **Portable skills** (`.github/skills/dkk-*`) — when present.
- **Copilot** (`.github/prompts/dkk-*.prompt.md`, `.github/agents/dkk-*.agent.md`, `.github/copilot-instructions.md`, `.vscode/mcp.json`) — when the repo opted in via `dkk init --copilot`.

So a Claude-only repo keeps no Copilot files, a Copilot-only repo keeps no `.claude/` tree, and a bare `dkk init` repo gets only the base refresh.

```bash
dkk update                  # default: upgrade + apply
dkk update --check          # dry-run; print the diff without writing
dkk update --diff           # show the unified diff for every changed file
dkk update --yes            # skip the interactive confirm prompt
dkk update --force          # overwrite locally-edited artifacts too
dkk update --skip-npm       # only refresh artifacts, no npm upgrade
```

### Local edits are never silently overwritten

`dkk update` records a sha256 of every artifact it writes in **`.dkk/artifacts.lock`** — commit it. That record is what separates two situations a content comparison alone conflates:

| On disk | Classified as | What happens |
|---------|---------------|--------------|
| Matches the lock (i.e. it is the previous release's file) | `~ replace` | Overwritten silently — this is what an upgrade is for. |
| Differs from the lock (i.e. somebody edited it) | `! conflict` | **Your file is kept.** The new template is written beside it as `<path>.new` to merge by hand. |

A conflict keeps reporting until you resolve it; once the local file matches the template again, the stale `.new` copy is removed automatically. Revert an edit and the file goes back to being a clean overwrite.

Repos installed by a `dkk` older than 0.8.0 have no lock, so an edit cannot be told from a stale copy. Those runs fall back to `~ replace` for everything and say so — use `--diff` to check before answering. The run writes a lock, so subsequent upgrades get the full protection.

Pipeline:

1. **Pre-flight** — verify `.dkk/` exists; detect global vs. local install (`npx` is refused).
2. **npm upgrade** — `npm install -g domain-knowledge-kit@latest` (or `--save-dev` for local installs). Skipped on `--skip-npm` or when already on the latest version.
3. **Re-exec** — after upgrade, re-launch the freshly-installed binary so subsequent steps read the **new** bundled templates.
4. **Artifact diff** — compute add / replace / conflict / remove / rename against the bundled template, print, and confirm. Everything decision-relevant is printed *before* the prompt, including the settings-merge warnings from step 5. Only surfaces the repo already adopted (Claude, portable skills, Copilot) are included, so nothing is proposed for a toolchain you didn't opt into. Includes legacy paths that previous releases installed (e.g., the retired `dkk-domain-knowledge` skill).
5. **Case renames** — an artifact spelled differently only in case (e.g. a pre-0.7.0 `skill.md` where the spec requires `SKILL.md`) is renamed through `git mv` when tracked. On macOS and Windows `core.ignorecase` makes a plain rename invisible to git, so the fix would never reach a Linux checkout or CI and would re-fire on every update. When the rename can't be recorded, `update` says so and prints the `git mv` to run by hand.
6. **Settings prune + merge** — for Claude-adopted repos: remove DKK-owned entries from `.claude/settings.json` (anything matching the template's allow list and DKK hook basenames), then run the additive merge to add the new template entries. User-authored entries are preserved; mixed hook entries (DKK + user commands in one entry) are left intact with a warning — surfaced before the confirmation prompt, since it's the kind of thing you'd want to know before answering.
7. **MCP register** — if the project's `.mcp.json` doesn't already declare a `dkk` server, write a committed entry into it (preserving any other servers). A committed `.mcp.json` is shared with the whole team, so the server is registered once for everyone rather than per-machine. Global installs get `command: dkk`; local devDependency installs get `npx dkk mcp`. Copilot-adopted repos also get `.vscode/mcp.json`.
8. **AGENTS.md + Copilot refresh** — replaces the DKK section in `AGENTS.md` in place, and (for Copilot-adopted repos) the DKK section in `.github/copilot-instructions.md`.
9. **Lock** — rewrite `.dkk/artifacts.lock` with a hash of every artifact that now matches the template. Runs even when the diff was empty, so a pre-0.8.0 repo with no drift still acquires a lock.

| Flag | Default | Description |
|------|---------|-------------|
| `-y, --yes` | — | Skip interactive confirmation for the artifact diff. |
| `--check` | — | Dry-run: print the diff and plan, make no changes. Skips the npm upgrade and re-exec entirely, so it works under `npx`. Always exits 0 — for a CI gate use [`artifacts check`](#artifacts-check). |
| `--diff` | — | Print the unified diff for every file about to be replaced or flagged as a conflict, before the prompt. |
| `--force` | — | Overwrite locally-edited artifacts instead of preserving them. **Destroys local changes** — the diff labels those lines `OVERWRITE`. |
| `--skip-npm` | — | Don't run npm upgrade (use the already-installed version). |
| `--skip-artifacts` | — | Don't sweep/reinstall `.claude/` and `.github/skills/` files. |
| `--skip-mcp` | — | Don't auto-register the DKK MCP server. |
| `-r, --root <path>` | repo root | Override repository root. |

→ See [AI Agent Integration](ai-agent-integration.md) for the artifacts that `update` refreshes.

---

## `artifacts check`

Read-only drift gate: exit non-zero when the DKK-managed artifacts installed in this repo no longer match the bundled template. Built for CI.

```bash
dkk artifacts check          # human-readable diff
dkk artifacts check --diff   # with the unified diff for each changed file
dkk artifacts check --json   # machine-readable
```

Reports the same five classes as `update`: missing, outdated, **conflict** (edited locally), stale, and **miscased**. The last one is worth running on Linux CI specifically — a case-only rename that never landed in git is invisible to `git status` on macOS and Windows but shows up here.

Unlike `update --check`, this command **never installs anything** — no npm upgrade, no re-exec, no install-mode requirement — so it is safe under `npx` and safe to run on every pull request.

| Exit code | Meaning |
|-----------|---------|
| `0` | Artifacts match the bundled template. |
| `1` | Drift detected (missing, outdated, or stale files). |
| `2` | The check itself failed (e.g. unreadable repo). |

Same adoption gating as `update`: only surfaces the repo already opted into are compared, so a Claude-only repo is never told it's missing Copilot files.

```yaml
# .github/workflows/dkk.yml
- run: npx dkk artifacts check
```

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | — | Emit the diff as JSON (`{drifted, toAdd, toReplace, toConflict, toRemove, caseRenames, lockMissing}`). |
| `--diff` | — | Also print the unified diff for each outdated or conflicted file. |
| `-r, --root <path>` | repo root | Override repository root. |

---

## `prime`

Output the **lean** DKK agent context to stdout, followed by a live "Current Domain Summary". Designed for AI agent consumption: the behavioural rules, the MCP-first retrieval pointer, the mutation-only CLI commands, ID/naming conventions, and a compact model layout — about a quarter the size of the old dump (~5 KB vs ~20 KB), so the SessionStart hook injects far less per session.

Deep reference (full YAML structure, the update/review/federation workflows, the full CLI reference) is fetched on demand via the `dkk_guide` MCP tool — or printed in full with `--full`.

```bash
dkk prime                 # lean contract + current domain summary
dkk prime --full          # complete reference (everything the old prime printed)
dkk prime --static-only   # skip the dynamic domain summary
```

| Flag | Default | Description |
|------|---------|-------------|
| `--full` | lean | Print the full reference (YAML structure, workflows, full CLI reference). |
| `--static-only` | — | Output only the static instructions; skip the current domain summary. |
| `-r, --root <path>` | repo root | Override repository root. |

→ See [AI Agent Integration](ai-agent-integration.md) for details.

---

## `feedback`

Record friction with **dkk itself** — bugs, confusing errors, missing capabilities — and export it for the maintainers. This is not about your domain model; domain observations belong in the model or an ADR.

Notes land in `.dkk/feedback.yml`. **Nothing is transmitted.** `dkk feedback export` prints a report to stdout and you decide where it goes; dkk makes no network calls.

```bash
dkk feedback add "dkk rename leaves ADR domain_refs stale" --kind bug \
  --detail "Renamed the item; validate then failed on adr-0003." \
  --command "dkk rename ordering.OrderPlaced ordering.OrderConfirmed"

dkk feedback                     # list what's recorded (default subcommand)
dkk feedback --unshared          # only what hasn't been reported yet
dkk feedback export              # paste-ready Markdown report on stdout
dkk feedback export --mark-shared | gh issue create \
  --repo hakankaan/domain-knowledge-kit --title "DKK feedback" --body-file -
dkk feedback rm fb-0002          # drop an entry you'd rather not share
```

`export` puts **only** the Markdown on stdout — every hint goes to stderr — so `| pbcopy`, `> report.md`, and `--body-file -` all receive a clean artifact. It is read-only unless you pass `--mark-shared`, so piping it can't quietly mutate the file.

Each entry auto-captures the dkk version, Node version, platform, best-effort agent, and **pack size as counts only**. Context, item, actor, ADR, and flow *names* are never recorded — that data is your business domain and the report is destined for a public tracker. See [ADR-0005](../.dkk/adr/adr-0005.md).

Commit `.dkk/feedback.yml` with your change so the whole team accumulates one log. Two people appending at once produce one merge conflict; keep both entries — ids are display-only and the next `add` renumbers past the highest survivor. Teams that hit this often can add `.dkk/feedback.yml merge=union` to `.gitattributes`.

The file is safe to hand-edit. Unparseable YAML is an error rather than a silent empty log, and a partially-malformed file will list what survives but refuse to be written over — it holds the only copy of something you wrote.

| Subcommand | Purpose |
|------------|---------|
| `add <summary>` | Record a note (`--kind`, `--detail`, `--command`) |
| `list` *(default)* | List recorded feedback (`--kind`, `--unshared`) |
| `export` | Markdown report on stdout (`--all`, `--kind`, `--mark-shared`) |
| `rm <ids...>` | Remove entries — the redaction escape hatch |

| Flag (on `add`) | Default | Description |
|------|---------|-------------|
| `-k, --kind <kind>` | `friction` | `bug`, `friction`, `idea`, or `docs` |
| `-d, --detail <text>` | — | What you ran, expected, and got — paste the real error output |
| `--command <cmd>` | — | The `dkk` invocation that provoked it |
| `--json` / `--minify` | — | JSON output |
| `-r, --root <path>` | repo root | Override repository root |

---

## `adr`

Architecture Decision Record lifecycle — everything after the file exists. Scaffolding is [`dkk new adr`](#new); reading one is [`dkk show`](#show-id).

```bash
dkk adr decisions ordering.Order                     # what governs this?
dkk adr link adr-0007 ordering.Order actor.Customer  # link both halves
dkk adr status adr-0007 accepted                     # move it through its lifecycle
dkk adr audit                                        # find decision rot
```

### `adr decisions [id]`

Which decisions govern a domain item, context, actor, flow, or source file. Returns each ADR with its **provenance** (how it reaches the subject) and which ids are actually **in effect** — supersession chains are followed, so a replaced decision is never reported as binding.

```bash
dkk adr decisions ordering.Order
dkk adr decisions context.ordering
dkk adr decisions --file src/storage/writer.ts
```

| Flag | Default | Description |
|------|---------|-------------|
| `-f, --file <path>` | — | Ask about a source file instead of a domain id |
| `--no-include-context` | — | Exclude decisions that govern the whole owning context |
| `--json` / `--minify` | — | JSON output |
| `-r, --root <path>` | repo root | Override repository root |

### `adr link <adr-id> <item-ids...>` / `adr unlink`

Write (or remove) **both** halves of an ADR ↔ domain link: `domain_refs` on the ADR and `adr_refs` on each target. Targets may be domain items, glossary terms, actors (`actor.Name`), flows (`flow.Name`), or contexts (`context.name`).

Editing one side only produces a link that resolves but is invisible on the item side and in the rendered docs — `dkk validate` warns about it.

```bash
dkk adr link adr-0007 ordering.Order ordering.OrderPlaced context.ordering
dkk adr unlink adr-0007 ordering.OrderPlaced
```

Targets that can't be written (typos, cross-service refs) are reported and their refs are left off the ADR too, so a typo never becomes a dangling `domain_ref`.

### `adr status <id> <status>`

Move a decision through its lifecycle: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded`. Updates the frontmatter and any legacy `**Status:**` line in the body, and warns on unusual transitions.

```bash
dkk adr status adr-0007 accepted
dkk adr status adr-0002 superseded --superseded-by adr-0009
```

`superseded` requires `--superseded-by` so the chain stays machine-readable — to retire a decision with no replacement, use `deprecated`. The command writes `superseded_by` on the old ADR and `supersedes` on the new one.

| Flag | Default | Description |
|------|---------|-------------|
| `--superseded-by <adr-id>` | — | Required for `superseded`: the ADR that replaces this one |
| `--json` / `--minify` | — | JSON output |
| `-r, --root <path>` | repo root | Override repository root |

### `adr audit`

Report decision rot — the question `dkk validate` can't answer. Flags unlinked decisions, proposals nobody ever resolved, overdue `review_by` dates, one-way links, and broken supersession chains.

```bash
dkk adr audit
dkk adr audit --strict --stale-days 30
```

| Flag | Default | Description |
|------|---------|-------------|
| `--stale-days <n>` | `90` | Age past which a `proposed` ADR is reported |
| `--strict` | — | Exit 1 when anything is found (CI gate) |
| `--json` / `--minify` | — | JSON output |
| `-r, --root <path>` | repo root | Override repository root |

→ See [ADR Guide](adr-guide.md) for the full ADR workflow.

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
| `adr` | Generate a new Markdown file with frontmatter in `.dkk/adr/`. Numbering accounts for both existing filenames and the `id` each declares. `--domain-refs` also writes the reciprocal `adr_refs` on every target (opt out with `--no-backlink`). `--supersedes adr-NNNN[,…]` records `supersedes` here and flips each old ADR to `status: superseded` with `superseded_by` pointing back. The body comes from the `adr` template — put your own `adr.md.hbs` in `.dkk/templates/` to override it. | `--json`, `--minify`, `--domain-refs <ids>`, `--deciders <names>`, `--tags <tags>`, `--links <urls>`, `--supersedes <ids>`, `--no-backlink`, `-s, --status <status>`, `-r, --root <path>` |

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
