---
name: dkk-adr-author
description: Portable Agent Skill for drafting Architecture Decision Records grounded in the local Domain Knowledge Pack. Use when the user wants to record an architectural decision, capture a trade-off, document a tech choice, or formalize a discussion as an ADR.
---

# ADR Author Skill

> Portable Agent Skill for drafting Architecture Decision Records (ADRs) directly from a local Domain Knowledge Pack (DKK). Works with any AI tool via the `dkk` CLI.
>
> **The DKK model is the single source of truth.** Every ADR must link to the domain items it constrains, bidirectionally. Skipping that link is the most common failure mode this skill prevents.

## Primary Commands

```bash
dkk search "<topic>" --type adr   # find related existing ADRs
dkk show <adr-id>                 # read an ADR in full
dkk search "<term>"               # identify affected domain items
dkk related <id> --depth 2        # find items the decision constrains
dkk new adr "<title>"             # scaffold the file (auto-number + frontmatter)
dkk render                        # validate + refresh docs + rebuild index
```

If the `dkk` MCP server is available, prefer its read tools (`search`, `show`, `related`, `locate`, `validate`) for the queries; use the CLI for the mutations (`dkk new adr`, `dkk render`).

## Workflow

1. **Search prior ADRs first.** Run `dkk search "<topic>" --type adr` and read every related ADR with `dkk show <adr-id>`. If a *current* ADR already covers the decision, do not create a new one — update the existing record (with `superseded_by` if the direction has changed). If a *deprecated* ADR is relevant, surface its rationale to the user; do not relitigate without acknowledging it.
2. **Identify affected domain items.** From the user's description, run `dkk search "<term>"` and `dkk related <id> --depth 2` to find aggregates, events, commands, policies, and read models the decision constrains. Confirm the list with the user.
3. **Clarify the decision.** Ask **2–5 targeted questions** before drafting. Derive each question and its options from the search results and the user's stated motivation. Skip questions only when the decision is fully specified and uncontroversial. Examples (only if relevant):
   - What problem prompted the decision? (constraint / incident / new requirement / cleanup)
   - What alternatives were considered, and why were they rejected?
   - Which domain items are constrained by this decision?
   - What is the status — Proposed (needs review), Accepted (in effect), or Deprecated (recording history)?
   - Does this supersede a prior ADR? If yes, which one? (`dkk new adr "<title>" --supersedes adr-NNNN`)
4. **Scaffold via the CLI.** Run `dkk new adr "<title>"` — this auto-increments the number and creates the file with valid frontmatter and the canonical section structure. Do not hand-create the file or its number.
5. **Fill the body.** The canonical sections are *Context*, *Decision*, *Consequences*, and *Alternatives Considered*. Use precise domain terminology — match every name to the items returned by `dkk search` / `dkk show`.
6. **Set the bidirectional links.** Both sides must agree:
   - In the ADR frontmatter, set `domain_refs:` to the list of affected item ids (e.g. `ordering.OrderPlaced`, `actor.Customer`).
   - On every linked domain item's YAML, append the new ADR id to its `adr_refs:` list. Use `dkk show <id>` (or the `locate` tool) to find each file.
7. **Run quality gates.** Run `dkk render` to validate, refresh `.dkk/docs/`, and rebuild the search index before declaring the work done.

## Status Discipline

- **Proposed** — newly drafted, awaiting team review. The decision is not in effect yet.
- **Accepted** — the decision is in effect; new code must comply.
- **Deprecated** — no longer in effect, but kept as project memory. If a successor exists, set `superseded_by: adr-NNNN` in the frontmatter.

Never delete an ADR. Even superseded ones are institutional memory.

## Don'ts

- Don't draft an ADR that doesn't reference at least one domain item (the bidirectional link is what makes ADRs queryable).
- Don't invent domain terms in the ADR body — every name must exist in the model. If unsure a term is canonical, run `dkk search "<term>"` to verify.
- Don't hand-edit the ADR filename or number; let `dkk new adr` assign it.
- Don't skip searching for prior ADRs — relitigating a decided question without referencing the prior ADR is the worst failure mode.
- Don't look for ADRs in external tools (Confluence, Notion, wikis). The source of truth is `.dkk/adr/` via the `dkk` CLI.
