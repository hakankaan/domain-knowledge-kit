# Domain Knowledge Kit

A structured, YAML-based domain model with Architecture Decision Records (ADRs), full-text search, and generated Markdown documentation.

Domain Knowledge Kit lets you define bounded contexts, events, commands, policies, aggregates, read models, and glossary terms in YAML — then validate, render, and search them from the CLI.

## Quick Start

```bash
# Install dependencies
npm install

# Validate the domain model
npx tsx src/cli.ts validate

# Render generated documentation
npx tsx src/cli.ts render

# Search domain items
npx tsx src/cli.ts search "order"
```

After building (`npm run build`), the CLI is available as `domain-knowledge-kit`:

```bash
npm run build
npx domain-knowledge-kit validate
npx domain-knowledge-kit render
```

## Directory Layout

```
domain/
  index.yml              # Registered contexts + cross-context flows
  actors.yml             # Global actors (human | system | external)
  contexts/
    <name>.yml           # Bounded context definition

docs/
  adr/                   # Architecture Decision Records (Markdown + YAML frontmatter)
  domain/                # Generated documentation (do not edit by hand)

src/                     # CLI source code
tools/
  domain-pack/
    schema/              # JSON Schemas for domain YAML validation
    templates/           # Handlebars templates for doc generation

.github/
  copilot-instructions.md  # Copilot integration instructions
  prompts/                 # Copilot prompt files
  skills/                  # Copilot skill definitions
  agents/                  # Copilot agent definitions
```

## Adding a Bounded Context

1. Create a new file `domain/contexts/<name>.yml`:

   ```yaml
   name: <name>
   description: A short description of this bounded context.
   events: []
   commands: []
   policies: []
   aggregates: []
   read_models: []
   glossary: []
   ```

2. Register it in `domain/index.yml`:

   ```yaml
   contexts:
     - name: <name>
   ```

3. Run quality gates:

   ```bash
   npx tsx src/cli.ts validate
   npx tsx src/cli.ts render
   ```

## Adding an ADR and Linking It

1. Create a Markdown file in `docs/adr/` following the naming convention `NNNN-short-title.md`:

   ```markdown
   ---
   id: adr-NNNN
   title: Short Title
   status: proposed
   date: YYYY-MM-DD
   domain_refs:
     - <context>.<ItemName>
   ---

   ## Context
   ...

   ## Decision
   ...

   ## Consequences
   ...
   ```

2. Link back from domain items by adding the ADR id to their `adr_refs`:

   ```yaml
   # In domain/contexts/<name>.yml, on the relevant item:
   adr_refs:
     - adr-NNNN
   ```

3. Run quality gates:

   ```bash
   npx tsx src/cli.ts validate
   npx tsx src/cli.ts render
   ```

## CLI Command Reference

| Command                          | Purpose                                                      |
|----------------------------------|--------------------------------------------------------------|
| `domain-knowledge-kit list`      | List all domain items (`--context`, `--type` filters)        |
| `domain-knowledge-kit show <id>` | Display full YAML of a domain item                           |
| `domain-knowledge-kit search <query>` | FTS5 full-text search with ranking                      |
| `domain-knowledge-kit related <id>` | BFS graph traversal of related items                      |
| `domain-knowledge-kit validate`  | Schema + cross-reference validation                          |
| `domain-knowledge-kit render`    | Validate, render docs, and rebuild search index              |
| `domain-knowledge-kit adr show <id>` | Display ADR frontmatter                                 |
| `domain-knowledge-kit adr related <id>` | Show bidirectional ADR ↔ domain links                |

During development, use `npx tsx src/cli.ts` instead of `domain-knowledge-kit`.

## ID Conventions

| Item Type    | Format                     | Example                  |
|--------------|----------------------------|--------------------------|
| Context item | `<context>.<ItemName>`     | `ordering.OrderPlaced`   |
| Actor        | `actor.<Name>`             | `actor.Customer`         |
| ADR          | `adr-NNNN`                 | `adr-0001`               |
| Flow         | `flow.<Name>`              | `flow.OrderFulfillment`  |
| Context      | `context.<name>`           | `context.ordering`       |

## Copilot Integration

This project includes GitHub Copilot integration artifacts:

- **Instructions** — [.github/copilot-instructions.md](.github/copilot-instructions.md) configures Copilot to understand the domain model structure and use domain-first retrieval.
- **Prompts** — [.github/prompts/](.github/prompts/) contains prompt files for domain search, domain updates, and change review.
- **Skills** — [.github/skills/](.github/skills/) defines a domain knowledge skill for Copilot.
- **Agents** — [.github/agents/](.github/agents/) defines agents for planning and task investigation.

## License

MIT
