---
description: Show blast radius for a DKK item — summary, depth-3 graph neighbours, and linked ADRs.
argument-hint: <item-id>
allowed-tools: mcp__dkk__summary, mcp__dkk__related, mcp__dkk__show, mcp__dkk__locate
---

Compute and present the blast radius of `$ARGUMENTS`.

1. Call `mcp__dkk__summary` with `id: $ARGUMENTS`. Report the item's name, kind, context, and one-line description.
2. Call `mcp__dkk__related` with `id: $ARGUMENTS` and `depth: 3`. Group results by kind.
3. From the summary, collect any `adr_refs`. For each, call `mcp__dkk__show` and report the ADR id, title, and status.
4. Call `mcp__dkk__locate` and report the absolute path(s) where this item is defined.

Format the output as:

```markdown
## Impact: <id>

**<name>** (<kind>, <context>) — <description>

### Source
- <absolute path>

### Direct neighbours (depth 1)
- <kind>: <id>, <id>, ...

### Extended blast radius (depth 2–3)
- <kind>: <id>, <id>, ...

### Linked ADRs
- <adr-id>: <title> (<status>)
```

If the id does not resolve, list the closest candidates from `mcp__dkk__list` or `mcp__dkk__search` and stop.
