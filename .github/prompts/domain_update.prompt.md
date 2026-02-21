---
mode: agent
description: Apply a domain model change — generate YAML patches, suggest ADR updates, and run quality gates.
---

# Domain Update

You are a domain model maintainer. Given a change intent (e.g. "add a ReturnOrder command to the ordering context"), produce the necessary YAML edits, suggest ADR updates, and run quality gates.

## Steps

1. **Understand the intent** — Parse what needs to change:
   - New items to add (events, commands, policies, aggregates, read models, glossary terms, actors, flows).
   - Existing items to modify.
   - Items to remove or deprecate.
   - Which bounded context(s) are affected.

2. **Inspect current state** — Load the current definitions of affected items and their neighbours:
   ```bash
   npx tsx src/cli.ts show <id>
   npx tsx src/cli.ts related <id>
   npx tsx src/cli.ts list --context <name>
   ```

3. **Apply YAML changes** — Edit the appropriate files directly:

   - **New context:** Create `domain/contexts/<name>.yml` with the required structure and register it in `domain/index.yml` under `contexts`.
   - **New domain item:** Add the item to the correct array (`events`, `commands`, `policies`, `aggregates`, `read_models`, `glossary`) in the relevant `domain/contexts/<name>.yml`.
   - **New actor:** Add to `domain/actors.yml` under `actors`.
   - **New flow:** Add to `domain/index.yml` under `flows`.
   - **Modified item:** Edit the item in place, preserving all existing fields.
   - **Cross-references:** Update `handles`, `emits`, `triggers`, `subscribes_to`, `used_by`, `raised_by`, `handled_by`, `actor` on related items to maintain consistency.

4. **Maintain naming conventions:**
   - Item names: PascalCase (e.g. `OrderPlaced`, `PlaceOrder`).
   - Context names: kebab-case (e.g. `ordering`, `inventory-management`).
   - ADR ids: `adr-NNNN` with zero-padded 4-digit number.
   - Actor names: PascalCase (e.g. `Customer`, `PaymentGateway`).

5. **Suggest ADR updates** — If the change represents or affects an architectural decision:
   - Identify existing ADRs that should gain `domain_refs` to new items.
   - Suggest creating a new ADR if the change introduces a significant decision.
   - Add `adr_refs` to new or modified domain items pointing to relevant ADRs.

6. **Run quality gates** — After all edits:
   ```bash
   npx tsx src/cli.ts validate
   ```
   If validation passes:
   ```bash
   npx tsx src/cli.ts render
   ```
   If validation fails, fix the issues and re-validate.

## YAML Structure Reference

### Context File (`domain/contexts/<name>.yml`)

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
    adr_refs:
      - adr-0001
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

### Actors File (`domain/actors.yml`)

```yaml
actors:
  - name: Customer
    type: human
    description: End user who places and tracks orders.
```

### Index File (`domain/index.yml`)

```yaml
contexts:
  - name: ordering
    description: Handles customer order lifecycle.
flows:
  - name: OrderFulfillment
    description: End-to-end order processing flow.
    steps:
      - ref: ordering.PlaceOrder
        type: command
      - ref: ordering.OrderPlaced
        type: event
```

## Output Format

After applying changes, provide:

```markdown
## Domain Update Summary

### Changes Applied
- Added `ReturnOrder` command to ordering context
- Added `OrderReturned` event to ordering context
- Updated `Order` aggregate: added `ReturnOrder` to `handles`, `OrderReturned` to `emits`

### ADR Suggestions
- Consider adding `domain_refs: [ordering.ReturnOrder, ordering.OrderReturned]` to adr-0003 (Returns policy)

### Quality Gate Results
- ✅ Validation passed (0 errors, 0 warnings)
- ✅ Documentation rendered (12 files)
- ✅ Search index rebuilt
```

## Guidelines

- Always inspect the current state before making changes — never assume what exists.
- Preserve existing YAML structure and comments where possible.
- Every new event should have a `raised_by` pointing to its aggregate.
- Every new command should have a `handled_by` pointing to its aggregate.
- Update aggregate `handles` and `emits` arrays when adding commands/events.
- Run `validate` before `render` — never render an invalid model.
