---
mode: agent
description: Re-inject DKK agent context (domain principles, item types, CLI reference, current model summary). Use after compaction or topic drift.
---

Re-prime yourself with this project's Domain Knowledge Pack context.

- If the `dkk` MCP server is available, call its `prime` tool with default arguments and read the response.
- Otherwise run `dkk prime` in the terminal and read the output.

After loading, briefly confirm the number of contexts, items, and ADRs currently in the model. Do not summarize the prime content itself — the user just needs the agent re-primed.
