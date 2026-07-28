# Roadmap

Future directions and requirements for the Domain Knowledge Kit. Records **what and why**, not how. Implementations get an ADR in `.dkk/adr/`.

## Planned

## Completed

### ADRs as First-Class Model Members (2026-07-28)

ADRs had creation and nothing else, while every other item type was guarded end to end. Five things followed from that. The ADR file was the only part of the pack with no load-time guard — an unquoted title (`"Use Redis: cache layer"`) produced invalid YAML that took down `validate`, `render`, `search` and `show` with an error naming no file, and an `id` disagreeing with its filename validated clean while silently breaking every command that resolves an ADR to a path. Reading a decision returned its body flattened into one YAML scalar, so an agent calling `dkk_show` could not tell *Context* from *Decision*. Bidirectional linking was documented as enforced and was not, and nothing wrote both halves. Nothing measured decision rot — orphan detection skipped ADR nodes entirely. And `render` produced no ADR page at all.

Now: frontmatter is machine-serialised and every parse failure is reported against its path instead of aborting the load; `id`↔filename and duplicate ids are validation errors. The body is kept verbatim and split into sections, so `dkk show <adr> --section decision` returns just what was decided, and search excerpts are centred on the match. A `dkk adr` group owns the lifecycle — `status` (with `rejected` added, and supersession recorded in both directions), `link`/`unlink` (both halves, always), `decisions`, and `audit`. `dkk_decisions` answers "what governs this item/file?" with provenance and supersession resolution in one call. `render` writes a decision log; the schema gains `tags`, `links`, `code_refs`, `review_by`, and an `x-` extension namespace; and `domain_refs` may target contexts, actors, and flows, each with a reciprocal `adr_refs`. See [ADR-0007](.dkk/adr/adr-0007.md).

### Artifact Provenance for Safe Upgrades (2026-07-27)

`dkk update` classified a file as "replace" whenever it differed from the bundled template, which conflated the previous release's own copy (safe to overwrite) with a file the user had deliberately edited (not safe) — and force-overwrote both. `dkk init`/`update` now record a sha256 per installed artifact in a committed `.dkk/artifacts.lock`. A file matching that record is overwritten silently; one that doesn't is reported as `! conflict`, kept as-is, and the new template is written beside it as `<path>.new` to merge. `--force` opts back into overwriting, `--diff` renders the unified diff so the confirmation prompt is an actual decision, and the settings-merge warnings moved ahead of that prompt. Case-only renames now go through `git mv` so they survive `core.ignorecase` on macOS/Windows instead of silently never reaching a Linux checkout. The two validating hooks stopped returning exit 2 for their own crashes: blocking on a tooling failure the agent cannot repair wedged the session. See [ADR-0006](.dkk/adr/adr-0006.md).

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
