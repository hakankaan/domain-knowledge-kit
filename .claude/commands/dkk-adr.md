---
description: Draft a new Architecture Decision Record using the dkk-adr-author skill.
argument-hint: <decision-topic>
---

Invoke the `dkk-adr-author` skill. The decision topic is `$ARGUMENTS`.

- If `$ARGUMENTS` is empty, ask the user to describe the decision in one sentence before proceeding.
- Otherwise, treat `$ARGUMENTS` as the topic and start the skill workflow at step 1: ask `mcp__dkk__decisions` what already governs the items or files involved, and `mcp__dkk__search` with `type: adr` for the topic.

Follow the skill's workflow end to end, including `dkk adr link` for the bidirectional `domain_refs` ↔ `adr_refs` links (never edit one side by hand) and the final `dkk render` quality gate.
