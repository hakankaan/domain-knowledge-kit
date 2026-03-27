# Roadmap

Future directions and requirements for the Domain Knowledge Kit. Records **what and why**, not how. Implementations get an ADR in `.dkk/adr/`.

## Planned

### AI-Assisted Flow Implementation

**Goal:** Guide developers from user story creation to actual implementation using AI.

**Why:** While `dkk story` generates domain-grounded stories, developers lack guidance during implementation. Access to the structured domain model (commands, events, aggregates) should allow an AI to accurately guide scaffolding, event listeners, and read models.

**Open questions:**
- New CLI (`dkk implement`), a Copilot skill, or both?
- Prescribe (generate boilerplate) vs. Suggest (checklist)?
- How to maintain framework-agnostic guidance?
- Include implementation hints directly in `dkk story` output?

## Completed

### Flow-Anchored Story Generation (2026-03-27)

Added `dkk story <flow-id>` CLI command, Copilot skill for story generation/splitting, and `dkk init --skills`. See [ADR-0002](.dkk/adr/adr-0002.md).
