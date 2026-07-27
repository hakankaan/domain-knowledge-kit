---
mode: agent
description: Draft a new Architecture Decision Record grounded in the local Domain Knowledge Pack.
---

Draft a new Architecture Decision Record (ADR) for the decision the user describes.

- If the user did not state the decision, ask them to describe it in one sentence before proceeding.
- Follow the **dkk-adr-author** skill (`.github/skills/dkk-adr-author/SKILL.md`) workflow end to end.

Key steps: search prior ADRs first (`dkk` `search` with `type: adr`, or `dkk search "<topic>" --type adr`); identify the affected domain items; ask 2–5 clarifying questions; scaffold with `dkk new adr "<title>"` (never hand-create the file); fill Context / Decision / Consequences / Alternatives; set the bidirectional `domain_refs` ↔ `adr_refs` links; then run `dkk render` as the quality gate.

Prefer the `dkk` MCP tools for reads; use the `dkk` CLI for the mutations (`dkk new adr`, `dkk render`).
