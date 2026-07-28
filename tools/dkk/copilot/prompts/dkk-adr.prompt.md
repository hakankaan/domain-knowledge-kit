---
mode: agent
description: Draft a new Architecture Decision Record grounded in the local Domain Knowledge Pack.
---

Draft a new Architecture Decision Record (ADR) for the decision the user describes.

- If the user did not state the decision, ask them to describe it in one sentence before proceeding.
- Follow the **dkk-adr-author** skill (`.github/skills/dkk-adr-author/SKILL.md`) workflow end to end.

Key steps: find out what is already decided (`dkk_decisions` on the affected items/files, plus `dkk search "<topic>" --type adr`); identify what the decision constrains — items, but also whole contexts, actors, or flows; ask 2–5 clarifying questions; scaffold with `dkk new adr "<title>" --domain-refs <ids>` (never hand-create the file); fill Context / Decision / Alternatives Considered / Consequences; make sure every link has both halves via `dkk adr link`; then run `dkk render` as the quality gate.

Do not restate status or date in the ADR body — the frontmatter is the single copy. To retire a decision, use `dkk adr status` (`rejected`, `deprecated`, or `superseded --superseded-by <id>`); never delete an ADR.

Prefer the `dkk` MCP tools for reads; use the `dkk` CLI for the mutations (`dkk new adr`, `dkk adr link`, `dkk adr status`, `dkk render`).
