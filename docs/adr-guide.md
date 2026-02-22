# ADR Guide

← [Back to README](../README.md)

Architecture Decision Records (ADRs) capture the *why* behind your domain design. DKK integrates ADRs directly into the domain model with bidirectional linking — domain items reference ADRs, and ADRs reference domain items.

## What Are ADRs?

An ADR is a short document that records an architectural decision: the context, the options considered, and the chosen approach with its consequences. ADRs provide a decision log that helps current and future team members understand why the domain model looks the way it does.

## File Location and Naming

ADRs live in `.dkk/adr/` as Markdown files with YAML frontmatter:

```
.dkk/adr/
  adr-0001.md
  adr-0002.md
  ...
```

**Naming convention:** `adr-NNNN.md` — zero-padded 4-digit number (e.g. `adr-0001`, `adr-0042`).

## ADR Format

Each ADR has YAML frontmatter followed by Markdown content:

```markdown
---
id: adr-0001
title: Adopt Event Sourcing for Orders
status: proposed
date: 2026-02-21
domain_refs:
  - ordering.OrderPlaced
  - ordering.Order
---

## Context

What situation or problem motivated this decision? What constraints exist?

## Decision

What is the change that was decided? Be specific about what will and won't change.

## Consequences

What becomes easier or more difficult because of this decision? Include both
positive and negative impacts.
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique ID matching the filename (`adr-NNNN`) |
| `title` | Yes | Short, descriptive title |
| `status` | Yes | One of: `proposed`, `accepted`, `deprecated`, `superseded` |
| `date` | Yes | Date the ADR was created or last updated (`YYYY-MM-DD`) |
| `domain_refs` | No | List of domain item IDs this decision relates to |

### Status Lifecycle

| Status | Meaning |
|--------|---------|
| `proposed` | Under discussion, not yet decided |
| `accepted` | Decision has been made and is in effect |
| `deprecated` | No longer relevant (system has changed) |
| `superseded` | Replaced by a newer ADR |

## Bidirectional Linking

DKK enforces bidirectional links between ADRs and domain items.

### ADR → Domain Items

In the ADR frontmatter, `domain_refs` lists the domain items this decision relates to:

```yaml
---
id: adr-0001
domain_refs:
  - ordering.OrderPlaced
  - ordering.Order
---
```

### Domain Items → ADRs

In domain YAML files, `adr_refs` links an item back to its ADRs:

```yaml
events:
  - name: OrderPlaced
    description: Raised when a customer order is confirmed.
    adr_refs:
      - adr-0001
```

### Validation

Running `dkk validate` checks that:
- Every `adr_refs` value points to an existing ADR file in `.dkk/adr/`.
- Every `domain_refs` value in ADR frontmatter points to an existing domain item.
- ADR `id` fields match their filename.

Broken links produce validation errors.

## Creating a New ADR

1. **Choose the next number.** Look at existing files in `.dkk/adr/` and increment.

2. **Create the file.** For example, `.dkk/adr/adr-0002.md`:

   ```markdown
   ---
   id: adr-0002
   title: Use CQRS for Inventory
   status: proposed
   date: 2026-02-21
   domain_refs:
     - inventory.StockReserved
     - inventory.InventoryProjection
   ---

   ## Context

   The inventory context needs to handle high-throughput stock queries
   while maintaining strong consistency for reservations...

   ## Decision

   Separate command and query responsibilities...

   ## Consequences

   - Read-side can scale independently
   - Eventual consistency between write and read models
   ```

3. **Link domain items back.** Add `adr_refs` to each referenced item in `.dkk/domain/contexts/inventory.yml`:

   ```yaml
   events:
     - name: StockReserved
       description: Raised when inventory is reserved for an order.
       adr_refs:
         - adr-0002
   ```

4. **Validate and render:**

   ```bash
   dkk render    # Validates → renders docs → rebuilds search index
   ```

## Querying ADRs

### Show ADR Details

```bash
dkk adr show adr-0001
```

Outputs the ADR's YAML frontmatter (id, title, status, date, domain_refs).

### Find Related Links

```bash
# From an ADR: which domain items reference it?
dkk adr related adr-0001

# From a domain item: which ADRs reference it?
dkk adr related ordering.OrderPlaced
```

### Search for ADRs

```bash
dkk search "event sourcing" --type adr
dkk list --type adr
```

## Best Practices

- **One decision per ADR.** Keep ADRs focused on a single architectural choice.
- **Link generously.** Connect ADRs to all domain items they affect — this builds a rich knowledge graph.
- **Don't delete ADRs.** Mark them `deprecated` or `superseded` instead. History matters.
- **Update `domain_refs` when renaming items.** If you rename `OrderPlaced` to `OrderConfirmed`, update all ADRs that reference it.
- **Write ADRs early.** Capture decisions while the context is fresh, even if the status is `proposed`.

## References

- [ADR GitHub Organization](https://adr.github.io/)
- [Michael Nygard's original article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

## What's Next?

- **[Getting Started](getting-started.md)** — Set up your first project.
- **[Domain Modeling Guide](domain-modeling.md)** — All item types and cross-referencing rules.
- **[CLI Reference](cli-reference.md)** — Full command reference including `adr show` and `adr related`.
- **[AI Agent Integration](ai-agent-integration.md)** — How AI agents use ADR links for domain-aware reasoning.
