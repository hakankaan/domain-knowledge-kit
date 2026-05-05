---
name: dkk-adr-author
description: Draft a new Architecture Decision Record grounded in the local Domain Knowledge Pack. Use when the user wants to record an architectural decision, capture a trade-off, document a tech choice, or formalize a discussion as an ADR.
---

# ADR Author

Use this skill whenever the user wants to **record an architectural decision, draft an ADR, or capture a trade-off** in a project that has a Domain Knowledge Pack (`.dkk/`).

> **The DKK model is the single source of truth.** Every ADR must link to the domain items it constrains, bidirectionally. Skipping that link is the most common failure mode this skill prevents.

## Preferred tools

1. `mcp__dkk__search` (with `type: adr`) — find related existing ADRs
2. `mcp__dkk__show` — read those ADRs in full
3. `mcp__dkk__search` and `mcp__dkk__related` — identify which domain items the decision affects
4. `mcp__dkk__locate` — get absolute paths to edit the linked items
5. `mcp__dkk__validate` — final correctness check
6. `dkk new adr "<title>"` (Bash) — scaffold the file with the right number and frontmatter
7. `dkk render` (Bash) — refresh docs and search index after the ADR is finished

Use the equivalent `dkk` shell commands only if the MCP server is unavailable.

## Workflow

1. **Search prior ADRs first.** Call `mcp__dkk__search` with the topic and `type: adr`. Read every related ADR via `mcp__dkk__show`. If a *current* ADR already covers the decision, do not create a new one — update the existing record (with `superseded_by` if direction has changed). If a *deprecated* ADR is relevant, surface its rationale to the user; do not relitigate without acknowledging it.
2. **Identify affected domain items.** From the user's description, search the model and use `mcp__dkk__related` to find aggregates, events, commands, policies, and read models the decision constrains. Confirm the list with the user.
3. **Clarify the decision.** Ask **2–5 targeted questions** before drafting. Derive each question and its options from the search results and the user's stated motivation. Skip questions only when the decision is fully specified and uncontroversial. Examples (only if relevant):
   - What problem prompted the decision? (constraint / incident / new requirement / cleanup)
   - What alternatives were considered, and why were they rejected?
   - Which domain items are constrained by this decision?
   - What is the status — Proposed (needs review), Accepted (in effect), or Deprecated (recording history)?
   - Does this supersede a prior ADR? If yes, which one?
4. **Scaffold via the CLI.** Run `dkk new adr "<title>"` — this auto-increments the number and creates the file with valid frontmatter and the canonical section structure. Do not hand-create the file.
5. **Fill the body.** The canonical sections are *Context*, *Decision*, *Consequences*, and *Alternatives Considered*. Use precise domain terminology — match every name to the items returned by `mcp__dkk__search` and `mcp__dkk__show`.
6. **Set the bidirectional links.** Both sides must agree:
   - In the ADR frontmatter, set `domain_refs:` to the list of affected item ids (e.g. `ordering.OrderPlaced`, `actor.Customer`).
   - On every linked domain item's YAML, append the new ADR id to its `adr_refs:` list. Use `mcp__dkk__locate` to find each file.
7. **Run quality gates.** The post-edit hook runs `mcp__dkk__validate` automatically; before declaring the work done, also run `dkk render` to refresh `.dkk/docs/` and rebuild the search index.

## Status discipline

- **Proposed** — newly drafted, awaiting team review. The decision is not in effect yet.
- **Accepted** — the decision is in effect; new code must comply.
- **Deprecated** — no longer in effect, but kept as project memory. If a successor exists, set `superseded_by: adr-NNNN` in the frontmatter.

Never delete an ADR. Even superseded ones are institutional memory.

## Don'ts

- Don't draft an ADR that doesn't reference at least one domain item (the bidirectional link is what makes ADRs queryable).
- Don't invent domain terms in the ADR body — every name must exist in the model.
- Don't hand-edit the ADR filename or number; let `dkk new adr` assign it.
- Don't skip searching for prior ADRs — relitigating a decided question without referencing the prior ADR is the worst failure mode.
