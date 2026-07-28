---
name: dkk-adr-author
description: Draft a new Architecture Decision Record grounded in the local Domain Knowledge Pack. Use when the user wants to record an architectural decision, capture a trade-off, document a tech choice, or formalize a discussion as an ADR.
---

# ADR Author

Use this skill whenever the user wants to **record an architectural decision, draft an ADR, or capture a trade-off** in a project that has a Domain Knowledge Pack (`.dkk/`).

> **The DKK model is the single source of truth.** Every ADR must link to what it constrains, and the link has two halves. Writing only one of them is the most common failure mode this skill prevents — which is why the linking step is a CLI command, not a hand edit.

## Preferred tools

1. `mcp__dkk__decisions` — what is already decided about the items or files in question
2. `mcp__dkk__search` (with `type: adr`) — find related ADRs by topic; add `status` to narrow
3. `mcp__dkk__show` — read those ADRs (use `section` to read just the decision)
4. `mcp__dkk__related` — identify which domain items the decision affects
5. `mcp__dkk__validate` — final correctness check
6. `dkk new adr "<title>"` (Bash) — scaffold the file with the right number and frontmatter
7. `dkk adr link <adr-id> <ids…>` (Bash) — write **both** halves of every link
8. `dkk render` (Bash) — refresh docs and search index after the ADR is finished

Use the equivalent `dkk` shell commands only if the MCP server is unavailable.

## Workflow

1. **Find out what is already decided.** Call `mcp__dkk__decisions` for each item, context, or file the decision touches, and `mcp__dkk__search` with `type: adr` for the topic. Read anything relevant via `mcp__dkk__show`.
   - If a **binding** ADR already covers the decision, do not create a new one — either update that record, or supersede it (step 6).
   - If a **rejected** ADR covers the idea, say so before proposing it again. Relitigating a settled question without citing the prior record is the worst failure mode here.
   - If a **deprecated or superseded** ADR is relevant, surface its rationale; note that `dkk_decisions` already tells you which successor is in effect.
2. **Identify what the decision constrains.** Search the model and use `mcp__dkk__related` to find the aggregates, events, commands, policies, and read models involved. A decision can also constrain a whole context (`context.ordering`), an actor (`actor.Customer`), or a flow (`flow.Checkout`) — use those when no single item is the right target. Confirm the list with the user.
3. **Clarify the decision.** Ask **2–5 targeted questions** before drafting, derived from the search results and the user's stated motivation. Skip them only when the decision is fully specified and uncontroversial. Examples:
   - What problem prompted this? (constraint / incident / new requirement / cleanup)
   - What alternatives were considered, and why were they rejected?
   - What does this constrain?
   - What is the status — Proposed (needs review), Accepted (in effect), or Rejected (recording a decision *not* to do it)?
   - Does this supersede a prior ADR? If yes, which one?
4. **Scaffold via the CLI.** Never hand-create the file — `dkk new adr` assigns the number (accounting for both filenames and declared ids) and writes valid frontmatter:

   ```bash
   dkk new adr "<title>" --status proposed --deciders "<names>" \
     --domain-refs <ids> --tags <tags>
   ```

   `--domain-refs` writes the reciprocal `adr_refs` on each target for you.
5. **Fill the body.** The canonical sections are *Context*, *Decision*, *Alternatives Considered*, and *Consequences* — the scaffold creates all four. Use precise domain terminology: every name must exist in the model.
   - Do **not** write `**Status:**` or `**Date:**` lines into the body. The frontmatter is the single copy; a prose duplicate drifts.
6. **Supersede rather than rewrite** when direction has changed:

   ```bash
   dkk new adr "<new title>" --supersedes adr-NNNN
   # or, for an ADR that already exists:
   dkk adr status adr-NNNN superseded --superseded-by adr-MMMM
   ```

   Both forms write `superseded_by` on the old record and `supersedes` on the new one. Never delete an ADR.
7. **Verify the links landed.** If you added or changed refs after scaffolding, use `dkk adr link` (which writes both halves) rather than editing YAML by hand. `dkk validate` warns about one-way links and names the fix.
8. **Run quality gates.** The post-edit hook runs validation automatically; before declaring the work done, also run `dkk render` to refresh `.dkk/docs/` and rebuild the search index.

## Status discipline

| Status | Meaning |
|--------|---------|
| `proposed` | Newly drafted, awaiting review. Not in effect. |
| `accepted` | In effect; new code must comply. |
| `rejected` | Considered and declined — kept so nobody proposes it again. |
| `deprecated` | Was in effect, no longer applies. |
| `superseded` | Replaced by a later ADR (`superseded_by` records which). |

`rejected` and `deprecated` are not interchangeable. A proposal that was turned down never took effect; filing it as `deprecated` invents a history that didn't happen and loses the answer to "have we considered this already?".

Change status with `dkk adr status <id> <status>` — it updates every copy in the file and warns on unusual transitions.

## Don'ts

- Don't draft an ADR that references nothing — the links are what make a decision findable later. If it genuinely has no domain footprint, tell the user that and let them decide.
- Don't invent domain terms in the ADR body; every name must exist in the model.
- Don't hand-edit the ADR filename or number, and don't let `id` and filename diverge (`dkk validate` rejects it).
- Don't write only one half of a link.
- Don't skip step 1.
