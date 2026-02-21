/**
 * `dkk prime` command — output full agent context to stdout.
 *
 * Prints a comprehensive DKK usage guide for AI agent consumption.
 * Hardcoded template covering project overview, core principles,
 * domain structure, retrieval workflow, change workflow, ID conventions,
 * CLI reference, and file conventions.
 */
import type { Command as Cmd } from "commander";

/** The full agent context document. */
function primeContent(): string {
  return `# Domain Knowledge Kit — Agent Context

## Project Overview

This project uses a **Domain Knowledge Pack**: a structured, YAML-based domain model with Architecture Decision Records (ADRs), full-text search, and generated Markdown documentation. The CLI tool is \`dkk\`.

## Core Principles

1. **Domain YAML is the single source of truth.** Never generate domain knowledge from code; always read and edit the YAML files under \`domain/\`.
2. **ADRs live in \`.dkk/adr/\`** as Markdown files with YAML frontmatter. They link to domain items via \`domain_refs\` and domain items link back via \`adr_refs\`.
3. **Every change to domain files must pass quality gates:** run \`dkk validate\` then \`dkk render\` before committing.

## Domain Model Structure

\`\`\`
domain/
  index.yml          # Top-level: registered contexts + cross-context flows
  actors.yml          # Global actors (human | system | external)
  contexts/
    <name>.yml        # Bounded context with events, commands, policies,
                      #   aggregates, read_models, glossary
.dkk/
  adr/
    adr-NNNN.md      # Architecture Decision Records (YAML frontmatter)
\`\`\`

## Item Types

| Type | Description | Key Fields |
|------|-------------|------------|
| **Event** | Something that happened in the domain | \`name\`, \`description\`, \`fields\`, \`raised_by\`, \`adr_refs\` |
| **Command** | An instruction to change state | \`name\`, \`description\`, \`fields\`, \`actor\`, \`handled_by\`, \`adr_refs\` |
| **Policy** | Reactive logic triggered by events | \`name\`, \`description\`, \`when\`, \`then\`, \`adr_refs\` |
| **Aggregate** | Consistency boundary handling commands | \`name\`, \`description\`, \`handles\`, \`emits\`, \`adr_refs\` |
| **Read Model** | Query-optimized projection | \`name\`, \`description\`, \`subscribes_to\`, \`used_by\`, \`adr_refs\` |
| **Glossary** | Ubiquitous language term | \`term\`, \`definition\`, \`aliases\`, \`adr_refs\` |
| **Actor** | Person or system interacting with the domain | \`name\`, \`type\` (human/system/external), \`description\`, \`adr_refs\` |
| **Flow** | Cross-context sequence of steps | \`name\`, \`description\`, \`steps[]\` |

## ID Conventions

| Item Type    | ID Format                          | Example                    |
|--------------|------------------------------------|----------------------------|
| Context item | \`<context>.<ItemName>\`             | \`ordering.OrderPlaced\`     |
| Actor        | \`actor.<Name>\`                     | \`actor.Customer\`           |
| ADR          | \`adr-NNNN\`                         | \`adr-0001\`                 |
| Flow         | \`flow.<Name>\`                      | \`flow.OrderFulfillment\`    |
| Context      | \`context.<name>\`                   | \`context.ordering\`         |

## CLI Command Reference

| Command                       | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| \`dkk list\`                    | List all domain items (filterable by \`--context\`, \`--type\`) |
| \`dkk show <id>\`               | Display full YAML of a domain item                   |
| \`dkk search <query>\`          | FTS5 full-text search with ranking                   |
| \`dkk related <id>\`            | BFS graph traversal of related items                 |
| \`dkk validate\`                | Schema + cross-reference validation                  |
| \`dkk render\`                  | Validate → render docs → rebuild search index        |
| \`dkk adr show <id>\`           | Display ADR frontmatter                              |
| \`dkk adr related <id>\`        | Show bidirectional ADR ↔ domain links                |
| \`dkk init\`                    | Create/update AGENTS.md with DKK section             |
| \`dkk prime\`                   | Output this agent context to stdout                  |

## Domain Search Workflow

When answering questions about the domain, always query the model — never guess.

1. **Parse the request** — Extract key concepts, entity names, and domain terms.
2. **Search** — Run full-text search for each key concept:
   \`\`\`bash
   dkk search "<concept>"
   \`\`\`
   Use \`--context <name>\` to scope to a bounded context. Use \`--type <type>\` to narrow results (event, command, policy, aggregate, read_model, glossary, actor, adr, flow, context).
3. **Show details** — For each relevant result, retrieve the full definition:
   \`\`\`bash
   dkk show <id>
   \`\`\`
4. **Explore relationships** — Discover connected items via graph traversal:
   \`\`\`bash
   dkk related <id> --depth 2
   \`\`\`
5. **Check ADR links** — Find architecture decisions connected to results:
   \`\`\`bash
   dkk adr related <id>
   \`\`\`
6. **Compile the answer** — Present results as a structured summary including:
   - Relevant domain items with ID, type, context, name, and excerpt.
   - Related ADRs with title and status.
   - Key relationships between items (e.g. "PlaceOrder → handled by Order → emits OrderPlaced").

## Domain Update Workflow

When modifying the domain model:

1. **Inspect current state** — Load current definitions and neighbours:
   \`\`\`bash
   dkk show <id>
   dkk related <id>
   dkk list --context <name>
   \`\`\`
2. **Edit YAML files directly** — Apply changes to the appropriate files:
   - **New context:** Create \`domain/contexts/<name>.yml\` and register in \`domain/index.yml\`.
   - **New domain item:** Add to the correct array (\`events\`, \`commands\`, \`policies\`, \`aggregates\`, \`read_models\`, \`glossary\`) in \`domain/contexts/<name>.yml\`.
   - **New actor:** Add to \`domain/actors.yml\` under \`actors\`.
   - **New flow:** Add to \`domain/index.yml\` under \`flows\`.
   - **Modified item:** Edit in place, preserving all existing fields.
3. **Maintain referential integrity:**
   - \`adr_refs\` must point to existing ADRs in \`.dkk/adr/\`.
   - \`domain_refs\` in ADR frontmatter must point to existing domain items.
   - Update cross-references (\`handles\`, \`emits\`, \`triggers\`, \`subscribes_to\`, \`used_by\`, \`raised_by\`, \`handled_by\`, \`actor\`) on related items to stay consistent.
   - Every new event should have \`raised_by\` pointing to its aggregate.
   - Every new command should have \`handled_by\` pointing to its aggregate.
   - Update aggregate \`handles\` and \`emits\` arrays when adding commands/events.
4. **Follow naming conventions:**
   - Items: PascalCase (\`OrderPlaced\`, \`PlaceOrder\`).
   - Contexts: kebab-case (\`ordering\`, \`inventory-management\`).
   - ADR ids: \`adr-NNNN\` (zero-padded 4-digit number).
   - Actors: PascalCase (\`Customer\`, \`PaymentGateway\`).
5. **Update ADRs** — If the change affects an architectural decision:
   - Add \`domain_refs\` to the ADR frontmatter for new items.
   - Add \`adr_refs\` to new/modified domain items pointing to relevant ADRs.
   - Consider creating a new ADR if the change introduces a significant decision.
6. **Run quality gates:**
   \`\`\`bash
   dkk validate
   dkk render
   \`\`\`

### YAML Structure Reference

**Context file** (\`domain/contexts/<name>.yml\`):

\`\`\`yaml
name: ordering
description: Handles customer order lifecycle.
glossary:
  - term: Order
    definition: A customer's request to purchase items.
events:
  - name: OrderPlaced
    description: Raised when a customer order is confirmed.
    fields:
      - name: orderId
        type: UUID
    raised_by: Order
    adr_refs:
      - adr-0001
commands:
  - name: PlaceOrder
    description: Submit a new customer order.
    fields:
      - name: items
        type: "OrderItem[]"
    actor: Customer
    handled_by: Order
policies:
  - name: SendConfirmationEmail
    description: Sends email when order is placed.
    when:
      events:
        - OrderPlaced
    then:
      commands:
        - NotifyCustomer
aggregates:
  - name: Order
    description: Manages order state and invariants.
    handles:
      - PlaceOrder
    emits:
      - OrderPlaced
read_models:
  - name: OrderSummary
    description: Read-optimized view of order details.
    subscribes_to:
      - OrderPlaced
    used_by:
      - Customer
\`\`\`

**Actors file** (\`domain/actors.yml\`):

\`\`\`yaml
actors:
  - name: Customer
    type: human
    description: End user who places and tracks orders.
\`\`\`

**Index file** (\`domain/index.yml\`):

\`\`\`yaml
contexts:
  - name: ordering
    description: Handles customer order lifecycle.
flows:
  - name: OrderFulfillment
    description: End-to-end order processing flow.
    steps:
      - ref: ordering.PlaceOrder
        type: command
      - ref: ordering.OrderPlaced
        type: event
\`\`\`

## Change Review Workflow

When reviewing changes for domain impact:

1. **Understand the change** — Identify affected bounded contexts, domain concepts, and whether items are added, modified, or removed.
2. **Search for impacted items** — For each concept in the change:
   \`\`\`bash
   dkk search "<concept>"
   \`\`\`
3. **Inspect impacted items** — Show current definitions:
   \`\`\`bash
   dkk show <id>
   \`\`\`
4. **Trace the blast radius** — Use graph traversal to find dependent items:
   \`\`\`bash
   dkk related <id> --depth 2
   \`\`\`
5. **Check invariants** — Run validation:
   \`\`\`bash
   dkk validate
   \`\`\`
   Watch for: broken \`adr_refs\`, broken \`domain_refs\` in ADRs, dangling cross-references, missing context registrations.
6. **Find linked ADRs** — Identify decisions that may need updating:
   \`\`\`bash
   dkk adr related <id>
   \`\`\`
7. **Compile impact analysis** — Report impacted items, blast radius, invariant violations, affected ADRs, and recommendations.

## Validation

The validator checks:

- **Schema conformance** — Each YAML file is validated against its JSON Schema.
- **Cross-references** — All item-to-item, item-to-ADR, and ADR-to-item references resolve correctly.
- **Context registration** — Every context file in \`domain/contexts/\` is registered in \`domain/index.yml\`.

## Generated Documentation

Running \`dkk render\` produces:

- \`.dkk/docs/index.md\` — Top-level domain overview.
- \`.dkk/docs/<context>/index.md\` — Per-context overview.
- \`.dkk/docs/<context>/<ItemName>.md\` — Per-item detail page.
- SQLite FTS5 search index for the \`search\` command.

Do not edit files under \`.dkk/docs/\` by hand; they are regenerated on each render.

## File Conventions

- YAML files use \`.yml\` extension.
- Names are PascalCase for items (events, commands, etc.) and kebab-case for contexts and ADR ids.
- JSON Schemas live in \`tools/dkk/schema/\`; Handlebars templates in \`tools/dkk/templates/\`.
- Generated documentation goes to \`.dkk/docs/\` (do not edit by hand).
`;
}

/** Register the `prime` subcommand. */
export function registerPrime(program: Cmd): void {
  program
    .command("prime")
    .description("Output full DKK agent context to stdout")
    .action(() => {
      process.stdout.write(primeContent());
    });
}
