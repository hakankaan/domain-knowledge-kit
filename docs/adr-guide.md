# ADR Guide

← [Back to README](../README.md)

Architecture Decision Records (ADRs) capture the *why* behind your domain design. DKK treats them as first-class members of the domain model: they link to the items they constrain, they are validated, indexed, rendered, and queryable — and there are commands for the whole lifecycle, not just creation.

## What Are ADRs?

An ADR is a short document that records an architectural decision: the context, the options considered, and the chosen approach with its consequences. ADRs provide a decision log that helps current and future team members understand why the domain model looks the way it does.

## File Location and Naming

ADRs live in `.dkk/adr/` as Markdown files with YAML frontmatter:

```
.dkk/adr/
  adr-0001.md
  adr-0002.md
  README.md      ← documentation for the directory; not loaded as an ADR
```

**Naming convention:** `adr-NNNN.md` — zero-padded 4-digit number (e.g. `adr-0001`, `adr-0042`).

**The `id` in the frontmatter must match the filename.** The loader keys decisions by `id`, while `dkk locate`, `rm`, `rename` and the renderer all derive the path from it. When the two disagree, the model looks healthy but those commands cannot find the file — so `dkk validate` reports a mismatch as an error. Two files claiming the same `id` is an error too.

## ADR Format

Each ADR has YAML frontmatter followed by Markdown content:

```markdown
---
id: adr-0001
title: Adopt Event Sourcing for Orders
status: proposed
date: 2026-02-21
deciders:
  - Ada Lovelace
domain_refs:
  - ordering.OrderPlaced
  - ordering.Order
tags:
  - storage
---

# ADR-0001 — Adopt Event Sourcing for Orders

## Context

What situation or problem motivated this decision? What constraints exist?

## Decision

What is the change that was decided? Be specific about what will and won't change.

## Alternatives Considered

What else was on the table, and why was each option rejected?

## Consequences

What becomes easier or more difficult because of this decision? Include both
positive and negative impacts.
```

**Frontmatter is the single source of truth for status and date.** Don't restate them as `**Status:** Accepted` prose in the body — nothing keeps a second copy in sync, and a stale status line under a superseded decision is exactly the drift that misleads readers. (Files that still carry one are updated in place by `dkk adr status`.)

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique ID matching the filename (`adr-NNNN`) |
| `title` | Yes | Short, descriptive title |
| `status` | Yes | One of: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded` |
| `date` | Yes | Date the decision was recorded (`YYYY-MM-DD`) |
| `deciders` | No | People involved in making this decision |
| `domain_refs` | No | What this decision constrains: items, contexts, actors, or flows |
| `superseded_by` | No | ID of the ADR that replaced this one |
| `supersedes` | No | ID(s) this decision replaced — the forward half of the chain |
| `tags` | No | Free-form labels for filtering (e.g. `security`, `storage`) |
| `links` | No | External references — ticket, PR, RFC, or design-doc URLs |
| `code_refs` | No | Globs binding the decision to the source it governs |
| `review_by` | No | Date this decision should be revisited (`YYYY-MM-DD`) |

Any `x-`-prefixed key passes through untouched, so a team can carry its own metadata without patching the schema. Any *other* unknown key is rejected — that catches typos like `tag:` for `tags:`.

### Status Lifecycle

| Status | Meaning |
|--------|---------|
| `proposed` | Under discussion, not in effect yet |
| `accepted` | The decision is in effect; new code must comply |
| `rejected` | Considered and declined — kept so it isn't relitigated |
| `deprecated` | Was in effect, no longer applies |
| `superseded` | Replaced by a newer ADR (see `superseded_by`) |

`rejected` and `deprecated` are different facts. A proposal that was turned down never took effect, so filing it as `deprecated` records a history that didn't happen — and loses the answer to "have we already considered this?".

Move a decision through its lifecycle with the CLI rather than hand-editing:

```bash
dkk adr status adr-0007 accepted
dkk adr status adr-0007 rejected
```

The command validates the transition, warns on unusual ones (reviving a superseded decision in place, say), and updates every copy of the status that exists in the file.

## Bidirectional Linking

An ADR link is stored on **both** sides: `domain_refs` on the ADR, `adr_refs` on the target. Both halves matter — the rendered docs, `dkk story`, and every item-side lookup read `adr_refs`, so a decision that lists an item the item doesn't list back is invisible where people actually go looking.

Write both halves in one step:

```bash
dkk adr link adr-0001 ordering.Order ordering.OrderPlaced actor.Customer
dkk adr unlink adr-0001 ordering.OrderPlaced
```

Targets can be domain items, glossary terms, actors (`actor.Name`), flows (`flow.Name`), or whole bounded contexts (`context.name`) — a decision about a context's storage strategy has no single item to hang off.

`dkk new adr --domain-refs a,b` does the same thing at creation time; pass `--no-backlink` if you deliberately want the ADR side alone.

### Validation

`dkk validate` checks that:

- Every `adr_refs` value points to an existing ADR.
- Every `domain_refs` value resolves to a domain item, context, actor, or flow.
- Every ADR's `id` matches its filename, and no two ADRs share an `id`.
- `superseded_by` resolves, and pairs with `status: superseded`.
- Frontmatter conforms to the schema.

And **warns** when a link is recorded on only one side, naming the `dkk adr link` command that fixes it. It's a warning, not an error: the model is coherent, and one-sidedness is normal mid-authoring.

Cross-service refs (`billing:billing.Invoice`) are exempt from the reciprocity check — the peer's files live in another repository and aren't yours to write.

## Creating a New ADR

1. **Check what's already decided.** Relitigating a settled question without citing the prior ADR is the failure mode this whole system exists to prevent:

   ```bash
   dkk adr decisions inventory.StockReserved
   dkk search "inventory consistency" --type adr
   ```

2. **Scaffold it.** The CLI assigns the next number and writes valid frontmatter:

   ```bash
   dkk new adr "Use CQRS for Inventory" \
     --deciders "Ada,Grace" \
     --domain-refs inventory.StockReserved,context.inventory \
     --tags storage
   ```

   The number accounts for both existing filenames and the `id` each file declares, so it can't collide with a mis-numbered file.

3. **Fill in the body.** The scaffolded sections are *Context*, *Decision*, *Alternatives Considered*, and *Consequences*.

4. **Validate and render:**

   ```bash
   dkk render    # Validates → renders docs → rebuilds the search index
   ```

### Customising the template

Put your own `adr.md.hbs` in `.dkk/templates/` to override the body skeleton — MADR, Y-statements, whatever your team uses. It shadows the bundled template, which lives inside `node_modules` and is replaced on every upgrade. The frontmatter is always machine-generated, so a custom template can't produce an invalid file.

Available variables: `id`, `idUpper`, `title`, `status`, `statusLabel`, `date`, `deciders`, `domainRefs`, `supersedes`, `supersedesList`.

## Superseding a Decision

Decisions change. Record the replacement rather than editing history:

```bash
# At creation time — flips the old ADR and links both directions
dkk new adr "Move inventory to CRUD with an outbox" --supersedes adr-0002

# Or afterwards
dkk adr status adr-0002 superseded --superseded-by adr-0009
```

Either form writes `superseded_by` on the old ADR and `supersedes` on the new one, so the chain is answerable from both ends without scanning every file.

**Never delete an ADR.** A decision you can no longer find is one your team will make again.

## Querying ADRs

### Which decisions govern this?

```bash
dkk adr decisions ordering.Order            # a domain item
dkk adr decisions context.ordering          # a whole context
dkk adr decisions --file src/storage/db.ts  # a source file
```

Returns every linked decision with its *provenance* — whether the item names it, it names the item, it governs the enclosing context, or its `code_refs` bind the file — plus which ids are actually **in effect**. That last part follows supersession chains, so a replaced decision is never reported as binding; its successor is.

Bind a decision directly to the code it governs with `code_refs` in the frontmatter:

```yaml
code_refs:
  - src/storage/**
```

### Read one

```bash
dkk show adr-0001                      # frontmatter + the Markdown body, intact
dkk show adr-0001 --section decision   # just what was decided
dkk show adr-0001 --section alt        # prefix match → "Alternatives Considered"
```

Sections are the body's level-2 headings. The full output lists the available names.

### Search and list

```bash
dkk search "event sourcing" --type adr
dkk search "storage" --type adr --status accepted   # what's binding
dkk list --type adr --status proposed               # what's still open
```

Search excerpts are centred on the match rather than on the head of the document.

### Traverse

```bash
dkk related adr-0001            # what this decision touches
dkk related ordering.Order      # including the ADRs that constrain it
```

## Keeping the Log Healthy

`dkk validate` answers "is the model consistent?". It can't answer "are these decisions still worth trusting?":

```bash
dkk adr audit
dkk adr audit --strict          # exit non-zero for CI
dkk adr audit --stale-days 30
```

It reports:

- **Unlinked decisions** — connected to no domain item, so they'll never surface from a lookup. (Retired decisions are exempt; sitting unlinked is what history does.)
- **Stalled proposals** — `proposed` and untouched past the threshold. Accept, reject, or drop it.
- **Overdue review** — `review_by` has passed.
- **One-way links** — the reciprocity gaps `dkk validate` warns about, listed individually.
- **Broken supersession chains** — `superseded` with no successor, `supersedes` pointing at a decision that doesn't point back.

`dkk stats` surfaces the unlinked count too.

## Generated Docs

`dkk render` writes a decision log to `.dkk/docs/adr/index.md`: every ADR with its status, date, what it constrains, and its supersession relationships, each linking to the source file in `.dkk/adr/`. Context and item pages link their ADRs the same way. The prose itself is never copied into the generated docs — one copy, in `.dkk/adr/`, is the point.

## Best Practices

- **One decision per ADR.** Keep them focused on a single architectural choice.
- **Link generously,** and use `dkk adr link` so both halves land.
- **Don't delete ADRs.** Mark them `rejected`, `deprecated`, or `superseded`. History matters.
- **Write ADRs early.** Capture decisions while the context is fresh, even at `proposed`.
- **Let the tooling maintain the links.** `dkk rename` and `dkk rm` rewrite `domain_refs` and `adr_refs` for you.

## References

- [ADR GitHub Organization](https://adr.github.io/)
- [Michael Nygard's original article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

## What's Next?

- **[Getting Started](getting-started.md)** — Set up your first project.
- **[Domain Modeling Guide](domain-modeling.md)** — All item types and cross-referencing rules.
- **[CLI Reference](cli-reference.md)** — Full command reference.
- **[AI Agent Integration](ai-agent-integration.md)** — How AI agents use ADR links for domain-aware reasoning.
