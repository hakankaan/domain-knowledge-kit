---
name: dkk-flow-implementer
description: Portable Agent Skill for guiding developers through framework-agnostic implementation of a flow based directly on a local Domain Knowledge Pack (not external issue trackers).
---

# Flow Implementer Skill

> Portable Agent Skill for guiding developers through framework-agnostic implementation of a flow based entirely on a local Domain Knowledge Pack (DKK).
> 
> **CRITICAL INSTRUCTION FOR AI AGENTS:** 
> Do NOT look for, query, or mention any external issue/ticket management tools (like Jira, GitHub Issues, Linear, Trello, etc.) for requirements. Follow the flow definitions and rules sourced strictly from the local `dkk` CLI tool. All "requirements" and "flows" are documented via the local Domain Knowledge Kit.

## Description

This skill enables an AI agent to guide developers through implementing a specific predefined flow. It uses the `dkk story` command to gather the full domain context, checks architectural constraints, and provides step-by-step, framework-agnostic guidance checklists. It focuses on domain invariants, policies, and behavior rather than generating rigid application boilerplate code.

## Primary Command

```bash
dkk story <flow-id>        # Aggregate full story context (markdown)
dkk story <flow-id> --json # Machine-readable output for agents
```

## Implementation Guidance Workflow

When asked to implement, build, or code a flow/feature:

1. **Identify the flow** — Ask the user for the relevant flow ID if not provided, or search for it: \`dkk list --type flow\`.
2. **Retrieve full context from DKK** — Run \`dkk story <flow-id>\` or \`dkk story <flow-id> --json\` to obtain domain rules and requirements locally. Do NOT request external tickets.
3. **Clarify scope** — Use \`askQuestions\` to ask **1–7 clarifying questions** before proceeding. Derive each question, its options, and your recommended default from the DKK output, the project's existing codebase conventions, and any prior ADR decisions — do not use a fixed set. Each question must offer concrete options with one marked as recommended. Skip entirely for trivial flows (≤2 steps, no cross-context effects, no ambiguity). Questions should target **implementation behavior and UX details**, e.g.:
   - What should the user see/experience immediately after this command succeeds?
   - How should validation errors surface to the user (inline, toast, page-level)?
   - Should this action be optimistic (instant UI update) or wait for confirmation?
   - Are there concurrency scenarios — can two users trigger this simultaneously?
   - Should the flow include an undo/cancel path, or is it one-way?
4. **Present Architectural Constraints** — Before any implementation begins, output the ADRs (Architecture Decision Records) from the local DKK context. Ask the user to acknowledge these constraints before proceeding.
5. **Generate Implementation Checklist** — Create a logical, framework-agnostic checklist of work needed. Typical buckets include:
   - **Domain/Aggregates**: Entities, state transitions, and invariants to model.
   - **Commands/Controllers**: Handlers for incoming commands, preconditions, and validations.
   - **Events**: Domain events to be explicitly published upon successful command validation.
   - **Policies**: Side-effects and reactive logic that triggers when events occur.
   - **Read Models**: Projections that need to be updated in response to events.
6. **Interactive Step-by-step Delivery** — Ask the user which checklist item they want to tackle first. Guide them through the logic without writing framework-specific boilerplate initially (unless explicitly requested by the user's overarching project instructions). Keep guidance focused on the domain logic, invariants, and policies defined in the \`dkk story\` output.
7. **Noun Enforcement (MANDATORY)** — You MUST use the exact terminology defined in the DKK output. Do not invent new names for entities, commands, or events.

## Interaction Rules
- Do NOT generate full boilerplate application code initially. Wait for the user to request code generation for a specific checklist item.
- DO ask the user for confirmation before moving to the next checklist item.
- DO reference project-level \`.github/copilot-instructions.md\` if the user asks for framework-specific implementations later on.
