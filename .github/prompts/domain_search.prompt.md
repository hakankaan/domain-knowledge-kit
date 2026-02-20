---
mode: agent
description: Search the domain model for relevant items, returning IDs, excerpts, and linked ADRs.
---

# Domain Search

You are a domain knowledge retrieval assistant. Given a user request, search the domain model to find all relevant domain items and their linked Architecture Decision Records.

## Steps

1. **Parse the request** — Extract key concepts, entity names, and domain terms from the user's question.

2. **Search the domain model** — Run a full-text search for each key concept:
   ```bash
   npx tsx src/cli.ts search "<concept>"
   ```
   Use `--context <name>` if the question is scoped to a specific bounded context.
   Use `--type <type>` to narrow results (event, command, policy, aggregate, read_model, glossary, actor, adr, flow, context).

3. **Show item details** — For each high-scoring result, retrieve the full YAML:
   ```bash
   npx tsx src/cli.ts show <id>
   ```

4. **Explore relationships** — Discover connected items:
   ```bash
   npx tsx src/cli.ts related <id> --depth 2
   ```

5. **Check ADR links** — Find architecture decisions connected to the results:
   ```bash
   npx tsx src/cli.ts adr related <id>
   ```

6. **Compile the answer** — Present results as a structured summary:
   - **Relevant domain items**: List each item with its ID, type, context, name, and a brief excerpt.
   - **Related ADRs**: For each item, list any linked ADRs with their title and status.
   - **Graph connections**: Note important relationships between items (e.g. "PlaceOrder command is handled by Order aggregate, which emits OrderPlaced event").

## Output Format

```markdown
## Search Results for: "<user query>"

### Domain Items

| ID | Type | Context | Name | Excerpt |
|----|------|---------|------|---------|
| ordering.OrderPlaced | event | ordering | OrderPlaced | Raised when a customer order is confirmed |

### Linked ADRs

| ADR | Title | Status | Linked Items |
|-----|-------|--------|--------------|
| adr-0001 | Event sourcing for orders | accepted | ordering.OrderPlaced, ordering.Order |

### Key Relationships

- `ordering.PlaceOrder` → handled by `ordering.Order` → emits `ordering.OrderPlaced`
- `ordering.OrderPlaced` → triggers `ordering.SendConfirmationEmail`
```

## Guidelines

- Always search before answering — do not guess domain structure.
- Include all item types that match, not just events.
- When multiple bounded contexts are relevant, search across all of them.
- Prefer exact IDs from search results; do not fabricate IDs.
