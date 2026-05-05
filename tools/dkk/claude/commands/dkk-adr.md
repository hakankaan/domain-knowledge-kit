---
description: Draft a new Architecture Decision Record using the dkk-adr-author skill.
argument-hint: <decision-topic>
---

Invoke the `dkk-adr-author` skill. The decision topic is `$ARGUMENTS`.

- If `$ARGUMENTS` is empty, ask the user to describe the decision in one sentence before proceeding.
- Otherwise, treat `$ARGUMENTS` as the topic and start the skill workflow at step 1 (search for prior ADRs covering this topic via `mcp__dkk__search` with `type: adr`).

Follow the skill's workflow end to end, including the bidirectional `domain_refs` ↔ `adr_refs` linking and the final `dkk render` quality gate.
