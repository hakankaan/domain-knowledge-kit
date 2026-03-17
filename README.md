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

## License

Elastic-2.0
