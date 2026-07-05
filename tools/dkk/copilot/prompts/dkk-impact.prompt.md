---
mode: agent
description: Show blast radius for a DKK item — summary, depth-3 graph neighbours, and linked ADRs.
---

Compute and present the blast radius of the DKK item the user names. If they did not provide an item id, ask for one (or list candidates via the `dkk` `list`/`search` tools) before proceeding.

Prefer the `dkk` MCP tools; fall back to the `dkk` CLI (shown in parentheses) if the server is unavailable.

1. `summary` (`dkk summary <id>`) — report the item's name, kind, context, and one-line description.
2. `related` with `depth: 3` (`dkk related <id> --depth 3`) — group results by kind.
3. From the summary, collect any `adr_refs`. For each, `show` (`dkk show <adr-id>`) and report the ADR id, title, and status.
4. `locate` (`dkk show <id>`) — report the absolute path(s) where this item is defined.

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

If the id does not resolve, list the closest candidates from `list`/`search` and stop.
