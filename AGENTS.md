# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

## Domain Model

**Domain YAML is the single source of truth.** Never generate domain knowledge from code. To update the domain model, ALWAYS use the DKK CLI commands (e.g. `dkk add`, `dkk rename`, `dkk rm`). Do not manually edit the underlying YAML files directly.

### Key Conventions

- YAML files use `.yml` extension
- Item names are PascalCase (events, commands, etc.); contexts and ADR ids are kebab-case
- ADRs live in `.dkk/adr/` as Markdown with YAML frontmatter
- ADRs link to domain items via `domain_refs`; domain items link back via `adr_refs`
- Generated docs go to `.dkk/docs/` — never edit by hand

### Domain CLI Commands

Use `npx tsx src/cli.ts` during development (or `dkk` after build):

```bash
# Query
npx tsx src/cli.ts list                              # List all domain items (--context, --type filters)
npx tsx src/cli.ts show <id>                         # Display full YAML of a domain item
npx tsx src/cli.ts summary <id>                      # Concise item summary with direct relations (AI-optimized)
npx tsx src/cli.ts search "<query>"                  # FTS5 full-text search with ranking
npx tsx src/cli.ts related <id>                      # BFS graph traversal of related items
npx tsx src/cli.ts graph                             # Generate Mermaid.js flowchart of domain model

# Pipeline
npx tsx src/cli.ts validate                          # Schema + cross-reference validation
npx tsx src/cli.ts render                            # Validate → render docs → rebuild search index

# ADR

# Scaffold
npx tsx src/cli.ts new domain                        # Scaffold a complete .dkk/domain/ structure
npx tsx src/cli.ts new context <name>                # Scaffold a new bounded context
npx tsx src/cli.ts new adr "<title>"                 # Scaffold a new ADR file (auto-increments number)
npx tsx src/cli.ts add <type> <name> --context <ctx> # Scaffold an individual domain item

# Refactor
npx tsx src/cli.ts rename <old-id> <new-id>          # Rename item and update all references
npx tsx src/cli.ts rm <id>                           # Remove item safely (aliases: remove, delete)

# Audit
npx tsx src/cli.ts stats                             # Domain model statistics + orphaned items

# Agent
npx tsx src/cli.ts init                              # Create/update AGENTS.md with DKK section
npx tsx src/cli.ts prime                             # Output full agent context to stdout
```

### Quality Gates

**When domain files change**, run this before committing:

```bash
npx tsx src/cli.ts render    # Validates → renders docs → rebuilds search index
```

Must exit 0. The `render` command validates automatically — no need to run `validate` separately.

For a quick validation-only check (no rendering), use `npx tsx src/cli.ts validate`.


<!-- dkk:start -->
## Domain Knowledge Kit

This project uses a structured, YAML-based domain model managed by **dkk** (Domain Knowledge Kit).

Run `dkk prime` to get full agent context including domain structure, CLI commands, and workflows.

### 🚫 No Manual YAML Edits

**Domain YAML is the single source of truth.** To update the domain model, ALWAYS use the DKK CLI commands (e.g. `dkk add`, `dkk rename`, `dkk rm`). Do not manually edit the underlying YAML files directly.

### 🏛️ Prioritize ADRs

**Always consult Architecture Decision Records.** Before proposing architectural refactors, making tech choices, or modifying domain logic, use `dkk search "your topic"` or `dkk show <id>` to understand existing constraints and decisions.

### Quick Reference

```bash
# Query
dkk list                              # List all domain items (--context, --type filters)
dkk show <id>                         # Display full YAML of a domain item
dkk summary <id>                      # Concise item summary (AI-optimized)
dkk search "<query>"                  # Full-text search
dkk related <id>                      # Graph traversal of related items
dkk graph                             # Mermaid.js flowchart (--layout LR|TD, --node-types ...)

# Pipeline
dkk validate                          # Schema + cross-reference validation
dkk render                            # Validate, render docs, rebuild search index

# ADR
dkk show <id>                     # Display ADR frontmatter
dkk related <id>                  # Bidirectional ADR ↔ domain links

# Scaffold
dkk new domain                        # Scaffold .dkk/domain/ structure
dkk new context <name>                # Scaffold a new bounded context
dkk new adr "<title>"                 # Scaffold a new ADR file
dkk add <type> <name> --context <ctx> # Scaffold an individual domain item

# Refactor
dkk rename <old-id> <new-id>          # Rename item and update all references
dkk rm <id>                           # Remove item safely

# Audit
dkk stats                             # Domain statistics + orphaned items

# Agent
dkk init                              # Create/update AGENTS.md with DKK section
dkk prime                             # Output full agent context
```

### Quality Gates

Before committing domain changes, run:

```bash
dkk render              # Validates → renders docs → rebuilds search index
```

`dkk validate` is available as a quick dry-run check (no rendering).
<!-- dkk:end -->
