---
mode: agent
description: Generate a user story or epic from a DKK flow.
---

Generate (or split/reshape) a user story or epic from a DKK flow.

- If the user did not name a target, ask which flow to draft a story for, or list available flows via the `dkk` `list` tool (`dkk list --type flow`).
- If the target looks like a flow id (`flow.<Name>` or bare `<Name>`), pass it to the `dkk` `story` tool (`dkk story <flow-id>`).
- Otherwise `search` for the feature first to identify the matching flow or root command, then proceed.

Follow the **dkk-story-analyst** skill (`.github/skills/dkk-story-analyst/skill.md`) workflow end to end, including clarifying questions, noun enforcement (only terms present in the `dkk story` output), the epic-vs-story split rules, and acceptance-criteria mapping from policies and BDD examples.

Prefer the `dkk` MCP tools; fall back to the `dkk` CLI if the server is unavailable.
