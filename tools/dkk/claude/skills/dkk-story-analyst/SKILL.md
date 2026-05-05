---
name: dkk-story-analyst
description: Generate, split, or reshape user stories and epics from the local Domain Knowledge Pack. Use when the user asks to write, draft, refine, or split a user story or epic for a feature that maps to a DKK flow or command.
---

# Story Analyst

Use this skill whenever the user asks to **write, draft, generate, refine, or split a user story or epic** in a project that has a Domain Knowledge Pack (`.dkk/`).

> **"User stories" and "epics" here are behavioral requirements derived from the local DDD/Event-Storming model in `.dkk/`.** Do not consult external trackers (Jira, GitHub Issues, Linear, Trello, etc.). The MCP `dkk` server (or the `dkk` CLI as fallback) is the only source of truth.

## Preferred tools

1. `mcp__dkk__story` — aggregate a flow's full context (actors, steps, policies, BDD examples, ADRs, downstream effects) in one call
2. `mcp__dkk__list` filtered by `type: flow` — discover available flows
3. `mcp__dkk__search` — locate a flow or command from a feature name
4. `mcp__dkk__show` — fall back when no flow exists, to read a command directly
5. `mcp__dkk__related` — to gather neighbours when working from a command instead of a flow

Use the corresponding `dkk` shell commands only if the MCP server is unavailable.

## Workflow

1. **Identify the flow.** Normalize the id (`flow.<Name>` or bare `<Name>`). If the user gave a feature name instead, call `mcp__dkk__search` to locate a matching flow or root command.
2. **Retrieve context.** Call `mcp__dkk__story` with the flow id. The response contains actors, ordered steps, triggered policies, BDD examples, ADRs, and downstream effects.
3. **Clarify scope.** Ask **1–7 clarifying questions** before drafting. Derive every question, its options, and your recommended default from the actual story output and the project's conventions — never use a fixed list. Each question must offer concrete options with one marked as recommended. **Skip the questions entirely** for trivial flows (≤2 steps, 1 actor, no ambiguity). Target product behavior and story scope, e.g.:
   - Which user-facing outcome matters most?
   - Confirmation/feedback on success — how should it surface?
   - On failure or rejection, what does the user experience?
   - Optional steps that can be skipped, or strictly linear?
   - Happy path only, or include edge cases?
4. **Map to story format.**
   - **As a** `<Actor from "Actors" section>`
   - **I want to** `<Command description from Steps>`
   - **So that** `<Flow description>`
5. **Write acceptance criteria** from the policies and BDD examples in the output:
   - Policies → Given/When/Then: *When [triggering event] → Then [consequent command]*
   - BDD examples on commands and events are pre-written scenarios — use them directly or expand
6. **Add an Architectural Constraints section** listing every ADR (`adr-NNNN — title — status`). Developers must respect these.
7. **Add an Implementation Notes section** from the downstream effects: read models to update, secondary policies that fire.

## Noun enforcement (mandatory)

Use only the terminology in the `mcp__dkk__story` output. Do not:

- Invent entity, command, or event names not present
- Rename domain terms (if DKK says `OrderBasket`, the story says `OrderBasket`)
- Reference bounded contexts not mentioned in the step refs
- Pull names from external APIs or trackers

If unsure whether a term is canonical, run `mcp__dkk__search` to verify.

## Epic vs. story decision rules

After retrieving the flow context:

- **Single story** when the flow has ≤3 command steps and spans ≤1 bounded context.
- **Epic with story slices** when the flow has >3 command steps **or** spans >1 bounded context. Slice by:
  1. Group consecutive steps that share the same context prefix (all `ordering.*` steps → Story 1)
  2. Each policy trigger becomes its own story ("As a system, when X happens, I want Y to be triggered, so that Z")
  3. Each slice that produces an event consumed by a read model must include updating that read model in its scope or acceptance criteria

When recommending an epic breakdown, present the slice boundaries and explain which downstream effects belong to each slice based on the model.

## Story reshaping

When asked to refine, split, or revise an existing story:

1. Call `mcp__dkk__story` for the relevant flow to get current domain truth
2. Compare the story's terminology to the output
3. Flag mismatches: invented terms, missing actors, acceptance criteria that contradict policies
4. Suggest corrections using exact DKK terminology
5. Ensure the reshaped story still covers all downstream effects

## Fallback: no flow exists

If no flow has been modeled for the requested feature:

1. Locate the most relevant command: `mcp__dkk__search` with `type: command`
2. Get its full definition: `mcp__dkk__show`
3. Get its neighbours: `mcp__dkk__related` with `depth: 2`
4. Assemble the story from:
   - Command `actor` → "As a..."
   - Command `description` → "I want to..."
   - Command `preconditions`, `rejections`, `examples` → acceptance criteria
   - Neighbouring policies and read models → downstream effects
5. Note in the story that no formal flow has been modeled, and recommend the team define one.

## Output format

```markdown
## [Story Title]

**As a** [Actor], **I want to** [action], **so that** [business value].

### Acceptance Criteria

- **Given** [precondition], **When** [command/event], **Then** [outcome]
- (repeat for each policy rule and BDD example)

### Architectural Constraints

- [adr-NNNN]: [title] ([status])

### Implementation Notes

- [Downstream read models, secondary policy triggers, cross-context effects]
```
