# Architecture Decision Records (ADRs)

This directory holds the project's Architecture Decision Records. They
are part of the Domain Knowledge Pack: `dkk` loads every file here,
validates it, links it to the domain model, and indexes it for search.

Don't hand-create files here — run `dkk new adr "<title>"`, which
assigns the next number and writes valid frontmatter.

## Format

One file per decision, named **`adr-NNNN.md`** with a zero-padded
4-digit number (`adr-0001.md`, `adr-0042.md`). The `id` in the
frontmatter must match the filename: the loader keys decisions by `id`
while `locate`, `rm`, `rename` and the renderer derive the path from
it, so `dkk validate` treats a mismatch as an error.

Each file is YAML frontmatter followed by Markdown:

```markdown
---
id: adr-0007
title: Use CQRS for inventory
status: proposed
date: 2026-07-28
deciders:
  - Ada Lovelace
domain_refs:
  - inventory.StockReserved
  - context.inventory
tags:
  - storage
---

# ADR-0007 — Use CQRS for inventory

## Context

What is the issue that is motivating this decision?

## Decision

What is the change we are making?

## Alternatives Considered

What else was on the table, and why was each rejected?

## Consequences

What becomes easier or harder as a result?
```

**Frontmatter is the single source of truth for status and date.** Do
not restate them in the body — nothing keeps a prose copy in sync, and
a stale `**Status:** Accepted` line under a superseded decision is
exactly the drift that misleads a reader.

The full field list is in [`tools/dkk/schema/adr-frontmatter.schema.json`](../../tools/dkk/schema/adr-frontmatter.schema.json);
`x-`-prefixed keys pass through untouched if you need your own metadata.

## Linking

The link between a decision and what it constrains is stored on both
sides — `domain_refs` on the ADR, `adr_refs` on the target — and both
halves must be written for it to be visible everywhere:

```bash
dkk adr link adr-0007 inventory.StockReserved context.inventory
```

Targets can be domain items, glossary terms, actors (`actor.Name`),
flows (`flow.Name`), or whole contexts (`context.name`). `dkk validate`
warns when a link exists on only one side.

## Lifecycle

| Status | Meaning |
|--------|---------|
| `proposed` | under discussion — not in effect yet |
| `accepted` | in effect — new code must comply |
| `rejected` | considered and declined — kept so it is not relitigated |
| `deprecated` | was in effect, no longer applies |
| `superseded` | replaced by a later ADR (see `superseded_by`) |

```bash
dkk adr status adr-0007 accepted
dkk adr status adr-0003 superseded --superseded-by adr-0007
```

**Never delete an ADR.** Retire it — a decision you can no longer find
is a decision your team will make again.

## Reading and health

```bash
dkk adr decisions ordering.Order      # what governs this item
dkk adr decisions --file src/app.ts   # what governs this file
dkk show adr-0007 --section decision  # just what was decided
dkk adr audit                         # unlinked, stalled, one-way, broken chains
```

## Customising the template

Put your own `adr.md.hbs` in `.dkk/templates/` to override the body
skeleton `dkk new adr` scaffolds (MADR, Y-statements, whatever your
team uses). The frontmatter is always machine-generated.

## References

- [ADR GitHub Organization](https://adr.github.io/)
- [Michael Nygard's article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
