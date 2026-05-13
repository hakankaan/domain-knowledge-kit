# Roadmap

Future directions and requirements for the Domain Knowledge Kit. Records **what and why**, not how. Implementations get an ADR in `.dkk/adr/`.

## Planned

## Completed

### Multi-Repo Federation (2026-05-13)

Added cross-repository federation so one domain model can span many service repositories. A repo declares itself a service with `.dkk/service.yml` and lists peer services in `.dkk/federation.yml`. Peer `.dkk/` trees are merged read-only into the loaded model and the additive `<service>:<context>.<Item>` ref grammar is accepted everywhere a bare ref is. No CI, publish step, or orphan branch is required — a peer's raw `.dkk/` is the artifact. Two source types: filesystem path (read live) and git URL + branch (sparse-checkout into a gitignored cache, lockfile-pinned). The validator, indexer, graph, search, MCP server, and a new `dkk consumers` reverse-lookup all become federation-aware transparently. See [ADR-0003](.dkk/adr/adr-0003.md).

### AI-Assisted Flow Implementation (2026-03-27)

Added a new Copilot skill (`flow-implementer`) to provide framework-agnostic implementation guidance checklists based on domain knowledge. Decided to focus on logical structured checks rather than generating boilerplate code. Users can invoke it to fetch contexts and prompt ADR constraint checks.

### Flow-Anchored Story Generation (2026-03-27)

Added `dkk story <flow-id>` CLI command, Copilot skill for story generation/splitting, and `dkk init --skills`. See [ADR-0002](.dkk/adr/adr-0002.md).
