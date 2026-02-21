# AI Agent Integration

← [Back to README](../README.md)

Domain Knowledge Kit is designed to work with AI coding agents — giving them structured, queryable access to your domain model so they can make domain-aware decisions when writing, reviewing, or refactoring code.

## Why AI + Domain Models?

AI agents work better when they understand your business domain, not just your code. DKK provides:

- **Structured context** — Agents can query events, commands, aggregates, and their relationships instead of parsing unstructured documentation.
- **Referential integrity** — The validated YAML model ensures agents get accurate, consistent information.
- **Searchable knowledge** — Full-text search lets agents find relevant domain items quickly.
- **Graph traversal** — Agents can explore how domain items connect, discovering blast radius and dependencies.
- **Decision history** — ADRs give agents the *why* behind design choices, not just the *what*.

## Quick Setup

Two commands get your project ready for AI agents:

```bash
# 1. Add a DKK section to AGENTS.md (idempotent)
dkk init

# 2. Verify it works — output agent context to stdout
dkk prime
```

## `dkk init` — Agent Onboarding

`dkk init` creates or updates `AGENTS.md` with a DKK-specific section. The section is delimited by HTML comments (`<!-- dkk:start -->` / `<!-- dkk:end -->`), making the operation idempotent — re-running replaces only the DKK section without affecting other content.

The injected section tells AI agents:
- What DKK is and how to use it
- Available CLI commands for querying the domain
- Quality gates to run after domain changes

If `AGENTS.md` doesn't exist, it's created. If it already has a DKK section, it's updated in place.

## `dkk prime` — Full Agent Context

`dkk prime` outputs a comprehensive context document to stdout. It's designed to be consumed by AI agents at the start of a conversation or session, covering:

- Project overview and core principles
- Domain model structure (file paths, item types)
- Retrieval workflow (search → show → related → adr related)
- Change workflow (edit YAML → validate → render)
- ID conventions and naming rules
- Full CLI reference
- File conventions

Agents that run `dkk prime` get everything they need to understand and work with the domain model.

## Domain-First Retrieval

AI agents should query the domain model rather than guessing about business logic. Here's the recommended workflow:

### 1. Search

Find relevant domain items by keyword:

```bash
dkk search "order"
dkk search "payment" --context billing --type event
```

### 2. Show

Inspect a specific item's full definition:

```bash
dkk show ordering.OrderPlaced
dkk show actor.Customer
```

### 3. Explore Relationships

Discover connected items via graph traversal:

```bash
dkk related ordering.Order --depth 2
```

This reveals which commands an aggregate handles, which events it emits, which policies react to those events, and which read models subscribe to them.

### 4. Check ADR Links

Find architecture decisions connected to a domain item:

```bash
dkk adr related ordering.OrderPlaced
```

### 5. List Items

Get an overview of what's defined:

```bash
dkk list --context ordering
dkk list --type event
```

## Domain-Aware Changes

When AI agents modify domain YAML files, they should follow this workflow:

1. **Inspect current state** — Use `show` and `related` to understand what exists.
2. **Edit YAML files directly** — Add or modify items in the appropriate files.
3. **Maintain referential integrity** — Update cross-references (`handles`, `emits`, `raised_by`, `handled_by`, `actor`, `subscribes_to`, `used_by`).
4. **Update ADR links** — If the change affects an architectural decision, update `adr_refs` on domain items and `domain_refs` in ADR frontmatter.
5. **Run quality gates:**
   ```bash
   dkk validate
   dkk render
   ```

## GitHub Copilot Integration

DKK includes a Copilot instructions file at `.github/copilot-instructions.md` that configures GitHub Copilot to:

- Treat domain YAML as the single source of truth
- Use domain-first retrieval (search → show → related) when answering domain questions
- Maintain referential integrity when editing domain files
- Run quality gates after changes

This file is automatically picked up by GitHub Copilot in VS Code and on GitHub.

## Reusable Prompts

The `.github/prompts/` directory contains reusable prompt files for common domain workflows:

| Prompt | Purpose |
|--------|---------|
| `domain_search.prompt.md` | Search the domain model, show results with ADR links |
| `domain_update.prompt.md` | Apply domain changes with YAML patches and quality gates |
| `domain_change_review.prompt.md` | Review changes for domain impact, blast radius, and ADR effects |
| `start-ready-task.prompt.md` | Pick up and start a ready task from the issue tracker |

These prompts work with GitHub Copilot's agent mode and other AI tools that support prompt files.

## Portable Agent Skill

For agent frameworks that support skills, DKK provides a portable skill definition at `.github/skills/domain-knowledge/skill.md`. This skill teaches any AI agent:

- The canonical domain model structure
- All item types and their fields
- ID conventions
- Retrieval and update rules
- Validation checks

## What Agents Can Do

With DKK integration, AI agents can:

- **Answer domain questions** — "What events does the Order aggregate emit?" → `dkk related ordering.Order`
- **Check impact** — "What would break if I rename OrderPlaced?" → `dkk related ordering.OrderPlaced --depth 2`
- **Find decisions** — "Why do we use event sourcing?" → `dkk search "event sourcing" --type adr`
- **Make changes** — Add new events/commands/policies with proper cross-references and ADR links
- **Review PRs** — Identify domain items affected by code changes and flag broken invariants

## What's Next?

- **[Getting Started](getting-started.md)** — Set up your first domain model.
- **[Domain Modeling Guide](domain-modeling.md)** — Item types, naming conventions, cross-references.
- **[CLI Reference](cli-reference.md)** — Full command and flag reference.
- **[ADR Guide](adr-guide.md)** — Architecture Decision Records workflow.
