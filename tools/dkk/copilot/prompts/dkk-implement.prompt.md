---
mode: agent
description: Walk through framework-agnostic implementation of a DKK flow.
---

Guide the user through implementing a DKK flow (or the feature they name).

- If the user did not name a target, ask which flow to implement, or list available flows via the `dkk` `list` tool (`dkk list --type flow`).
- If the target looks like a flow id (`flow.<Name>` or bare `<Name>`), pass it to the `dkk` `story` tool (`dkk story <flow-id>`).
- Otherwise `search` for the feature first to identify the matching flow or root command, then proceed.

Follow the **dkk-flow-implementer** skill (`.github/skills/dkk-flow-implementer/skill.md`) workflow: retrieve the story context, ask clarifying questions, present the ADR constraints, generate a framework-agnostic implementation checklist, and walk the user through it interactively.

Prefer the `dkk` MCP tools; fall back to the `dkk` CLI if the server is unavailable.
