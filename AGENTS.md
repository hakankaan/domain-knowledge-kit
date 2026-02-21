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

**Domain YAML is the single source of truth.** Never generate domain knowledge from code; always read and edit the YAML files under `domain/`.

### Key Conventions

- YAML files use `.yml` extension
- Item names are PascalCase (events, commands, etc.); contexts and ADR ids are kebab-case
- ADRs live in `docs/adr/` as Markdown with YAML frontmatter
- ADRs link to domain items via `domain_refs`; domain items link back via `adr_refs`
- Generated docs go to `docs/domain/` — never edit by hand

### Domain CLI Commands

Use `npx tsx src/cli.ts` during development (or `domain-knowledge-kit` after build):

```bash
npx tsx src/cli.ts list                    # List all domain items (--context, --type filters)
npx tsx src/cli.ts show <id>               # Display full YAML of a domain item
npx tsx src/cli.ts search "<query>"        # FTS5 full-text search with ranking
npx tsx src/cli.ts related <id>            # BFS graph traversal of related items
npx tsx src/cli.ts validate                # Schema + cross-reference validation
npx tsx src/cli.ts render                  # Validate → render docs → rebuild search index
npx tsx src/cli.ts adr show <id>           # Display ADR frontmatter
npx tsx src/cli.ts adr related <id>        # Bidirectional ADR ↔ domain links
```

### Quality Gates

**When domain files change**, you MUST run these before committing:

```bash
npx tsx src/cli.ts validate
npx tsx src/cli.ts render
```

Both must exit 0. The `render` command also rebuilds the search index.


<!-- dkk:start -->
## Domain Knowledge Kit

This project uses a structured, YAML-based domain model managed by **dkk** (Domain Knowledge Kit).

Run `dkk prime` to get full agent context including domain structure, CLI commands, and workflows.

### Quick Reference

```bash
dkk prime             # Output full agent context
dkk list              # List all domain items
dkk show <id>         # Display a domain item
dkk search "<query>"  # Full-text search
dkk related <id>      # Graph traversal of related items
dkk validate          # Schema + cross-reference validation
dkk render            # Validate, render docs, rebuild search index
```

### Quality Gates

Before committing domain changes, run:

```bash
dkk validate
dkk render
```
<!-- dkk:end -->
