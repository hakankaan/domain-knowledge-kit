---
name: dkk-story-analyst
description: Portable Agent Skill for generating, splitting, and reshaping user stories based entirely on the local Domain Knowledge Pack (not external issue trackers).
---

# Story Analyst Skill

> Portable Agent Skill for generating, splitting, and reshaping user stories and epics directly from a local Domain Knowledge Pack (DKK). 
> 
> **CRITICAL INSTRUCTION FOR AI AGENTS:** 
> Do NOT look for, query, or mention any external issue/ticket management tools (like Jira, GitHub Issues, Linear, Trello, etc.). In this context, "User Stories" and "Epics" refer exclusively to behavioral requirements derived from Domain-Driven Design (DDD) and Event Storming models stored locally in YAML format. Your source of truth is ALWAYS the local `dkk` CLI tool.

## Description

This skill enables an AI agent to generate accurate, domain-grounded user stories, epics, and acceptance criteria by leveraging the structured domain model managed by DKK. It uses the `dkk story` command to aggregate a flow's complete context in a single call, then maps that context onto standard Agile story formats based purely on the domain model.

## Primary Command

```bash
dkk story <flow-id>        # Aggregate full story context (markdown)
dkk story <flow-id> --json # Machine-readable output for agents
```

Accepts both `flow.Name` and bare `Name` (auto-prefixes `flow.`).

## Story Generation Workflow

When asked to write, draft, or generate a user story:

1. **Identify the flow** — Ask the user for the relevant flow ID, or search for it: `dkk list --type flow`. If the user provides a feature name, run `dkk search "<feature>"` to locate the matching flow or command.
2. **Retrieve full context** — Run `dkk story <flow-id>`. This returns actors, ordered steps, triggered policies, BDD examples, ADRs, and downstream effects in one call from the local domain model.
3. **Clarify scope** — Use `askQuestions` to ask **1–7 clarifying questions** before drafting. Derive each question, its options, and your recommended default from the actual DKK output and the project's conventions — do not use a fixed set. Each question must offer concrete options with one marked as recommended. Skip entirely for trivial flows (≤2 steps, 1 actor, no ambiguity). Questions should target **product behavior and story scope**, e.g.:
   - Which user-facing outcome matters most for this story?
   - Should the user receive confirmation/feedback after this action, and how?
   - When a step fails or is rejected, what should the user experience?
   - Are there optional steps the user can skip, or is the flow strictly linear?
   - Should this story cover the happy path only, or include edge cases?
4. **Map to story format** using the output:
   - **As a** `[Actor from "Actors" section]`
   - **I want to** `[Command description from Steps]`
   - **So that** `[Flow description]`
5. **Write acceptance criteria** from the "Policies" and "BDD Examples" sections:
   - Policies provide the **Given/When/Then** structure: When [triggering event] → Then [consequent command]
   - BDD Examples from commands and events are pre-written scenarios — use them directly or expand them
6. **Add an Architectural Constraints section** listing all ADRs from the output. Developers must respect these when implementing the story.
7. **Add an Implementation Notes section** from "Downstream Effects": read models that must be updated, secondary policies that will fire.

## Noun Enforcement (MANDATORY)

Only use terminology present in the `dkk story` output. Never:
- Invent entity names, command names, or event names not in the output
- Rename domain terms (if DKK says `OrderBasket`, the story must not say `ShoppingCart`)
- Reference bounded contexts not mentioned in the step refs
- Pull context from external APIs or issue trackers.

If you are uncertain whether a term is canonical, run `dkk search "<term>"` to verify.

## Epic vs. Story Decision Rules (Domain Level)

After retrieving the flow context from DKK, apply these rules:

- **Single story:** Flow has ≤3 command steps and spans ≤1 bounded context.
- **Epic with story slices:** Flow has >3 command steps OR spans >1 bounded context. Slice by:
  1. Group consecutive steps that share the same bounded context prefix (e.g., all `ordering.*` steps → Story 1)
  2. Each policy trigger becomes an explicit story ("As a system, when X happens, I want Y to be triggered, so that Z")
  3. Each slice that produces an event consumed by a read model must explicitly include updating that read model in its scope or acceptance criteria

When recommending an epic breakdown, present the slice boundaries and explain which downstream effects belong to each slice based on the DKK model.

## Story Reshaping Workflow

When asked to refine, split, or revise an existing story:

1. Run `dkk story <flow-id>` for the relevant flow to get the current domain truth
2. Compare the text's entities and terminology against the local DKK output
3. Flag any mismatches: invented terms, missing actors, acceptance criteria that contradict policies
4. Suggest corrections using exact DKK terminology
5. Ensure the reshaped story still covers all downstream effects (read models, secondary policies)

## Fallback: No Flow Exists

If no flow has been defined for the requested feature:

1. Locate the most relevant command: `dkk search "<feature>" --type command`
2. Get its full definition: `dkk show <command-id>`
3. Get its graph neighbors: `dkk related <command-id> --depth 2`
4. Assemble the story from:
   - Command `actor` field → "As a..."
   - Command `description` → "I want to..."
   - Command `preconditions`, `rejections`, `examples` → acceptance criteria
   - Neighboring policies and read models → downstream effects
5. Note in the story that no formal flow has been modeled for this feature and recommend the team define one

## Output Format

Use this markdown structure for generated stories:

```markdown
## [Story Title]

**As a** [Actor], **I want to** [action], **so that** [business value].

### Acceptance Criteria

- **Given** [precondition], **When** [command/event], **Then** [expected outcome]
- (repeat for each policy rule and BDD example)

### Architectural Constraints

- [adr-NNNN]: [title] ([status])

### Implementation Notes

- [Downstream read models, secondary policy triggers, cross-context effects]
```
