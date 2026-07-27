# Roadmap

Future directions and requirements for the Domain Knowledge Kit. Records **what and why**, not how. Implementations get an ADR in `.dkk/adr/`.

## Planned

## Completed

### In-Repo Feedback Capture (2026-07-27)

Added `dkk feedback` so friction with dkk *itself* can be recorded where it is felt — inside an agent session — instead of being lost before anyone files an issue. `dkk feedback add` writes a note to `.dkk/feedback.yml`; `dkk feedback export` prints a paste-ready Markdown report on stdout (framing on stderr, so `| pbcopy` and `gh issue create --body-file -` both work); `dkk feedback rm` is the redaction escape hatch. `/dkk-feedback` and `/dkk-feedback-export` (with Copilot prompt mirrors) let the agent draft the write-up from what it just observed, subject to user confirmation. DKK still makes no network calls: the log is a committed local file and a human decides what leaves the machine. Auto-captured context is counts-only — never a context, item, actor, ADR, or flow name. See [ADR-0005](.dkk/adr/adr-0005.md).

### First-Class GitHub Copilot Support (2026-07-04)

Promoted GitHub Copilot to a first-class agent target alongside Claude Code. `dkk init --copilot` (or `--all`) installs the full Copilot surface: a static domain-context section in `.github/copilot-instructions.md`, prompt files under `.github/prompts/` mirroring the Claude slash commands, a `dkk-domain-reviewer` custom agent, the complete portable skill set, and MCP registration in `.vscode/mcp.json` (plus the repo-root `.mcp.json`). `dkk update` maintains the Copilot surface for repos that opted in and leaves Claude-only repos untouched. See [ADR-0004](.dkk/adr/adr-0004.md).

### Multi-Repo Federation (2026-05-13)

Added cross-repository federation so one domain model can span many service repositories. A repo declares itself a service with `.dkk/service.yml` and lists peer services in `.dkk/federation.yml`. Peer `.dkk/` trees are merged read-only into the loaded model and the additive `<service>:<context>.<Item>` ref grammar is accepted everywhere a bare ref is. No CI, publish step, or orphan branch is required — a peer's raw `.dkk/` is the artifact. Two source types: filesystem path (read live) and git URL + branch (sparse-checkout into a gitignored cache, lockfile-pinned). The validator, indexer, graph, search, MCP server, and a new `dkk consumers` reverse-lookup all become federation-aware transparently. See [ADR-0003](.dkk/adr/adr-0003.md).

### AI-Assisted Flow Implementation (2026-03-27)

Added a new Copilot skill (`flow-implementer`) to provide framework-agnostic implementation guidance checklists based on domain knowledge. Decided to focus on logical structured checks rather than generating boilerplate code. Users can invoke it to fetch contexts and prompt ADR constraint checks.

### Flow-Anchored Story Generation (2026-03-27)

Added `dkk story <flow-id>` CLI command, Copilot skill for story generation/splitting, and `dkk init --skills`. See [ADR-0002](.dkk/adr/adr-0002.md).
