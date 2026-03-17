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
      <name>/              # One directory per bounded context
        context.yml        #   Context metadata (name, description, glossary)
        events/            #   One .yml file per domain event
        commands/          #   One .yml file per command
        aggregates/        #   One .yml file per aggregate
        policies/          #   One .yml file per policy
        read-models/       #   One .yml file per read model
  adr/                     # Architecture Decision Records
  docs/                    # Generated documentation (do not edit)

tools/
  dkk/
    schema/              # JSON Schemas for YAML validation
    templates/           # Handlebars templates for doc generation
```

## Step 1: Initialize the Domain structure

Set up the base DKK directory structure:

```bash
dkk new domain
```

This will create `.dkk/domain/index.yml`, `.dkk/domain/actors.yml`, and initialize the `contexts/` directory.

## Step 2: Create a Bounded Context

Use the CLI to scaffold a new bounded context. This will create the necessary directory structure and its metadata file, and also automatically register it in `index.yml`:

```bash
dkk new context ordering
```

This ensures `.dkk/domain/contexts/ordering/` exists with all empty subdirectories, and updates `index.yml` correctly.

## Step 3: Add Domain Items

Instead of creating YAML files manually, the `dkk add` command scaffolds them with the correct schema and boilerplates.

**Add a glossary** — update `.dkk/domain/contexts/ordering/context.yml`:

```yaml
name: ordering
description: Handles customer order lifecycle.
glossary:
  - term: Order
    definition: A customer's request to purchase items.
```

**Add an event**:

```bash
dkk add event OrderPlaced --context ordering
```

Update `.dkk/domain/contexts/ordering/events/OrderPlaced.yml`:

```yaml
name: OrderPlaced
description: Raised when a customer order is confirmed.
fields:
  - name: orderId
    type: UUID
  - name: customerId
    type: UUID
raised_by: Order
```

**Add a command**:

```bash
dkk add command PlaceOrder --context ordering
```

Update `.dkk/domain/contexts/ordering/commands/PlaceOrder.yml`:

```yaml
name: PlaceOrder
description: Submit a new customer order.
fields:
  - name: items
    type: "OrderItem[]"
actor: Customer
handled_by: Order
```

**Add a policy**:

```bash
dkk add policy SendConfirmationEmail --context ordering
```

Update `.dkk/domain/contexts/ordering/policies/SendConfirmationEmail.yml`:

```yaml
name: SendConfirmationEmail
description: Sends email when order is placed.
when:
  events:
    - OrderPlaced
then:
  commands:
    - NotifyCustomer
```

**Add an aggregate**:

```bash
dkk add aggregate Order --context ordering
```

Update `.dkk/domain/contexts/ordering/aggregates/Order.yml`:

```yaml
name: Order
description: Manages order state and invariants.
handles:
  commands:
    - PlaceOrder
emits:
  events:
    - OrderPlaced
```

**Add a read model**:

```bash
dkk add read-model OrderSummary --context ordering
```

Update `.dkk/domain/contexts/ordering/read-models/OrderSummary.yml`:

```yaml
name: OrderSummary
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
# Validates → renders docs → rebuilds search index (single quality gate command)
dkk render
```

Must exit with code 0. The `render` command validates the model automatically, generates Markdown documentation under `.dkk/docs/`, and rebuilds the FTS5 search index.

For a quick validation-only check (without rendering), use `dkk validate`.

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

Architecture Decision Records document the *why* behind your domain design. Scaffold a new ADR:

```bash
dkk new adr "Event Sourcing for Orders"
```

This will create an ADR template in `.dkk/adr/adr-0001.md`. Open it and add your details:

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

Then link back from domain items by adding `adr_refs` to the item file (e.g. `.dkk/domain/contexts/ordering/events/OrderPlaced.yml`):

```yaml
name: OrderPlaced
description: Raised when a customer order is confirmed.
raised_by: Order
adr_refs:
  - adr-0001
```

Run `dkk render` to verify the bidirectional links.

→ See [ADR Guide](adr-guide.md) for the full ADR workflow.

## What's Next?

- **[Domain Modeling Guide](domain-modeling.md)** — Learn about all item types, naming conventions, and cross-referencing rules.
- **[CLI Reference](cli-reference.md)** — Full command and flag reference.
- **[ADR Guide](adr-guide.md)** — Deep dive into Architecture Decision Records.
- **[AI Agent Integration](ai-agent-integration.md)** — Set up AI agents to understand and maintain your domain model.
