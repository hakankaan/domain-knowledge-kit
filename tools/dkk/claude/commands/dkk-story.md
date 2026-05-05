---
description: Generate a user story or epic from a DKK flow using the dkk-story-analyst skill.
argument-hint: <flow-id-or-feature-name>
---

Invoke the `dkk-story-analyst` skill. The user's target is `$ARGUMENTS`.

- If `$ARGUMENTS` is empty, ask the user which flow to draft a story for, or list available flows via `mcp__dkk__list` (filter `type: flow`).
- If `$ARGUMENTS` looks like a flow id (`flow.<Name>` or bare `<Name>`), pass it through to `mcp__dkk__story`.
- Otherwise, run `mcp__dkk__search` with `$ARGUMENTS` first to identify the matching flow or root command, then proceed.

Follow the skill's workflow end to end, including clarifying questions and acceptance-criteria mapping.
