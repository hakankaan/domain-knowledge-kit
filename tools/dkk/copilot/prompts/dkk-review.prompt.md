---
mode: agent
description: Review the current change for DKK domain impact (broken refs, blast radius, ADR drift).
---

Run a **read-only** domain-impact review of the current change.

Scope selection:

- If the user provides a PR number (e.g. `#123`), review that PR: `gh pr diff <number>`.
- If the user provides a git range (e.g. `origin/main...HEAD`), review that range.
- Otherwise review the working-tree diff (`git status` + `git diff`).

If your environment supports custom agents, switch to the **dkk-domain-reviewer** agent (`.github/agents/dkk-domain-reviewer.agent.md`) for an isolated review. Otherwise follow its read-only procedure yourself:

1. Enumerate changed files; separate domain YAML (`.dkk/domain/**`), ADRs (`.dkk/adr/*.md`), and code that might implement a command/event/policy/aggregate/read-model.
2. For each changed domain item: `summary` for orientation, then `related` (`depth: 2`) for blast radius — note neighbours not in the diff.
3. For each changed ADR: `show` it; verify every `domain_refs` item still back-links via `adr_refs`.
4. For each code change: `drift` with `file: <path>` to find the owning context and staleness; grep for domain identifiers and `search` any that look unresolved.
5. Run `validate` (schema + cross-refs) and `drift` (no file) for the freshness report; include errors/warnings verbatim.
6. Spot-check whether the change contradicts any Accepted ADR referenced by touched items.

Prefer the `dkk` MCP tools; fall back to the `dkk` CLI if the server is unavailable. Do **not** edit files or run write-side `dkk` commands. Present the report verbatim; if there is no domain impact, say so.
