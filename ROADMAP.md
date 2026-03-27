# Roadmap

Future directions and requirements for the Domain Knowledge Kit. Records **what and why**, not how. Implementations get an ADR in `.dkk/adr/`.

## Planned

## Completed

### AI-Assisted Flow Implementation (2026-03-27)

Added a new Copilot skill (`flow-implementer`) to provide framework-agnostic implementation guidance checklists based on domain knowledge. Decided to focus on logical structured checks rather than generating boilerplate code. Users can invoke it to fetch contexts and prompt ADR constraint checks.

### Flow-Anchored Story Generation (2026-03-27)

Added `dkk story <flow-id>` CLI command, Copilot skill for story generation/splitting, and `dkk init --skills`. See [ADR-0002](.dkk/adr/adr-0002.md).
