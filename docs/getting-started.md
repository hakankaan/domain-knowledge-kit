# Getting Started

← [Back to README](../README.md)

This guide walks you through installing Domain Knowledge Kit, setting up your first domain model, and running quality gates — all in under 5 minutes.

## Installation

```bash
# Install globally from npm
npm install -g domain-knowledge-kit

# Or run without installing
npx dkk --help
```

During local development of DKK itself, use `npx tsx src/cli.ts` instead of `dkk`.

## Prerequisites

- **Node.js** >= 21.2.0

## Project Structure

After setup, your project will have this layout:

```
.dkk/
  domain/
    index.yml              # Registered contexts + cross-context flows
    actors.yml             # Global actors (human | system | external)
    contexts/
      <name>.yml           # One file per bounded context
  adr/                     # Architecture Decision Records
  docs/                    # Generated documentation (do not edit)

tools/
  dkk/
    schema/              # JSON Schemas for YAML validation
    templates/           # Handlebars templates for doc generation
```

## Step 1: Create a Bounded Context

Create a new YAML file at `.dkk/domain/contexts/<name>.yml`. Here's a minimal example for an `ordering` context:

```yaml
name: ordering
description: Handles customer order lifecycle.
events: []
commands: []
policies: []
aggregates: []
read_models: []
glossary: []
```

## Step 2: Register the Context

Add your new context to `.dkk/domain/index.yml`:

```yaml
contexts:
  - name: ordering
    description: Handles customer order lifecycle.
flows: []
```

## Step 3: Add Domain Items

Now populate your context with events, commands, aggregates, and more. Here's an expanded example:

```yaml
name: ordering
description: Handles customer order lifecycle.

glossary:
  - term: Order
    definition: A customer's request to purchase items.

events:
  - name: OrderPlaced
    description: Raised when a customer order is confirmed.
    fields:
      - name: orderId
        type: UUID
      - name: customerId
        type: UUID
    raised_by: Order

commands:
  - name: PlaceOrder
    description: Submit a new customer order.
    fields:
      - name: items
        type: "OrderItem[]"
    actor: Customer
    handled_by: Order

policies:
  - name: SendConfirmationEmail
    description: Sends email when order is placed.
    when:
      events:
        - OrderPlaced
    then:
      commands:
        - NotifyCustomer

aggregates:
  - name: Order
    description: Manages order state and invariants.
    handles:
      - PlaceOrder
    emits:
      - OrderPlaced

read_models:
  - name: OrderSummary
    description: Read-optimized view of order details.
    subscribes_to:
      - OrderPlaced
    used_by:
      - Customer
```

## Step 4: Add Actors

Define the actors who interact with your domain in `.dkk/domain/actors.yml`:

```yaml
actors:
  - name: Customer
    type: human
    description: End user who places and tracks orders.
```

Actor types can be `human`, `system`, or `external`.

## Step 5: Run Quality Gates

Every change to domain files must pass validation before committing:

```bash
# Validate schema + cross-references
dkk validate

# Validate → render docs → rebuild search index
dkk render
```

Both commands must exit with code 0. The `render` command also generates Markdown documentation under `.dkk/docs/` and rebuilds the FTS5 search index.

## Step 6: Search and Explore

Once rendered, you can search and explore your domain:

```bash
# Full-text search
dkk search "order"

# Show a specific item
dkk show ordering.OrderPlaced

# Explore related items via graph traversal
dkk related ordering.Order

# List all items in a context
dkk list --context ordering
```

## Step 7: Add an ADR (Optional)

Architecture Decision Records document the *why* behind your domain design. Create `.dkk/adr/adr-0001.md`:

```markdown
---
id: adr-0001
title: Event Sourcing for Orders
status: proposed
date: 2026-02-21
domain_refs:
  - ordering.OrderPlaced
  - ordering.Order
---

## Context

We need to track the full history of order state changes...

## Decision

Adopt event sourcing for the ordering aggregate...

## Consequences

- Full audit trail of order changes
- Increased storage requirements
```

Then link back from domain items by adding `adr_refs`:

```yaml
events:
  - name: OrderPlaced
    description: Raised when a customer order is confirmed.
    adr_refs:
      - adr-0001
```

Run `dkk validate` and `dkk render` to verify the bidirectional links.

→ See [ADR Guide](adr-guide.md) for the full ADR workflow.

## What's Next?

- **[Domain Modeling Guide](domain-modeling.md)** — Learn about all item types, naming conventions, and cross-referencing rules.
- **[CLI Reference](cli-reference.md)** — Full command and flag reference.
- **[ADR Guide](adr-guide.md)** — Deep dive into Architecture Decision Records.
- **[AI Agent Integration](ai-agent-integration.md)** — Set up AI agents to understand and maintain your domain model.
