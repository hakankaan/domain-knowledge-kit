---
name: dkk-flow-implementer
description: Guide a developer through framework-agnostic implementation of a DKK flow. Use when the user asks to implement, build, or code a flow or feature that maps to a flow in the local Domain Knowledge Pack.
---

# Flow Implementer

Use this skill whenever the user asks to **implement, build, or code a flow / feature** in a project that has a Domain Knowledge Pack (`.dkk/`).

> **Source of truth is local.** Do not look for or reference external trackers (Jira, GitHub Issues, Linear, Trello, etc.) for requirements. The local DKK model — accessed through the MCP `dkk` server or the `dkk` CLI — is authoritative.

## Preferred tools

Call MCP tools rather than shelling out, in this order of preference:

1. `mcp__dkk__story` — full flow context (actors, ordered steps, policies, BDD examples, ADRs, downstream effects) in one call
2. `mcp__dkk__list` — to discover available flows when the user hasn't named one
3. `mcp__dkk__search` — to locate a flow when the user gives a feature name instead of an id
4. `mcp__dkk__related` — to extend blast radius beyond the immediate flow
5. `mcp__dkk__show` — to read the full definition of a specific item
6. `mcp__dkk__validate` — final correctness check after edits

Fall back to the equivalent `dkk` shell commands only if the MCP server is unavailable.

## Workflow

1. **Identify the flow.** If the user gave an id, normalize it (`flow.<Name>` or bare `<Name>`). Otherwise call `mcp__dkk__list` filtered by `type: flow`, or `mcp__dkk__search` on the feature name to find a candidate flow or root command.
2. **Retrieve full context.** Call `mcp__dkk__story` with the flow id. Read the actors, ordered steps, triggered policies, BDD examples, ADRs, and downstream effects.
3. **Clarify scope.** Ask **1–7 clarifying questions** before generating any checklist. Derive every question, its options, and your recommended default from the actual story output and the project's conventions — never use a fixed list. Each question must offer concrete options with one marked as recommended. **Skip the questions entirely** for trivial flows (≤2 steps, no cross-context effects, no ambiguity). Questions should target implementation behavior and UX, e.g.:
   - What should the user see immediately after this command succeeds?
   - How should validation errors surface (inline / toast / page-level)?
   - Optimistic UI or wait-for-confirmation?
   - Concurrency: can two users trigger this simultaneously?
   - Is there an undo path, or one-way?
4. **Present architectural constraints.** List every ADR returned in the story output (`adr-NNNN — title — status`). Ask the user to acknowledge these before implementation begins. If the agent identifies any ADR conflict with the user's stated approach, surface it before proceeding.
5. **Generate a framework-agnostic checklist.** Group by domain role:
   - **Aggregates** — entities, state transitions, invariants
   - **Commands** — handlers, preconditions, validations
   - **Events** — what to publish on success
   - **Policies** — reactive logic triggered by events
   - **Read models** — projections to update on events
6. **Walk through interactively.** Ask the user which checklist item they want to tackle first. Guide on the **domain logic** — invariants, policies, transitions — not framework boilerplate. Only emit framework-specific code if the user explicitly asks or `AGENTS.md` / `CLAUDE.md` directs otherwise.
7. **Use the canonical nouns.** Whatever names appear in the `mcp__dkk__story` output are the only allowed names. Do not rename `OrderBasket` to `ShoppingCart`.
8. **Validate and render after structural changes.** When the user's implementation requires new or modified domain items, use the DKK CLI commands (`dkk add`, `dkk rename`, `dkk rm`) for structural changes and edit YAML directly only for content. The post-edit hook will run `mcp__dkk__validate` automatically; before declaring the work done, also run `dkk render` to refresh docs and the search index.

## Interaction rules

- Do not generate full boilerplate up front. Wait for the user to request code for a specific checklist item.
- Confirm with the user before moving to the next checklist item.
- If the user asks for a framework-specific implementation, defer to `AGENTS.md` or `CLAUDE.md` conventions.
- Never invent domain terms. If a needed concept is missing from the model, surface it as a gap and propose adding it via `dkk add` rather than coding around it.
