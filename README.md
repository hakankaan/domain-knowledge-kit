# Domain Knowledge Kit

> *Humans design the domain. AI agents align the codebase.*

## Philosophy

### AI agents love structure

Large language models thrive with well-structured, unambiguous context. A flat codebase gives them syntax; a structured domain model gives them **meaning**. DKK makes your domain a first-class, machine-readable citizen of your repository.

### Humans can define domain events easily

You don't need a diagram tool or a modeling session. Writing `OrderPlaced` in a YAML file — with a one-line description and a reference to the aggregate that emits it — is how humans naturally think in DDD. Defining events, commands, and policies in plain YAML reveals the bigger picture without drowning in implementation details.

### Reading domain models beats reading code

Business logic spread across services, handlers, and database schemas is hard to reason about holistically. A domain model is a curated, intentional view of *what your system does and why* — not *how* it does it. DKK keeps that view always up-to-date and always searchable.

### Keeping ADRs, even deprecated ones, preserves project memory

Architectural decisions aren't born in a vacuum. Understanding *why* a choice was made matters as much as knowing *what* the choice was. Deprecated ADRs aren't noise — they are the institutional memory that prevents teams (and AI agents) from relitigating past decisions.

### Easy-to-reach, detailed, colocated knowledge for AI agents

Knowledge that lives next to the code is knowledge that gets used. DKK colocates your domain model, ADRs, and generated docs inside the repository itself. AI agents can discover, query, and traverse this knowledge without leaving the codebase — making every interaction domain-aware.

### A model that cannot tell when it is stale will silently rot

Validation alone only measures a pack's *internal* consistency — a model frozen for weeks stays green while the code moves on. DKK binds contexts to the source paths they model (`code_refs` globs) and correlates both histories in git: `dkk drift` reports contexts whose bound code changed since the model did, bindings whose code no longer exists, and source directories no context covers. The shipped agent hooks close the loop from the code side too — editing a bound file injects a one-line reminder of which context models it and how stale that model is.

### One domain model can span many repositories

In enterprise architectures each service lives in its own repo, but the domain it participates in does not. DKK supports **multi-repo federation**: a repo declares itself a service with `.dkk/service.yml`, lists peer services in `.dkk/federation.yml` (by filesystem path or git URL + branch), and the loader transparently merges peer domain models into the local one. Cross-service references use the additive grammar `<service>:<context>.<Item>` — bare refs stay local-only. No CI required, no publish step, no orphan branches: a peer's raw `.dkk/` directory is the artifact. The AI assistant in any repo can answer "what does `ordering:OrderPlaced` contain, and who else consumes it?" without leaving the current working directory.

---

## Documentation

All technical details, CLI references, and integration guides live in the [`docs/`](docs/) folder.

| Guide | What It Covers |
|-------|----------------|
| **[Getting Started](docs/getting-started.md)** | Installation, first context, quality gates |
| **[Domain Modeling](docs/domain-modeling.md)** | YAML structure, item types, naming conventions |
| **[CLI Reference](docs/cli-reference.md)** | Every command and flag |
| **[ADR Guide](docs/adr-guide.md)** | Writing, linking, and querying ADRs |
| **[AI Agent Integration](docs/ai-agent-integration.md)** | Onboarding agents, context-efficient retrieval |
| **[Way of Working](docs/way-of-working.md)** | Team adoption practices, PR review, CI, governance |
| **[Iterative Modeling](docs/iterative-modeling.md)** | Decision patterns, modeling phases, external constraints |

## License

Elastic-2.0
