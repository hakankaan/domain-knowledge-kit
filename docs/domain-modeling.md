# Domain Modeling Guide

← [Back to README](../README.md)

Domain Knowledge Kit uses a structured, YAML-based domain model rooted in Domain-Driven Design (DDD) patterns. This guide explains every item type, how they connect, and the conventions that keep your model consistent.

## Core Concepts

Your domain model is organized into **bounded contexts** — self-contained areas of business logic. Each context contains domain items (events, commands, policies, aggregates, read models, glossary terms) that describe what happens in that part of the system.

**Actors** represent people or systems that interact with your domain. **Flows** describe cross-context sequences of steps. **ADRs** document the architectural decisions behind your design choices.

## Item Types

### Events

An **event** records something that happened in the domain — a fact that cannot be undone.

File: `.dkk/domain/contexts/<context>/events/OrderPlaced.yml`

```yaml
name: OrderPlaced
description: Raised when a customer order is confirmed.
fields:
  - name: orderId
    type: UUID
  - name: customerId
    type: UUID
  - name: totalAmount
    type: Money
raised_by: Order        # Which aggregate produces this event
adr_refs:
  - adr-0001            # Link to relevant ADRs
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | PascalCase, past tense (e.g. `OrderPlaced`, `PaymentReceived`) |
| `description` | Yes | What this event represents |
| `fields` | No | Data carried by the event |
| `raised_by` | No | The aggregate that emits this event |
| `adr_refs` | No | List of ADR IDs linked to this event |

### Commands

A **command** is an instruction to change domain state — a request that may succeed or fail.

File: `.dkk/domain/contexts/<context>/commands/PlaceOrder.yml`

```yaml
name: PlaceOrder
description: Submit a new customer order.
fields:
  - name: items
    type: "OrderItem[]"
  - name: shippingAddress
    type: Address
actor: Customer          # Who initiates this command
handled_by: Order        # Which aggregate processes it
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | PascalCase, imperative (e.g. `PlaceOrder`, `CancelShipment`) |
| `description` | Yes | What this command does |
| `fields` | No | Data required to execute the command |
| `actor` | No | The actor who initiates this command |
| `handled_by` | No | The aggregate that handles this command |
| `adr_refs` | No | List of ADR IDs |

### Aggregates

An **aggregate** is a consistency boundary — a cluster of domain objects treated as a unit for state changes.

File: `.dkk/domain/contexts/<context>/aggregates/Order.yml`

```yaml
name: Order
description: Manages order state and invariants.
handles:
  commands:
    - PlaceOrder
    - CancelOrder
emits:
  events:
    - OrderPlaced
    - OrderCancelled
adr_refs:
  - adr-0001
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | PascalCase noun (e.g. `Order`, `Account`) |
| `description` | Yes | What this aggregate manages |
| `handles.commands` | No | Commands this aggregate processes |
| `emits.events` | No | Events this aggregate produces |
| `invariants` | No | Business invariants enforced by this aggregate |
| `adr_refs` | No | List of ADR IDs |

### Policies

A **policy** is reactive logic — "when X happens, do Y." Policies listen for events and trigger commands.

File: `.dkk/domain/contexts/<context>/policies/SendConfirmationEmail.yml`

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

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | PascalCase (e.g. `SendConfirmationEmail`) |
| `description` | Yes | What this policy does |
| `when.events` | Yes | Events that trigger this policy |
| `then.commands` | Yes | Commands executed in response |
| `adr_refs` | No | List of ADR IDs |

### Read Models

A **read model** is a query-optimized projection built from events — used for displaying data without going through aggregates.

File: `.dkk/domain/contexts/<context>/read-models/OrderSummary.yml`

```yaml
name: OrderSummary
description: Read-optimized view of order details.
subscribes_to:
  - OrderPlaced
  - OrderCancelled
used_by:
  - Customer
  - SupportAgent
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | PascalCase (e.g. `OrderSummary`, `InventoryDashboard`) |
| `description` | Yes | What this read model shows |
| `subscribes_to` | No | Events this read model listens to |
| `used_by` | No | Actors that consume this read model |
| `adr_refs` | No | List of ADR IDs |

### Glossary Terms

**Glossary** terms define the ubiquitous language of your bounded context — ensuring everyone uses the same words to mean the same things. Glossary entries are defined in `context.yml`.

File: `.dkk/domain/contexts/<context>/context.yml` (glossary section)

```yaml
name: ordering
description: Handles customer order lifecycle.
glossary:
  - term: Order
    definition: A customer's request to purchase one or more items.
    aliases:
      - Purchase
      - Transaction
```

| Field | Required | Description |
|-------|----------|-------------|
| `term` | Yes | PascalCase term name |
| `definition` | Yes | Clear, concise definition |
| `aliases` | No | Alternative names for the same concept |
| `adr_refs` | No | List of ADR IDs |

### Actors

**Actors** are people, systems, or external services that interact with your domain. They are defined globally in `.dkk/domain/actors.yml`.

```yaml
actors:
  - name: Customer
    type: human
    description: End user who places and tracks orders.
  - name: PaymentGateway
    type: external
    description: Third-party payment processor.
  - name: InventoryService
    type: system
    description: Internal service managing stock levels.
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | PascalCase (e.g. `Customer`, `PaymentGateway`) |
| `type` | Yes | One of: `human`, `system`, `external` |
| `description` | Yes | What this actor does in the domain |
| `adr_refs` | No | List of ADR IDs |

### Flows

**Flows** describe cross-context sequences of steps — useful for documenting end-to-end processes that span multiple bounded contexts.

```yaml
flows:
  - name: OrderFulfillment
    description: End-to-end order processing flow.
    steps:
      - ref: ordering.PlaceOrder
        type: command
      - ref: ordering.OrderPlaced
        type: event
      - ref: shipping.ScheduleShipment
        type: command
      - ref: shipping.ShipmentScheduled
        type: event
```

Flows are defined in `.dkk/domain/index.yml` alongside context registrations.

## Cross-References

Domain items connect to each other through explicit references. These references form a graph that DKK validates and traverses:

| Reference Field | On Item Types | Points To |
|----------------|---------------|-----------|
| `raised_by` | Events | Aggregate name (same context) |
| `handled_by` | Commands | Aggregate name (same context) |
| `actor` | Commands | Actor name (from `actors.yml`) |
| `handles.commands` | Aggregates | Command names (same context) |
| `emits.events` | Aggregates | Event names (same context) |
| `when.events` | Policies | Event names (same context) |
| `then.commands` | Policies | Command names (same context) |
| `subscribes_to` | Read Models | Event names (same context) |
| `used_by` | Read Models | Actor names (from `actors.yml`) |
| `adr_refs` | All items | ADR IDs (from `.dkk/adr/`) |
| `domain_refs` | ADRs | Domain item IDs (`<context>.<Name>`) |

**Referential integrity is enforced.** Running `dkk validate` checks that every reference resolves to an existing item. Dangling references produce validation errors.

### Example: How Items Connect

```
Customer (actor)
    │
    ▼ initiates
PlaceOrder (command)
    │
    ▼ handled_by
Order (aggregate)
    │
    ▼ emits
OrderPlaced (event)
    │
    ├──▶ SendConfirmationEmail (policy) ──▶ NotifyCustomer (command)
    │
    └──▶ OrderSummary (read_model) ──▶ used_by Customer
```

## ID Conventions

Every domain item has a unique ID used for lookups, cross-references, and CLI commands:

| Item Type | Format | Example |
|-----------|--------|---------|
| Context item | `<context>.<ItemName>` | `ordering.OrderPlaced` |
| Actor | `actor.<Name>` | `actor.Customer` |
| ADR | `adr-NNNN` | `adr-0001` |
| Flow | `flow.<Name>` | `flow.OrderFulfillment` |
| Context | `context.<name>` | `context.ordering` |

## Naming Conventions

| Element | Convention | Examples |
|---------|-----------|----------|
| Item names | PascalCase | `OrderPlaced`, `PlaceOrder`, `Order` |
| Context names | kebab-case | `ordering`, `inventory-management` |
| ADR IDs | `adr-NNNN` (zero-padded) | `adr-0001`, `adr-0042` |
| YAML files | `.yml` extension | `context.yml`, `OrderPlaced.yml`, `actors.yml` |

## File Layout

| File | Purpose |
|------|---------|
| `.dkk/domain/index.yml` | Register bounded contexts and define cross-context flows |
| `.dkk/domain/actors.yml` | Define global actors |
| `.dkk/domain/contexts/<name>/context.yml` | Context metadata (name, description, glossary) |
| `.dkk/domain/contexts/<name>/events/*.yml` | One file per domain event |
| `.dkk/domain/contexts/<name>/commands/*.yml` | One file per command |
| `.dkk/domain/contexts/<name>/aggregates/*.yml` | One file per aggregate |
| `.dkk/domain/contexts/<name>/policies/*.yml` | One file per policy |
| `.dkk/domain/contexts/<name>/read-models/*.yml` | One file per read model |
| `.dkk/adr/adr-NNNN.md` | Architecture Decision Records |
| `.dkk/docs/` | Generated documentation (do not edit) |
| `tools/dkk/schema/` | JSON Schemas for YAML validation |
| `tools/dkk/templates/` | Handlebars templates for doc generation |

## Quality Gates

After every change to domain YAML files, run:

```bash
dkk validate    # Schema + cross-reference checks
dkk render      # Validate → render docs → rebuild search index
```

Both must exit with code 0 before committing.

## What's Next?

- **[Getting Started](getting-started.md)** — Set up your first project step by step.
- **[CLI Reference](cli-reference.md)** — Full command and flag reference.
- **[ADR Guide](adr-guide.md)** — Architecture Decision Records workflow.
- **[AI Agent Integration](ai-agent-integration.md)** — Set up AI agents to query and maintain your domain model.
