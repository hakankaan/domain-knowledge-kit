/**
 * `dkk prime` command — output full agent context to stdout.
 *
 * Prints a comprehensive DKK usage guide for AI agent consumption,
 * followed by a dynamic "Current Domain Summary" section generated
 * from the live domain model on disk.
 *
 * Hardcoded template covering project overview, core principles,
 * domain structure, retrieval workflow, change workflow, ID conventions,
 * CLI reference, and file conventions.
 */
import type { Command as Cmd } from "commander";
import { existsSync } from "node:fs";
import { loadDomainModel } from "../../../shared/loader.js";
import { forEachItem, type ItemType } from "../../../shared/item-visitor.js";
import { domainDir } from "../../../shared/paths.js";
import type { DomainModel, Aggregate } from "../../../shared/types/domain.js";

/**
 * The full agent context document.
 * Keep the CLI Command Reference tables in sync with the Quick Reference block in init.ts#dkkSection.
 */
function primeContent(): string {
  return `# Domain Knowledge Kit — Agent Context

## Project Overview

This project uses a **Domain Knowledge Pack**: a structured, YAML-based domain model with Architecture Decision Records (ADRs), full-text search, and generated Markdown documentation. The CLI tool is \`dkk\`.

## Core Principles

1. **Domain YAML is the single source of truth.** Never generate domain knowledge from code.
   - **For structural changes (creates, renames, deletes):** ALWAYS use the DKK CLI commands (e.g., \`dkk add\`, \`dkk rename\`, \`dkk rm\`).
   - **For content updates (descriptions, properties, references):** You MUST edit the YAML files directly, but you must respect the JSON Schemas (\`tools/dkk/schema/\`) and run \`dkk render\` immediately afterward to ensure cross-reference integrity and schema validation.
2. **ADRs live in \`.dkk/adr/\`** as Markdown files with YAML frontmatter. They link to domain items via \`domain_refs\` and domain items link back via \`adr_refs\`.
3. **Prioritize ADRs in decision-making.** Before proposing architectural refactors, making tech choices, or modifying domain logic, consult existing decisions via \`dkk search "your topic"\` or \`dkk show <id>\`.
4. **Every change to domain files must pass quality gates:** run \`dkk render\` before committing (validates automatically, then renders docs and rebuilds the search index). Use \`dkk validate\` for a quick dry-run check without rendering.

## Domain Model Structure

\`\`\`
.dkk/
  domain/
    index.yml          # Top-level: registered contexts + cross-context flows
    actors.yml          # Global actors (human | system | external)
    contexts/
      <name>/            # One directory per bounded context
        context.yml      #   Context metadata (name, description, glossary)
        events/          #   One .yml file per domain event
        commands/        #   One .yml file per command
        aggregates/      #   One .yml file per aggregate
        policies/        #   One .yml file per policy
        read-models/     #   One .yml file per read model
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
| **Read Model** | Query-optimized projection | \`name\`, \`description\`, \`fields\`, \`subscribes_to\`, \`used_by\`, \`adr_refs\` |
| **Glossary** | Ubiquitous language term | \`term\`, \`definition\`, \`aliases\`, \`adr_refs\` |
| **Actor** | Person or system interacting with the domain | \`name\`, \`type\` (human/system/external), \`description\`, \`capabilities\`, \`failure_modes\`, \`adr_refs\` |
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

### Query

| Command                       | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| \`dkk list\`                    | List all domain items (filterable by \`--context\`, \`--type\`) |
| \`dkk show <id>\`               | Display full YAML of a domain item                   |
| \`dkk summary <id>\`            | Concise item summary with direct relations (AI-optimized) |
| \`dkk search <query>\`          | FTS5 full-text search with ranking                   |
| \`dkk related <id>\`            | BFS graph traversal of related items                 |
| \`dkk graph\`                   | Mermaid.js flowchart (--layout LR|TD, --node-types to filter kinds) |

### Pipeline

| Command                       | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| \`dkk validate\`                | Schema + cross-reference validation                  |
| \`dkk render\`                  | Validate → render docs → rebuild search index        |

### ADR

| Command                       | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| \`dkk show <id>\`           | Display ADR frontmatter                              |
| \`dkk related <id>\`        | Show bidirectional ADR ↔ domain links                |

### Scaffold

| Command                                  | Purpose                                              |
|------------------------------------------|------------------------------------------------------|
| \`dkk new domain\`                        | Scaffold a complete \`.dkk/domain/\` structure         |
| \`dkk new context <name>\`               | Scaffold a new bounded context and register it       |
| \`dkk new adr <title>\`                  | Scaffold a new ADR file (auto-increments number)     |
| \`dkk add <type> <name> --context <ctx>\` | Scaffold an individual domain item                   |

### Refactor

| Command                          | Purpose                                              |
|----------------------------------|------------------------------------------------------|
| \`dkk rename <old-id> <new-id>\` | Rename a domain item and update all references       |
| \`dkk rm <id>\`                  | Remove a domain item safely (aliases: remove, delete) |

### Audit

| Command       | Purpose                                                  |
|---------------|----------------------------------------------------------|
| \`dkk stats\`  | Print domain model statistics and potential orphaned items |

### Agent

| Command       | Purpose                                              |
|---------------|------------------------------------------------------|
| \`dkk init\`   | Create/update AGENTS.md with DKK section             |
| \`dkk prime\`  | Output this agent context to stdout                  |

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
   dkk related <id>
   \`\`\`
6. **Compile the answer** — Present results as a structured summary including:
   - Relevant domain items with ID, type, context, name, and excerpt.
   - Related ADRs with title and status.
   - Key relationships between items (e.g. "PlaceOrder → handled by Order → emits OrderPlaced").

## Domain Update Workflow

When modifying the domain model or proposing architectural refactors:

1. **Consult ADRs First** — Before making decisions or structural changes, check existing constraints and decisions:
   \`\`\`bash
   dkk search "<topic>" --type adr
   # or
   dkk related <id>
   \`\`\`
2. **Inspect current state** — Load current definitions and neighbours:
   \`\`\`bash
   dkk show <id>
   dkk related <id>
   dkk list --context <name>
   \`\`\`
3. **Edit YAML files directly** — Apply changes to the appropriate files:
   - **New context:** Create \`.dkk/domain/contexts/<name>/context.yml\` with name/description/glossary, create subdirs (\`events/\`, \`commands/\`, etc.), and register in \`.dkk/domain/index.yml\`.
   - **New domain item:** Create a new \`.yml\` file in the correct subdirectory (e.g. \`.dkk/domain/contexts/<name>/events/OrderPlaced.yml\`).
   - **New actor:** Add to \`.dkk/domain/actors.yml\` under \`actors\`.
   - **New flow:** Add to \`.dkk/domain/index.yml\` under \`flows\`.
   - **Modified item:** Edit the item's \`.yml\` file in place, preserving all existing fields.
4. **Maintain referential integrity:**
   - \`adr_refs\` must point to existing ADRs in \`.dkk/adr/\`.
   - \`domain_refs\` in ADR frontmatter must point to existing domain items.
   - Update cross-references (\`handles\`, \`emits\`, \`triggers\`, \`subscribes_to\`, \`used_by\`, \`raised_by\`, \`handled_by\`, \`actor\`) on related items to stay consistent.
   - Every new event should have \`raised_by\` pointing to its aggregate.
   - Every new command should have \`handled_by\` pointing to its aggregate.
   - Update aggregate \`handles.commands\` and \`emits.events\` arrays when adding commands/events.
5. **Follow naming conventions:**
   - Items: PascalCase (\`OrderPlaced\`, \`PlaceOrder\`).
   - Contexts: kebab-case (\`ordering\`, \`inventory-management\`).
   - ADR ids: \`adr-NNNN\` (zero-padded 4-digit number).
   - Actors: PascalCase (\`Customer\`, \`PaymentGateway\`).
6. **Update ADRs** — If the change affects an architectural decision:
   - Add \`domain_refs\` to the ADR frontmatter for new items.
   - Add \`adr_refs\` to new/modified domain items pointing to relevant ADRs.
   - Consider creating a new ADR if the change introduces a significant decision.
7. **Run quality gates:**
   \`\`\`bash
   dkk render    # Validates → renders docs → rebuilds search index
   \`\`\`

### YAML Structure Reference

Each domain item is a separate YAML file in a typed subdirectory under the context directory.

**Context metadata** (\`.dkk/domain/contexts/<name>/context.yml\`):

\`\`\`yaml
name: ordering
description: Handles customer order lifecycle.
glossary:
  - term: Order
    definition: A customer's request to purchase items.
\`\`\`

**Event** (\`.dkk/domain/contexts/<name>/events/OrderPlaced.yml\`):

\`\`\`yaml
name: OrderPlaced
description: Raised when a customer order is confirmed.
fields:
  - name: orderId
    type: UUID
raised_by: Order
adr_refs:
  - adr-0001
\`\`\`

**Command** (\`.dkk/domain/contexts/<name>/commands/PlaceOrder.yml\`):

\`\`\`yaml
name: PlaceOrder
description: Submit a new customer order.
fields:
  - name: items
    type: "OrderItem[]"
actor: Customer
handled_by: Order
\`\`\`

**Policy** (\`.dkk/domain/contexts/<name>/policies/SendConfirmationEmail.yml\`):

\`\`\`yaml
name: SendConfirmationEmail
description: Sends email when order is placed.
when:
  events:
    - OrderPlaced
then:
  commands:
    - NotifyCustomer
\`\`\`

**Aggregate** (\`.dkk/domain/contexts/<name>/aggregates/Order.yml\`):

\`\`\`yaml
name: Order
description: Manages order state and invariants.
handles:
  commands:
    - PlaceOrder
emits:
  events:
    - OrderPlaced
\`\`\`

**Read model** (\`.dkk/domain/contexts/<name>/read-models/OrderSummary.yml\`):

\`\`\`yaml
name: OrderSummary
description: Read-optimized view of order details.
fields:
  - name: orderId
    type: UUID
  - name: status
    type: string
  - name: totalAmount
    type: Money
subscribes_to:
  - OrderPlaced
used_by:
  - Customer
\`\`\`

**Actors file** (\`.dkk/domain/actors.yml\`):

\`\`\`yaml
actors:
  - name: Customer
    type: human
    description: End user who places and tracks orders.
  - name: PaymentGateway
    type: external
    description: Third-party payment processor.
    capabilities:
      - Authorize payments
      - Issue refunds
    failure_modes:
      - Gateway timeout
      - Card declined
\`\`\`

**Index file** (\`.dkk/domain/index.yml\`):

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
   dkk related <id>
   \`\`\`
7. **Compile impact analysis** — Report impacted items, blast radius, invariant violations, affected ADRs, and recommendations.

## Validation

The validator checks:

- **Schema conformance** — Each YAML file is validated against its JSON Schema.
- **Cross-references** — All item-to-item, item-to-ADR, and ADR-to-item references resolve correctly.
- **Context registration** — Every context directory in \`.dkk/domain/contexts/\` is registered in \`.dkk/domain/index.yml\`.

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

// ── Dynamic domain summary ───────────────────────────────────────────

/**
 * Build a dynamic "Current Domain Summary" section from the live domain
 * model on disk.  Returns the Markdown string to append after the static
 * instructions.
 */
function buildDomainSummary(root?: string): string {
  // If there's no .dkk/domain/ directory at all, short-circuit.
  if (!existsSync(domainDir(root))) {
    return (
      "\n## Current Domain Summary\n\n" +
      "No domain model found. Run `dkk new domain` to get started.\n"
    );
  }

  let model: DomainModel;
  try {
    model = loadDomainModel({ root });
  } catch {
    return (
      "\n## Current Domain Summary\n\n" +
      "No domain model found. Run `dkk new domain` to get started.\n"
    );
  }

  // If there are zero contexts, actors, and ADRs the model is essentially empty.
  if (model.contexts.size === 0 && model.actors.length === 0 && model.adrs.size === 0) {
    return (
      "\n## Current Domain Summary\n\n" +
      "No domain model found. Run `dkk new domain` to get started.\n"
    );
  }

  const lines: string[] = [];
  lines.push("\n## Current Domain Summary\n");

  // ── Global totals ────────────────────────────────────────────────
  const totals: Record<ItemType, number> = {
    event: 0,
    command: 0,
    policy: 0,
    aggregate: 0,
    read_model: 0,
    glossary: 0,
  };

  for (const ctx of model.contexts.values()) {
    forEachItem(ctx, (type) => {
      totals[type]++;
    });
  }

  const totalItems = Object.values(totals).reduce((a, b) => a + b, 0);
  lines.push(
    `**${model.contexts.size}** bounded context(s), ` +
    `**${totalItems}** domain item(s), ` +
    `**${model.actors.length}** actor(s), ` +
    `**${model.adrs.size}** ADR(s)\n`,
  );

  // ── Contexts detail ──────────────────────────────────────────────
  if (model.contexts.size > 0) {
    lines.push("### Contexts\n");
    for (const ctx of model.contexts.values()) {
      const counts: Record<ItemType, number> = {
        event: 0,
        command: 0,
        policy: 0,
        aggregate: 0,
        read_model: 0,
        glossary: 0,
      };
      forEachItem(ctx, (type) => {
        counts[type]++;
      });
      const parts: string[] = [];
      if (counts.event) parts.push(`${counts.event} event(s)`);
      if (counts.command) parts.push(`${counts.command} command(s)`);
      if (counts.aggregate) parts.push(`${counts.aggregate} aggregate(s)`);
      if (counts.policy) parts.push(`${counts.policy} policy/policies`);
      if (counts.read_model) parts.push(`${counts.read_model} read model(s)`);
      if (counts.glossary) parts.push(`${counts.glossary} glossary term(s)`);
      const countStr = parts.length ? ` — ${parts.join(", ")}` : "";
      lines.push(`- **${ctx.name}**: ${ctx.description}${countStr}`);
    }
    lines.push("");
  }

  // ── Actors ────────────────────────────────────────────────────────
  if (model.actors.length > 0) {
    lines.push("### Actors\n");
    for (const actor of model.actors) {
      lines.push(`- **${actor.name}** (${actor.type}): ${actor.description}`);
    }
    lines.push("");
  }

  // ── ADRs ──────────────────────────────────────────────────────────
  if (model.adrs.size > 0) {
    lines.push("### Architecture Decision Records\n");
    for (const adr of model.adrs.values()) {
      lines.push(`- **${adr.id}**: ${adr.title} [${adr.status}]`);
    }
    lines.push("");
  }

  // ── Key relationships (aggregates → commands / events) ────────────
  const aggregates: Array<{ ctx: string; agg: Aggregate }> = [];
  for (const ctx of model.contexts.values()) {
    for (const agg of ctx.aggregates ?? []) {
      aggregates.push({ ctx: ctx.name, agg });
    }
  }
  if (aggregates.length > 0) {
    lines.push("### Key Relationships\n");
    for (const { ctx, agg } of aggregates) {
      const cmds = agg.handles?.commands ?? [];
      const evts = agg.emits?.events ?? [];
      const cmdStr = cmds.length ? cmds.join(", ") : "none";
      const evtStr = evts.length ? evts.join(", ") : "none";
      lines.push(
        `- **${ctx}.${agg.name}**: handles [${cmdStr}] → emits [${evtStr}]`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Register the `prime` subcommand. */
export function registerPrime(program: Cmd): void {
  program
    .command("prime")
    .description("Output full DKK agent context to stdout")
    .option("-r, --root <path>", "Override repository root")
    .option("--static-only", "Output only the static instructions (skip domain summary)")
    .action((opts: { root?: string; staticOnly?: boolean }) => {
      process.stdout.write(primeContent());
      if (!opts.staticOnly) {
        process.stdout.write(buildDomainSummary(opts.root));
      }
    });
}
