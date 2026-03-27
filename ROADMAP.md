# Roadmap

Future directions and requirements for the Domain Knowledge Kit.

Items here capture **what we want to build and why** — not how. When an item is picked up for implementation and architectural choices are made, an ADR is written in `.dkk/adr/`.

## Planned

### AI-Assisted Flow Implementation

**Goal:** Enable developers who use DKK in their projects to implement user stories (flows) with direct AI assistant guidance — bridging the gap from "story written" to "story implemented."

**Why:** `dkk story` generates domain-grounded user stories from flows, but the developer is on their own when it comes to actually implementing the story. The domain model already knows the commands, events, aggregates, policies, and their relationships. An AI assistant with access to this structured context should be able to guide implementation: scaffold handlers for commands, set up event listeners for policies, wire read model projections — all grounded in the domain model rather than guessed from code patterns.

**Open questions:**
- Should this be a new CLI command (`dkk implement`), a Copilot skill, or both?
- How much should the tool prescribe vs. suggest? (e.g., generate boilerplate vs. provide an implementation checklist)
- How does this interact with different tech stacks? DKK is framework-agnostic — implementation guidance needs to be too.
- Should `dkk story` output include implementation hints (e.g., "this command needs a handler in the ordering context") or should that be a separate concern?

## Completed

### Flow-Anchored Story Generation (2026-03-27)

Implemented `dkk story <flow-id>` CLI command and a Copilot skill for AI-assisted user story creation, splitting, and reshaping. Added `dkk init --skills` for distributing skills to consumer projects. See [ADR-0002](.dkk/adr/adr-0002.md).
