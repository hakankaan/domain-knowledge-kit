# Iterative Domain Modeling

← [Back to README](../README.md)

A guide to the thought process behind building and evolving a domain model with DKK. This isn't about YAML syntax — it's about **when to model what**, **how much detail is enough**, and **how external constraints shape your domain** without polluting it.

## The Litmus Test

Before adding anything to your domain model, ask:

> **"Would changing this decision change the domain items?"**

- **Yes** → It belongs in the domain YAML (events, commands, aggregates, policies, read models, actors).
- **It constrains how items get implemented** → It belongs in an ADR, linked via `adr_refs` / `domain_refs`.
- **It only matters to a specific delivery mechanism** (UI framework, API format, deployment topology) → It's out of scope for the domain model entirely.

This single question prevents two common mistakes: under-modeling (missing business concepts that should be explicit) and over-modeling (cramming implementation details into domain YAML).

## Modeling Phases

Domain modeling is not a one-shot activity. It works best as an iterative loop that deepens over time.

### Phase 1: Core Domain (Business Reality)

Start from business knowledge. Ask **"what does the business do?"** — not "what can our systems do?"

1. Identify the bounded contexts — the major areas of responsibility.
2. Name the key events — the facts the business cares about (`OrderPlaced`, `PaymentReceived`, `ShipmentDelivered`).
3. Name the commands — the actions actors take (`PlaceOrder`, `ProcessPayment`).
4. Identify the actors — who or what initiates these commands.
5. Sketch the aggregates — the consistency boundaries that handle commands and emit events.

At this stage, descriptions can be brief. Cross-references don't need to be complete. The goal is to establish the **vocabulary** — the ubiquitous language your team will use.

```bash
dkk new domain
dkk new context ordering
dkk add event OrderPlaced --context ordering
dkk add command PlaceOrder --context ordering
dkk add aggregate Order --context ordering
dkk add actor Customer --actor-type human
```

**Quality check:** `dkk validate` should pass. Orphaned items are fine at this stage — you're building the skeleton.

### Phase 2: Relationships and Policies

Now connect the pieces and add reactive behavior.

1. Wire `raised_by` / `handled_by` on events and commands to their aggregates.
2. Wire `handles` / `emits` on aggregates.
3. Add policies — "when X happens, do Y." These often reveal missing commands and events.
4. Add read models — what information do actors need to see? Wire `subscribes_to` and `used_by`.
5. Fill in `fields` on events, commands, and read models — the data each carries.

Policies are where complexity surfaces. Each policy is a potential failure point, retry path, or cross-context interaction. Don't skip them.

```bash
dkk add policy SendConfirmationEmail --context ordering
# Then edit the YAML to wire when.events and then.commands
dkk render
```

**Quality check:** `dkk stats` should show decreasing orphan count. `dkk validate` catches broken cross-references.

### Phase 3: External Constraints

This is where integration knowledge enters. **The core domain drives; external systems constrain.**

1. Add external actors with `type: external` — payment gateways, email services, shipping APIs.
2. Record their `capabilities` — what can the external system actually do, expressed in domain language? ("Authorize payments", "Issue refunds", "Track shipments")
3. Record their `failure_modes` — how can the external system fail? ("Gateway timeout", "Rate limit exceeded", "Invalid credentials")
4. Let these constraints surface new domain items:
   - A failure mode often creates a failure event (`PaymentFailed`) and a retry policy (`RetryPayment`).
   - A missing capability forces a workaround that becomes a new flow.
   - An async-only capability creates callback events and handler policies.

```yaml
# .dkk/domain/actors.yml
actors:
  - name: PaymentGateway
    type: external
    description: Third-party payment processor.
    capabilities:
      - Authorize payments
      - Capture authorized payments
      - Issue full refunds
    failure_modes:
      - Gateway timeout
      - Insufficient funds
      - Card declined
```

**The key insight:** Capabilities and failure modes are recorded on actors because they are **leading indicators of domain item changes.** When the payment gateway adds partial refund support, you'll likely add a `PartialRefund` command. When a new failure mode appears, you'll likely add a rejection on a command or a new policy. Recording these close to the actor makes the connection visible.

**Quality check:** For each external actor, ask: "Do we have events and policies for its failure modes?" If not, the model is incomplete.

### Phase 4: Architectural Decisions

Technical choices that constrain implementation belong in ADRs.

1. Create ADRs for significant decisions: sync vs. async communication, persistence strategy, consistency guarantees.
2. Link ADRs to the domain items they affect via `domain_refs` and `adr_refs`.
3. When a decision changes the domain shape (e.g., introducing a saga pattern adds compensation events), update both the ADR and the domain items in the same PR.

```bash
dkk new adr "Async payment processing via webhooks"
# Edit the ADR, then link it:
# domain_refs: [ordering.ProcessPayment, ordering.PaymentCallbackReceived]
dkk render
```

**Quality check:** `dkk stats` shows ADR linkage percentage. Aim for critical aggregates and policies to have at least one `adr_ref`.

### Phase 5: Flows and Stories

Once the model is connected, define cross-context flows and derive user stories.

1. Define flows in `index.yml` — ordered sequences of steps that span contexts.
2. Use `dkk story <flow-id>` to aggregate the full context for story generation.
3. Stories map directly to the model: actor → "As a", command → "I want to", flow description → "So that".

Flows often reveal gaps: missing steps, undefined policies, actors without commands. That's the point — they're an integration test for your model.

## What Belongs Where

| Question | If Yes → | If No → |
|---|---|---|
| Can you express it using only domain language (actors, events, commands, business rules)? | Domain YAML | ADR or out of scope |
| Does it constrain which domain items exist or how they relate? | Domain YAML | ADR |
| Does it constrain how domain items get *implemented*? | ADR with `domain_refs` | Out of scope |
| Does it only matter to a specific delivery mechanism (UI, API, CLI)? | Out of scope | — |
| Would changing this decision change the domain items? | ADR (tightly linked) | ADR (loosely linked) or nothing |

### Examples

| Concept | Where it belongs | Why |
|---|---|---|
| "Order can only be cancelled before shipping" | Domain YAML — aggregate invariant or command precondition | Business rule expressed in domain language |
| "We use PostgreSQL for persistence" | ADR | Implementation choice; doesn't change what events exist |
| "Payment gateway supports partial refunds" | Domain YAML — actor `capabilities` | May create new commands/events |
| "Read model must reflect changes within 500ms" | ADR linked to the read model | Non-functional requirement; doesn't change what data the model exposes |
| "REST API uses JSON:API format" | Out of scope | Delivery mechanism detail |
| "Payment callback is async via webhooks" | ADR + domain items (callback event, handler policy) | The async nature creates new domain behavior |

## Decision Patterns

### Is This a Domain Event or an Infrastructure Event?

**Domain event:** Something the business cares about. If a non-technical stakeholder would understand and care about it, it's a domain event.
- `OrderPlaced` ✓ — the business cares
- `PaymentReceived` ✓ — the business cares
- `ShipmentDelivered` ✓ — the business cares

**Infrastructure event:** Something only the system cares about.
- `DatabaseMigrated` ✗ — not a domain event
- `CacheInvalidated` ✗ — not a domain event
- `DeploymentCompleted` ✗ — not a domain event

**Gray area:** `UserLoggedIn` — depends on the domain. For an authentication platform, it's a domain event. For an e-commerce system, it's probably infrastructure.

### How Much Detail in Fields?

Fields on events, commands, and read models should use **domain-level types**, not implementation types.

| Do | Don't |
|---|---|
| `orderId (UUID)` | `orderId (varchar(36))` |
| `totalAmount (Money)` | `totalAmount (decimal(10,2))` |
| `items (OrderItem[])` | `items (jsonb)` |
| `shippingAddress (Address)` | `shippingAddress (text)` |

The fields describe **what information flows**, not how it's stored. When the storage format changes, the domain model shouldn't need to change.

### One Aggregate or Two?

If two pieces of state must change atomically (in the same transaction), they belong in the same aggregate. If they can change independently, they're separate aggregates.

- Can an order be placed without immediately reserving inventory? → Separate aggregates (`Order`, `Inventory`), connected by a policy.
- Can an order line item change without affecting the order total? → Probably the same aggregate (`Order`), since the total is an invariant.

When in doubt, start with separate aggregates and merge if you discover invariants that cross the boundary. Splitting later is harder than merging.

### Read Model Fields vs. Event Fields

Read model fields describe **what the actor sees** — the projection. Event fields describe **what happened**. They often overlap but aren't identical:

- An `OrderSummary` read model might show `customerName` which comes from a `CustomerRegistered` event in a different context.
- An `OrderPlaced` event carries `customerId` but the read model resolves it to a display name.

Model read model fields at the **information-need level**: what does the actor need to see and act on?

### External Capability → Domain Command

When an external actor gains or loses a capability, ask: does this create or remove a command in our domain?

| External change | Domain impact |
|---|---|
| Payment gateway adds partial refunds | New command: `IssuePartialRefund` |
| Shipping API drops same-day delivery | Remove or deprecate `ScheduleSameDayShipment` |
| Email service adds delivery tracking | New event: `EmailDeliveryConfirmed`, new read model: `NotificationStatus` |

This is why `capabilities` on actors matter — they're the early-warning system for domain model changes.

### When to Write an ADR vs. When to Model

| Situation | Action |
|---|---|
| "We need a new business event." | Add it to domain YAML |
| "We chose PostgreSQL over MongoDB." | Write an ADR |
| "We need to handle payment failures." | Add events + policies to domain YAML, plus an ADR if the retry strategy is architecturally significant |
| "We're using REST instead of GraphQL." | Write an ADR |
| "The read model must be real-time." | Write an ADR linked to the read model |
| "We need a new actor to represent the mobile app." | Add it to domain YAML |

## Anti-Patterns

### Modeling the API, Not the Domain

**Symptom:** Commands are named `CreateOrder`, `UpdateOrder`, `DeleteOrder` (CRUD).

**Fix:** Use intention-revealing names: `PlaceOrder`, `CancelOrder`, `AmendOrderAddress`. What business action is the actor performing?

### Premature Technical Modeling

**Symptom:** The domain model includes `MessageQueue`, `DatabaseConnection`, `CacheLayer` as actors or aggregates.

**Fix:** These are infrastructure. Model the business actors (`Customer`, `WarehouseManager`) and the business aggregates (`Order`, `Shipment`). Infrastructure choices go in ADRs.

### Ignoring External Failure Modes

**Symptom:** The model has a `ProcessPayment` command and a `PaymentReceived` event but no handling for what happens when the payment gateway fails.

**Fix:** For each external actor, review its `failure_modes` and ensure corresponding events, policies, or command rejections exist.

### Over-Specifying Read Models

**Symptom:** Read models describe UI layout or API response shapes (`OrderListPageViewModel`, `OrderApiV2Response`).

**Fix:** Name read models by the information need: `OrderSummary`, `InventoryDashboard`, `CustomerOrderHistory`. They describe what the actor needs to see, not how it's rendered.

### Modeling Everything Before Writing Code

**Symptom:** The team spends weeks modeling before writing a line of code. The model is elaborate but untested.

**Fix:** Model incrementally. Start with Phase 1 (core events, commands, actors), implement something, then deepen the model as you discover complexity. The model and the code evolve together — each PR should update both when business behavior changes.

## What's Next?

- **[Domain Modeling Guide](domain-modeling.md)** — YAML structure, item types, naming conventions.
- **[ADR Guide](adr-guide.md)** — Writing and linking Architecture Decision Records.
- **[Way of Working](way-of-working.md)** — Team adoption practices, PR review, CI integration.
- **[AI Agent Integration](ai-agent-integration.md)** — Set up AI agents to query your domain model.
