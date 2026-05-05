---
description: Walk through framework-agnostic implementation of a DKK flow using the dkk-flow-implementer skill.
argument-hint: <flow-id-or-feature-name>
---

Invoke the `dkk-flow-implementer` skill. The user's target is `$ARGUMENTS`.

- If `$ARGUMENTS` is empty, ask the user which flow to implement, or list available flows via `mcp__dkk__list` (filter `type: flow`).
- If `$ARGUMENTS` looks like a flow id (`flow.<Name>` or bare `<Name>`), pass it through to `mcp__dkk__story`.
- Otherwise, run `mcp__dkk__search` with `$ARGUMENTS` first to identify the matching flow or root command, then proceed.

Follow the skill's workflow: retrieve story, ask clarifying questions, present ADR constraints, generate the framework-agnostic checklist, and walk the user through items interactively.
