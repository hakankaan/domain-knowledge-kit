# Domain Knowledge Kit

Define, validate, search, and document your domain model — all from YAML.

## What Is This?

Domain Knowledge Kit (DKK) is a CLI tool for teams practicing Domain-Driven Design. Instead of scattering domain knowledge across wikis, diagrams, and tribal memory, you define your **bounded contexts**, **events**, **commands**, **policies**, **aggregates**, **read models**, and **glossary** in structured YAML files. DKK then:

- **Validates** schema conformance and referential integrity across your entire model
- **Generates** browsable Markdown documentation from your YAML definitions
- **Builds** a full-text search index (SQLite FTS5) for instant domain queries
- **Links** Architecture Decision Records (ADRs) bidirectionally to domain items
- **Integrates** with AI coding agents so they understand your domain, not just your code

## Quick Start

```bash
# Install
npm install -g domain-knowledge-kit

# Create a bounded context
cat > .dkk/domain/contexts/ordering.yml << 'EOF'
name: ordering
description: Handles customer order lifecycle.
events:
  - name: OrderPlaced
    description: Raised when a customer order is confirmed.
    raised_by: Order
commands:
  - name: PlaceOrder
    description: Submit a new customer order.
    handled_by: Order
aggregates:
  - name: Order
    description: Manages order state and invariants.
    handles: [PlaceOrder]
    emits: [OrderPlaced]
policies: []
read_models: []
glossary: []
EOF

# Register it
# Add "- name: ordering" to the contexts array in .dkk/domain/index.yml

# Validate and render
dkk validate
dkk render

# Explore
dkk search "order"
dkk show ordering.OrderPlaced
dkk related ordering.Order
```

→ **[Full Getting Started Guide](docs/getting-started.md)** — step-by-step walkthrough with examples.

## Documentation

| Guide | What You'll Learn |
|-------|-------------------|
| **[Getting Started](docs/getting-started.md)** | Install, create your first context, run quality gates, search and explore |
| **[Domain Modeling](docs/domain-modeling.md)** | All item types, YAML structure, cross-references, naming conventions, ID formats |
| **[CLI Reference](docs/cli-reference.md)** | Every command and flag: `list`, `show`, `search`, `related`, `validate`, `render`, `init`, `prime`, `adr show`, `adr related` |
| **[ADR Guide](docs/adr-guide.md)** | Architecture Decision Records: format, bidirectional linking, querying, best practices |
| **[AI Agent Integration](docs/ai-agent-integration.md)** | `dkk init`, `dkk prime`, Copilot integration, reusable prompts, portable skills |

## Key Commands

```bash
dkk validate              # Schema + cross-reference validation
dkk render                # Validate → render docs → rebuild search index
dkk search "payment"      # Full-text search with ranking
dkk show ordering.Order   # Display full item definition
dkk related ordering.Order  # Graph traversal of connected items
dkk list --type event     # List all events across contexts
dkk init                  # Set up AI agent onboarding
dkk prime                 # Output agent context to stdout
```

→ **[Full CLI Reference](docs/cli-reference.md)**

## AI Agent Integration

DKK has first-class support for AI coding agents. Two commands get you set up:

```bash
dkk init    # Add a DKK section to AGENTS.md (idempotent)
dkk prime   # Output full domain context for AI consumption
```

Agents can then search, show, and traverse your domain model — making domain-aware decisions when writing, reviewing, or refactoring code. DKK also ships with GitHub Copilot instructions, reusable agent prompts, and a portable agent skill.

→ **[AI Agent Integration Guide](docs/ai-agent-integration.md)**

## Directory Layout

```
.dkk/                           # Domain model + generated + managed
  domain/                         #   Domain model (YAML)
    index.yml                     #     Contexts + flows
    actors.yml                    #     Global actors
    contexts/<name>.yml           #     Bounded context definitions
  adr/                            #   Architecture Decision Records
  docs/                           #   Generated docs (do not edit)
src/                            # Source code (vertical slices)
tools/dkk/                      # Schemas + templates
  schema/                       #   JSON Schemas for validation
  templates/                    #   Handlebars templates for rendering
```

## Contributing / Local Development

```bash
npm install

# Run directly via tsx (no build step needed)
npm run dev -- validate
npm run dev -- render

# Or build first
npm run build
npx dkk validate
```

The source code uses **vertical feature slices** — each feature (`query`, `adr`, `pipeline`, `agent`) owns its commands, logic, and tests. Cross-cutting infrastructure lives in `shared/`.

## License

Elastic-2.0
