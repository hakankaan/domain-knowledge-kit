# Way of Working — Domain Knowledge Kit (DKK)

← [Back to README](../README.md)

This guide defines the operational practices for development teams adopting DKK into their workflows. It covers daily routines, PR review, CI integration, AI agent usage, governance, and adoption measurement.

## 1. Principles

- **Domain YAML is the single source of truth** for business domain knowledge. Never generate it from code; always write it intentionally.
- **Every domain change goes through the same quality gate**: `dkk render` must exit 0 before the PR is merged.
- **ADRs are permanent.** Mark them `deprecated` or `superseded` instead of deleting them.
- **AI agents consume the model.** Write descriptions as if explaining to a new team member — the audience is both humans and LLMs.

## 2. When to Update the Domain Model

| Trigger | Action |
|---------|--------|
| New feature introduces a new business event, command, or aggregate | `dkk add <type> <Name> --context <ctx>`, fill in the YAML |
| Refactoring changes the name of a domain concept | `dkk rename <old-id> <new-id>` |
| Removing a concept from the system | `dkk rm <id>` (blocks if dependents exist) |
| Significant architectural decision made | `dkk new adr "<title>"`, link via `domain_refs` / `adr_refs` |
| New bounded context identified | `dkk new context <name>` |
| Glossary term needs clarification or a new alias | Edit `context.yml` directly |

**Rule of thumb**: if a code change alters *what the system does* (not just *how*), the domain model should be updated in the same PR.

## 3. Daily Developer Workflow

```
1. Pull latest main
2. Check for domain context:     dkk search "<topic>"
                                  dkk summary <id> --json --minify
3. Make code + domain changes together
4. Validate:                      dkk render
5. Commit both code and .dkk/ changes in the same PR
6. Review domain diffs alongside code diffs
```

## 4. PR Review Checklist — Domain

- [ ] If new domain items were added, do they have descriptions, correct cross-references, and appropriate `raised_by` / `handled_by` / `actor` links?
- [ ] If items were renamed or removed, were all references updated? (Check `dkk validate` output.)
- [ ] If an architectural decision was made, is there an ADR with `domain_refs` pointing to affected items?
- [ ] Does `dkk render` exit 0?
- [ ] Are generated docs (`.dkk/docs/`) included in the commit? (They are deterministic artifacts that enable search.)
- [ ] Run `dkk stats` — are there new orphaned items (items with no connections)?

## 5. CI Integration

Add to your CI pipeline:

```yaml
# Example GitHub Actions step
- name: DKK Quality Gate
  run: |
    npx dkk validate
    npx dkk render
    # Fail if render produced uncommitted changes (docs out of date)
    git diff --exit-code .dkk/docs/
```

This ensures:
- Schema + cross-reference validation passes.
- Generated docs are up to date (no hand-edits, no stale renders).

## 6. AI Agent Onboarding

Run once per repo:

```bash
dkk init     # Injects DKK section into AGENTS.md
```

At the start of an agent session (or in your agent's system prompt), feed:

```bash
dkk prime    # Outputs comprehensive context to stdout
```

Teach agents to prefer:
- `dkk summary <id> --json --minify` for fast, token-efficient lookups.
- `dkk search "<query>"` for discovery.
- `dkk related <id> --depth 2` for blast-radius analysis.
- `dkk show <id>` only when full YAML detail is needed.

## 7. Modeling Conventions

| Element | Convention | Examples |
|---------|-----------|----------|
| Item names | PascalCase | `OrderPlaced`, `PlaceOrder`, `Order` |
| Context names | kebab-case | `ordering`, `inventory-management` |
| ADR IDs | `adr-NNNN` (zero-padded) | `adr-0001`, `adr-0042` |
| YAML files | `.yml` extension | `OrderPlaced.yml`, `context.yml` |
| Descriptions | Plain English, present tense | "Raised when a customer order is confirmed." |
| Fields | camelCase names, domain-level types | `orderId (UUID)`, `totalAmount (Money)` |

## 8. Ownership and Responsibility

- **Domain Steward** (rotating role or dedicated): Reviews all PRs that touch `.dkk/domain/` and `.dkk/adr/`. Ensures naming consistency, cross-reference completeness, and glossary accuracy.
- **All developers**: Update domain items when their code changes alter business behavior. Treat domain YAML edits the same as code edits — they are part of "done."
- **Tech Leads / Architects**: Author and maintain ADRs. Link decisions to domain items. Deprecate stale ADRs rather than deleting them.

## 9. Getting Started Checklist for a New Team

- [ ] Install DKK: `npm install -g domain-knowledge-kit`
- [ ] Scaffold the domain: `dkk new domain`
- [ ] Create your first bounded context: `dkk new context <name>`
- [ ] Add 3–5 core domain items (events, commands, aggregates) to build familiarity
- [ ] Run `dkk render` and inspect the generated docs
- [ ] Run `dkk init` to set up AI agent integration
- [ ] Add the CI quality gate (see Section 5)
- [ ] Share this Way of Working with the team
- [ ] Schedule a 30-minute "domain modeling" slot in sprint planning to keep the model current

## 10. Anti-Patterns to Avoid

| Anti-Pattern | Why It's Harmful | Do This Instead |
|-------------|-----------------|----------------|
| Modeling after the fact in bulk | Creates stale, inaccurate models nobody trusts | Update incrementally with each PR |
| Duplicating code structure in the model | The model describes *what* and *why*, not *how* | Focus on business events, commands, and invariants |
| Skipping descriptions | AI agents and new teammates get no value from name-only items | Write a one-sentence description for every item |
| Orphaned items with no connections | Indicates forgotten or incomplete modeling | Run `dkk stats` regularly; connect or remove orphans |
| Editing `.dkk/docs/` by hand | Gets overwritten on next render | Edit source YAML and templates only |
| Deleting ADRs | Destroys institutional memory | Set status to `deprecated` or `superseded` |

## 11. Measuring Adoption

Track these metrics to gauge whether DKK is adding value:

- **Model coverage**: ratio of domain items in YAML vs. known business concepts (review quarterly).
- **Orphan count**: `dkk stats` output — should trend toward zero.
- **ADR linkage**: percentage of domain items with at least one `adr_ref`.
- **CI gate pass rate**: how often `dkk render` fails in CI (high failure = model is drifting from code).
- **Agent query usage**: if instrumented, how often agents call `dkk search` / `dkk summary` / `dkk related` during coding sessions.

## What's Next?

- **[Getting Started](getting-started.md)** — Install DKK and set up your first domain model.
- **[Domain Modeling Guide](domain-modeling.md)** — Item types, naming conventions, cross-references.
- **[Iterative Modeling](iterative-modeling.md)** — Decision patterns, modeling phases, external constraints.
- **[CLI Reference](cli-reference.md)** — Full command and flag reference.
- **[ADR Guide](adr-guide.md)** — Architecture Decision Records workflow.
- **[AI Agent Integration](ai-agent-integration.md)** — Set up AI agents to query and maintain your domain model.
