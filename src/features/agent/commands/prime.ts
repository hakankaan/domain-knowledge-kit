/**
 * `dkk prime` command — output agent context to stdout.
 *
 * Prints the **lean** DKK agent contract (behavioural rules, the MCP-first
 * retrieval pointer, the mutation-only CLI commands, ID/naming conventions,
 * and a compact model layout), followed by a dynamic "Current Domain
 * Summary" generated from the live model on disk.
 *
 * Deep reference material (full YAML structure, the update/review workflows,
 * the full CLI reference, the federation guide) is NOT in the default
 * output — agents fetch it on demand via the `dkk_guide` MCP tool, and
 * `dkk prime --full` reproduces the comprehensive document.
 *
 * Rationale: now that the MCP tools are the retrieval interface, prime
 * stops teaching retrieval and stops dumping lookup material the agent can
 * pull only when it actually needs it — keeping the per-session context
 * injected by the SessionStart hook small.
 */
import type { Command as Cmd } from "commander";
import { existsSync } from "node:fs";
import { loadDomainModel } from "../../../shared/loader.js";
import { forEachItem, type ItemType } from "../../../shared/item-visitor.js";
import { domainDir, repoRoot } from "../../../shared/paths.js";
import { isGitRepo, lastCommitTouching, countCommitsSince } from "../../../shared/git.js";
import type { DomainModel, Aggregate } from "../../../shared/types/domain.js";

/**
 * The lean agent contract injected at session start.
 *
 * Keep this to what an agent CANNOT discover through a tool call: the
 * behavioural rules, the mutation commands (MCP is read-only), and the
 * naming/ID conventions needed to construct refs. Everything lookup-shaped
 * lives in `guideSection()` / `dkk_guide` instead.
 */
export function primeContent(): string {
  return `# Domain Knowledge Kit — Agent Context

## Project Overview

This project uses a **Domain Knowledge Pack**: a structured, YAML-based domain model with Architecture Decision Records (ADRs), full-text search, and generated Markdown docs. The CLI is \`dkk\`.

DKK supports **multi-repo federation**: a \`.dkk/service.yml\` declares the repo a service and \`.dkk/federation.yml\` lists peers; the loader merges peer models so queries, search, graph traversal, and validation span every peer. Cross-service refs use \`<service>:<context>.<Item>\`; bare refs stay local. (Run \`dkk_guide\` topic \`federation\` for the full workflow.)

## Core Principles

1. **Domain YAML is the single source of truth.** Never generate domain knowledge from code.
   - **Structural changes (create, rename, delete):** ALWAYS use the dkk CLI (\`dkk add\`, \`dkk rename\`, \`dkk rm\`, \`dkk new …\`).
   - **Content updates (descriptions, fields, refs):** edit the YAML directly (respect the JSON Schemas in \`tools/dkk/schema/\`), then run \`dkk render\`.
2. **ADRs live in \`.dkk/adr/\`** as Markdown with YAML frontmatter, named \`adr-NNNN.md\` with a matching \`id\`. Links are **bidirectional**: the ADR's \`domain_refs\` and the target's \`adr_refs\` must both be written — use \`dkk adr link\`, which writes both halves, rather than editing one side by hand.
3. **Prioritize ADRs.** Before architectural refactors, tech choices, or domain-logic changes, ask \`dkk_decisions\` what has already been decided about the item or file you are touching. It resolves supersession, so a replaced decision is never reported as binding.
4. **Quality gate:** run \`dkk render\` before committing (validates → renders docs → rebuilds the search index). \`dkk_validate\` is a quick dry-run check.

## Retrieval — use the MCP tools

For all read/query operations, call the DKK MCP tools rather than shelling out to the CLI (same data, no shell-quoting):

| Tool | Use for |
|------|---------|
| \`dkk_search\` | Full-text search (filters: context, type, tag, status, service) |
| \`dkk_summary\` | Cheapest orientation around an id (+ direct neighbours) |
| \`dkk_show\` | Full definition of an item; for ADRs the Markdown body, with \`section\` to read just one part |
| \`dkk_decisions\` | Which ADRs govern an item, context, actor, flow, or **source file** (+ what is still binding) |
| \`dkk_related\` | Graph traversal / blast radius (depth ≥ 2) |
| \`dkk_list\` | List items by context/type/status |
| \`dkk_story\` | A flow's full story context |
| \`dkk_stats\` | Counts + orphan detection + ADR rot |
| \`dkk_drift\` | Model/code drift report (\`code_refs\` + git); pass \`file\` to map a source file to its context |
| \`dkk_validate\` | Schema + cross-reference validation |
| \`dkk_guide\` | On-demand deep reference: \`yaml\`, \`update\`, \`adr\`, \`federation\`, \`review\`, \`cli\` |

When you're about to author or edit YAML, call \`dkk_guide\` topic \`yaml\`; before structural mutations, topic \`update\`; before writing or retiring a decision, topic \`adr\`.

## Mutations — CLI only (MCP is read-only)

| Command | Purpose |
|---------|---------|
| \`dkk new domain\` | Scaffold \`.dkk/domain/\` (one-time) |
| \`dkk new context <name>\` | Scaffold + register a bounded context |
| \`dkk new adr "<title>"\` | Scaffold a new ADR (auto-numbered); \`--domain-refs\` also writes the reciprocal \`adr_refs\` |
| \`dkk adr link <adr-id> <ids…>\` | Link a decision to items/contexts/actors/flows — writes **both** halves |
| \`dkk adr status <adr-id> <status>\` | Move a decision through its lifecycle (\`--superseded-by\` for supersession) |
| \`dkk adr audit\` | Report decision rot: unlinked, stalled, one-way links, broken chains |
| \`dkk add <type> <name> --context <ctx>\` | Scaffold a domain item |
| \`dkk rename <old-id> <new-id>\` | Rename an item + update all refs |
| \`dkk rm <id>\` | Remove an item safely |
| \`dkk render\` | Validate → render docs → rebuild index |
| \`dkk feedback add "<summary>" --kind <k>\` | Record friction with **dkk itself** (local file, never transmitted) |

Run \`dkk feedback add\` only when the user hits a bug, confusing error, or missing capability in dkk itself, or asks you to record one — offer it, never file feedback unprompted.

## ID & Naming Conventions

| Item Type    | ID Format                | Example                  |
|--------------|--------------------------|--------------------------|
| Context item | \`<context>.<ItemName>\`   | \`ordering.OrderPlaced\`   |
| Actor        | \`actor.<Name>\`           | \`actor.Customer\`         |
| ADR          | \`adr-NNNN\`               | \`adr-0001\`               |
| Flow         | \`flow.<Name>\`            | \`flow.OrderFulfillment\`  |
| Context      | \`context.<name>\`         | \`context.ordering\`       |

Federated form: prefix any id with \`<service>:\` (e.g. \`ordering:ordering.OrderPlaced\`); bare ids resolve locally only.

Naming: items PascalCase (\`OrderPlaced\`), contexts kebab-case (\`ordering\`), ADR ids zero-padded \`adr-NNNN\`, actors PascalCase. YAML files use the \`.yml\` extension.

## Domain Model Layout

\`\`\`
.dkk/
  service.yml / federation.yml   # OPTIONAL: federation (see dkk_guide federation)
  domain/
    index.yml                    # registered contexts + cross-context flows
    actors.yml                   # global actors (human | system | external)
    contexts/<name>/
      context.yml                # name, description, glossary
      events/ commands/ aggregates/ policies/ read-models/   # one .yml per item
  adr/adr-NNNN.md                # ADRs (YAML frontmatter)
  docs/                          # generated by \`dkk render\` — do not edit by hand
\`\`\`

## Item Types

| Type | Description | Key Fields |
|------|-------------|------------|
| **Event** | Something that happened | \`name\`, \`description\`, \`fields\`, \`raised_by\`, \`adr_refs\` |
| **Command** | Instruction to change state | \`name\`, \`description\`, \`fields\`, \`actor\`, \`handled_by\`, \`adr_refs\` |
| **Policy** | Reactive logic on events | \`name\`, \`description\`, \`when\`, \`then\`, \`adr_refs\` |
| **Aggregate** | Consistency boundary | \`name\`, \`description\`, \`handles\`, \`emits\`, \`adr_refs\` |
| **Read Model** | Query projection | \`name\`, \`description\`, \`fields\`, \`subscribes_to\`, \`used_by\`, \`adr_refs\` |
| **Glossary** | Ubiquitous-language term | \`term\`, \`definition\`, \`aliases\`, \`adr_refs\` |
| **Actor** | Person or system | \`name\`, \`type\`, \`description\`, \`capabilities\`, \`failure_modes\` |
| **Flow** | Cross-context sequence | \`name\`, \`description\`, \`steps[]\`, \`adr_refs\` |
| **ADR** | Architectural decision | \`id\`, \`title\`, \`status\`, \`date\`, \`domain_refs\`, \`supersedes\`/\`superseded_by\`, \`tags\`, \`code_refs\` |

For full YAML examples of each item type, call \`dkk_guide\` topic \`yaml\`.
`;
}

// ── On-demand deep reference (dkk_guide / dkk prime --full) ───────────

/** The reference topics fetchable via `dkk_guide` / surfaced by `--full`. */
export const GUIDE_TOPICS = ["yaml", "update", "adr", "federation", "review", "cli"] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

/**
 * Return one deep-reference section by topic. These are the blocks pulled
 * out of the old monolithic prime doc so agents fetch them only when the
 * work calls for it, instead of carrying ~15KB every session.
 */
export function guideSection(topic: GuideTopic): string {
  switch (topic) {
    case "yaml":
      return GUIDE_YAML;
    case "update":
      return GUIDE_UPDATE;
    case "adr":
      return GUIDE_ADR;
    case "federation":
      return GUIDE_FEDERATION;
    case "review":
      return GUIDE_REVIEW;
    case "cli":
      return GUIDE_CLI;
  }
}

/**
 * The comprehensive document: the lean contract plus every guide section.
 * Reproduces (as a superset) the pre-trim `dkk prime` output for callers
 * that explicitly want everything (`dkk prime --full`, `dkk_prime` verbose).
 */
export function fullPrimeContent(): string {
  return primeContent() + "\n" + GUIDE_TOPICS.map((t) => guideSection(t)).join("\n");
}

const GUIDE_CLI = `## CLI Command Reference

Retrieval commands below have MCP equivalents (\`dkk_*\`) — prefer the tools. Use the CLI directly for mutations and pipeline steps.
Keep this in sync with the Quick Reference block in init.ts#dkkSection.

### Query

| Command                       | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| \`dkk list\`                    | List all domain items (filterable by \`--context\`, \`--type\`, \`--status\`) |
| \`dkk show <id>\`               | Display a domain item; for ADRs, frontmatter + the Markdown body |
| \`dkk show <adr-id> --section <s>\` | One section of an ADR body (decision, consequences, alternatives…) |
| \`dkk summary <id>\`            | Concise item summary with direct relations (AI-optimized) |
| \`dkk search <query>\`          | FTS5 full-text search with ranking (\`--status\` narrows ADRs) |
| \`dkk related <id>\`            | BFS graph traversal of related items                 |
| \`dkk graph\`                   | Mermaid.js flowchart (--layout LR|TD, --node-types to filter kinds) |

### Pipeline

| Command                       | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| \`dkk validate\`                | Schema + cross-reference validation                  |
| \`dkk validate --file <path>\`  | Schema-only check of one file (safe mid-batch — no cross-refs) |
| \`dkk render\`                  | Validate → render docs → rebuild search index        |

### Scaffold

| Command                                  | Purpose                                              |
|------------------------------------------|------------------------------------------------------|
| \`dkk new domain\`                        | Scaffold a complete \`.dkk/domain/\` structure         |
| \`dkk new context <name>\`               | Scaffold a new bounded context and register it       |
| \`dkk new adr <title>\`                  | Scaffold a new ADR file (auto-increments number; \`--domain-refs\` links both halves) |
| \`dkk add <type> <name> --context <ctx>\` | Scaffold an individual domain item                   |

### ADR lifecycle

| Command                                       | Purpose                                              |
|-----------------------------------------------|------------------------------------------------------|
| \`dkk adr decisions <id>\`                     | Which decisions govern an item/context/actor/flow (\`--file <path>\` for source) |
| \`dkk adr link <adr-id> <ids…>\`               | Link a decision to targets — writes \`domain_refs\` **and** \`adr_refs\` |
| \`dkk adr unlink <adr-id> <ids…>\`             | Remove a link from both sides                        |
| \`dkk adr status <adr-id> <status>\`           | proposed \| accepted \| rejected \| deprecated \| superseded |
| \`dkk adr status <old> superseded --superseded-by <new>\` | Retire a decision and record the chain both ways |
| \`dkk adr audit\`                              | Decision rot: unlinked, stalled proposals, one-way links, broken chains (\`--strict\` for CI) |

### Refactor

| Command                          | Purpose                                              |
|----------------------------------|------------------------------------------------------|
| \`dkk rename <old-id> <new-id>\` | Rename a domain item and update all references       |
| \`dkk rm <id>\`                  | Remove a domain item safely (aliases: remove, delete) |

### Audit

| Command                  | Purpose                                                  |
|--------------------------|----------------------------------------------------------|
| \`dkk stats\`             | Print domain model statistics and potential orphaned items |
| \`dkk drift\`             | Model/code drift report from \`code_refs\` bindings + git (\`--strict\` for CI) |
| \`dkk drift ack <ctx>\`   | Mark a flagged context reviewed-and-accurate at HEAD     |
| \`dkk drift map <file>\`  | Which context binds a source file, with staleness + ADRs |

### Agent

| Command                | Purpose                                              |
|------------------------|------------------------------------------------------|
| \`dkk init\`            | Create/update AGENTS.md + \`.mcp.json\` + print next-step guidance |
| \`dkk init --skills\`   | Also install agent skills into \`.github/skills/\`     |
| \`dkk init --claude\`   | Also scaffold \`.claude/\` (settings, hooks, skills, agents, commands) |
| \`dkk init --copilot\`  | Also scaffold GitHub Copilot config (\`.github/\` prompts, agent, skills, copilot-instructions.md, \`.vscode/mcp.json\`) |
| \`dkk init --all\`      | Install both Claude Code and Copilot config          |
| \`dkk update\`          | Upgrade dkk via npm and refresh \`.claude/\`, \`.github/skills/\`, Copilot artifacts, MCP, and AGENTS.md |
| \`dkk update --diff\`   | Show the unified diff for every changed file before the confirmation prompt |
| \`dkk update --force\`  | Overwrite locally-edited artifacts instead of preserving them as conflicts |
| \`dkk artifacts check\` | Read-only drift gate for CI — exits non-zero when artifacts are out of sync |
| \`dkk prime\`           | Output the lean agent context (\`--full\` for everything) |

\`dkk update\` records what it installed in \`.dkk/artifacts.lock\` (commit it). On the next upgrade, a file whose content still matches that record is overwritten silently; a file that was edited since is reported as \`! conflict\`, left alone, and the new template is written beside it as \`<path>.new\` to merge by hand.

| \`dkk mcp\`             | MCP server entrypoint (auto-spawned by the client via .mcp.json / .vscode/mcp.json) |

### Feedback (about dkk itself, not the domain)

| Command                                      | Purpose                                              |
|----------------------------------------------|------------------------------------------------------|
| \`dkk feedback add "<summary>"\`               | Record a note in \`.dkk/feedback.yml\` (\`--kind bug\\|friction\\|idea\\|docs\`, \`--detail\`, \`--command\`) |
| \`dkk feedback\`                               | List what's been recorded (\`--kind\`, \`--unshared\`)  |
| \`dkk feedback export\`                        | Paste-ready Markdown report on **stdout** (\`--all\`, \`--mark-shared\`) |
| \`dkk feedback rm <id…>\`                      | Drop an entry — the redaction escape hatch          |

Nothing is transmitted: \`export\` prints to stdout and a human decides where it goes. Capture the failing invocation with \`--command\` and the error output with \`--detail\` — those two fields are what make a report reproducible. Never include secrets, and show the user the draft before recording it.

### Federation

| Command                                            | Purpose                                              |
|----------------------------------------------------|------------------------------------------------------|
| \`dkk service init --name <n> --export <ctx>\`      | Declare this repo a federated service (writes \`.dkk/service.yml\`) |
| \`dkk peers add <name> --local <path>\`             | Register a peer by filesystem path                  |
| \`dkk peers add <name> --git <url> --branch <b>\`   | Register a peer by git URL + branch                 |
| \`dkk peers list\`                                  | List configured peers + reachability state          |
| \`dkk peers status\`                                | Detailed peer status: service id, exports, contexts |
| \`dkk pull [name]\`                                 | Sparse-checkout git peers into \`.dkk/imports/\`      |
| \`dkk pull --refresh\`                              | Re-fetch even when cache exists                     |
| \`dkk pull --offline\`                              | Use cache only; no network                          |
| \`dkk consumers <id>\`                              | Reverse-lookup: which peers reference this item     |
| \`dkk validate --federation strict\`                | Promote unreachable-peer warnings to errors (CI gate) |
| \`dkk search --service <n>\`                        | Narrow search to one service (local or peer)        |
`;

const GUIDE_ADR = `## ADR Workflow

### Before deciding anything

Ask what has already been decided. \`dkk_decisions\` takes an item id
(\`ordering.Order\`, \`actor.Customer\`, \`flow.Checkout\`,
\`context.ordering\`) or a source \`file\` path, and returns every linked
ADR with its provenance plus \`binding\` — the ids in effect *after*
following supersession chains. A superseded ADR is never reported as
binding; its successor is.

Relitigating a decided question without citing the prior ADR is the
worst failure mode here. If a *rejected* ADR covers the idea, say so
rather than proposing it again.

### Recording a decision

\`\`\`bash
dkk new adr "Use CQRS for inventory" \\
  --status proposed \\
  --deciders "Ada,Grace" \\
  --domain-refs inventory.StockReserved,context.inventory \\
  --tags storage
\`\`\`

- The file is \`.dkk/adr/adr-NNNN.md\`; \`id\` must match the filename
  (the validator enforces it) and the number is assigned for you.
- \`--domain-refs\` writes **both** halves of each link. Pass
  \`--no-backlink\` only if you deliberately want the ADR side alone.
- Frontmatter is the single source of truth for status and date. Do
  not restate them in the body — nothing keeps a prose copy in sync.
- Canonical sections: **Context**, **Decision**, **Alternatives
  Considered**, **Consequences**. A team can override the skeleton by
  putting its own \`adr.md.hbs\` in \`.dkk/templates/\`.

### Linking

\`\`\`bash
dkk adr link adr-0007 ordering.Order actor.Customer context.ordering
dkk adr unlink adr-0007 ordering.Order
\`\`\`

Targets may be items, glossary terms, actors, flows, or whole contexts.
Editing only one side produces a link that resolves but is invisible on
the item side and in the rendered docs; \`dkk validate\` warns about it.

### Lifecycle

| Status | Meaning |
|--------|---------|
| \`proposed\` | under discussion — not in effect yet |
| \`accepted\` | in effect — new code must comply |
| \`rejected\` | considered and declined — kept so it is not relitigated |
| \`deprecated\` | was in effect, no longer applies |
| \`superseded\` | replaced by a later ADR |

\`\`\`bash
dkk adr status adr-0007 accepted
dkk adr status adr-0003 superseded --superseded-by adr-0007
\`\`\`

The supersession form writes \`superseded_by\` on the old ADR and
\`supersedes\` on the new one, so the chain is answerable from both
ends. Never delete an ADR — retire it.

### Reading

- \`dkk_show adr-0007\` returns the frontmatter plus the Markdown body
  intact, and lists the section names.
- \`dkk_show adr-0007 section="decision"\` returns just that section —
  prefer it when you want what was decided, not the whole document.
- \`dkk_search "<topic>" type="adr" status="accepted"\` narrows to what
  is currently binding; \`status="proposed"\` finds open questions.

### Health

\`dkk adr audit\` reports unlinked decisions, proposals nobody ever
resolved, one-way links, and broken supersession chains. \`--strict\`
makes it a CI gate. \`review_by: YYYY-MM-DD\` in the frontmatter opts a
decision into a revisit deadline.
`;

const GUIDE_UPDATE = `## Domain Update Workflow

When modifying the domain model or proposing architectural refactors:

1. **Consult ADRs First** — Before making decisions or structural changes, check existing constraints and decisions (\`dkk_search\` with \`type: adr\`, or \`dkk_related\`).
2. **Inspect current state** — Load current definitions and neighbours (\`dkk_show\`, \`dkk_related\`, \`dkk_list\`).
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
   - Superseding a decision? \`dkk new adr "<title>" --supersedes adr-NNNN\` flips the old ADR's status and \`superseded_by\` automatically.
7. **Keep \`code_refs\` bindings current** — when a change adds, moves, or deletes an app/module, update the owning context's \`code_refs\` globs (and bind brand-new areas to a context) so \`dkk drift\` keeps seeing the code.
8. **Run quality gates:** \`dkk render\` (validates → renders docs → rebuilds the search index).

## Validation

The validator (\`dkk_validate\` / \`dkk validate\` / \`dkk render\`) checks:

- **Schema conformance** — Each YAML file is validated against its JSON Schema. \`.dkk/service.yml\` and \`.dkk/federation.yml\` are validated at load time.
- **Cross-references** — All item-to-item, item-to-ADR, and ADR-to-item references resolve correctly, including federated forms.
- **Context registration** — Every context directory in \`.dkk/domain/contexts/\` is registered in \`.dkk/domain/index.yml\`.
- **ADR supersession consistency** — \`superseded_by\` and \`status: superseded\` must appear together (warning when they disagree).
- **\`code_refs\` liveness** — a binding glob that matches no files warns (the bound code was deleted/moved, or the glob is stale).
- **Federation strictness** (\`--federation strict\`): unreachable peers escalate from warnings to errors; refs to non-exported peer contexts always warn.

Mid-batch note: \`dkk validate --file <path>\` checks ONE file against its schema only (no cross-refs) — it will not fail on refs to files you haven't written yet. Use it per-edit; run the full \`dkk validate\` / \`dkk render\` once the batch is complete.

## Generated Documentation

Running \`dkk render\` produces \`.dkk/docs/index.md\`, per-context \`index.md\`, per-item detail pages, and the SQLite FTS5 search index. Do not edit files under \`.dkk/docs/\` by hand; they are regenerated on each render.
`;

const GUIDE_YAML = `## YAML Structure Reference

Each domain item is a separate YAML file in a typed subdirectory under the context directory.

**Context metadata** (\`.dkk/domain/contexts/<name>/context.yml\`):

\`\`\`yaml
name: ordering
description: Handles customer order lifecycle.
glossary:
  - term: Order
    definition: A customer's request to purchase items.
code_refs:                # optional: repo-relative globs binding this context
  - apps/api/src/ordering/**   # to the source it models — powers \`dkk drift\`
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
`;

const GUIDE_REVIEW = `## Change Review Workflow

When reviewing changes for domain impact:

1. **Understand the change** — Identify affected bounded contexts, domain concepts, and whether items are added, modified, or removed.
2. **Search for impacted items** — \`dkk_search\` for each concept in the change.
3. **Inspect impacted items** — \`dkk_show <id>\` for current definitions.
4. **Trace the blast radius** — \`dkk_related <id>\` with depth ≥ 2 to find dependent items.
5. **Check invariants** — \`dkk_validate\`. Watch for: broken \`adr_refs\`, broken \`domain_refs\` in ADRs, dangling cross-references, missing context registrations.
6. **Find linked ADRs** — \`dkk_related <id>\` surfaces decisions that may need updating.
7. **Compile impact analysis** — Report impacted items, blast radius, invariant violations, affected ADRs, and recommendations.
`;

const GUIDE_FEDERATION = `## Federation Workflow

When the local repo has a \`.dkk/federation.yml\`, the loader hydrates every reachable peer's domain into \`model.peers\`. Reading commands and the MCP tools (\`dkk_show\`, \`dkk_search\`, \`dkk_related\`, \`dkk_peers\`, \`dkk_consumers\`) transparently span peers.

**When to federate (and when not to).** Federation crosses **repo / ownership boundaries** — reach for it when a service lives in its own repository (or will soon) and a *separate* repo needs to reference its domain. Within a **single repo** — including a monorepo of many apps — do **not** federate: model each area as a **bounded context** under one \`.dkk/\`. Contexts already give you cross-context refs, flows, and blast radius across the whole repo as one coherent graph with one search index; federating inside one repo only adds N service manifests, N indexes, per-app \`dkk\` invocations, and the friction that bare refs never resolve across the boundary — all for no gain. Rule of thumb: **one \`.dkk/\` per repository, one bounded context per module within it.**

1. **Inspect peer state**:
   \`\`\`bash
   dkk peers list                    # quick overview
   dkk peers status                  # exports + contexts per peer
   \`\`\`
2. **Reference a peer item** — when authoring a local policy, ADR, or flow that consumes something across the boundary, use the fully-qualified form:
   \`\`\`yaml
   when:
     events:
       - ordering:ordering.OrderPlaced   # peer service "ordering", context "ordering", item "OrderPlaced"
   \`\`\`
3. **Inspect a peer item directly**:
   \`\`\`bash
   dkk show ordering:OrderPlaced           # shorthand (single-export service)
   dkk show ordering:ordering.OrderPlaced  # fully qualified
   \`\`\`
4. **Find downstream consumers of a local item** before renaming/deprecating: \`dkk consumers ordering.OrderPlaced\` (or the \`dkk_consumers\` tool).
5. **Refresh git-source peers** when needed:
   \`\`\`bash
   dkk pull ordering            # fetch (no-op if SHA matches the lockfile)
   dkk pull ordering --refresh  # force re-fetch
   \`\`\`

**Federated ID forms** (prefix any id with \`<service>:\`):

| Federated Form                     | Example                            |
|------------------------------------|------------------------------------|
| \`<service>:<context>.<ItemName>\`   | \`ordering:ordering.OrderPlaced\`    |
| \`<service>:actor.<Name>\`           | \`payments:actor.PaymentGateway\`    |
| \`<service>:adr-NNNN\`               | \`ordering:adr-0007\`                |
| \`<service>:flow.<Name>\`            | \`ordering:flow.OrderFulfillment\`   |
| \`<service>:context.<name>\`         | \`ordering:context.ordering\`        |

**Reference resolution rules:**
- A **bare** ref (\`OrderPlaced\`, \`ordering.OrderPlaced\`) resolves only against the local repo's items. Never falls through to peers — collisions are silent data corruption.
- A **service-prefixed** ref (\`ordering:ordering.OrderPlaced\`) resolves only against \`model.peers.get(<service>)\`. If the service equals the local service name, it's treated as a local ref (self-prefix is harmless).
- An **unreachable peer** produces a warning by default. CI gates that must guarantee resolution should run \`dkk validate --federation strict\`.
`;

// ── Pack freshness headline ──────────────────────────────────────────

/**
 * One-line pack-freshness signal computed from git alone, emitted as the
 * FIRST line of `dkk prime` output so it survives any downstream
 * truncation by an agent harness (the domain summary at the tail is the
 * part that gets cut).
 *
 * A pack can be internally valid yet stale relative to the code: every
 * `dkk validate` gate measures self-consistency only. This headline is
 * the cheapest possible drift signal — "the model last changed N days /
 * M commits ago" — and needs no `code_refs` bindings.
 *
 * Returns "" (silent) when: not a git repo, git unavailable, `.dkk/`
 * has no commits yet, or there is no model to be stale.
 */
export function buildStalenessHeadline(root?: string): string {
  const cwd = repoRoot(root);
  if (!existsSync(domainDir(root))) return "";
  if (!isGitRepo(cwd)) return "";

  const last = lastCommitTouching(cwd, [".dkk/domain", ".dkk/adr"]);
  if (!last) return "";

  const commitsSince = countCommitsSince(cwd, last.sha) ?? 0;
  const days = Math.floor((Date.now() / 1000 - last.timestamp) / 86_400);
  const age = days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;

  // Fresh pack, quiet line; aging pack with real commit traffic, warning.
  const marker = commitsSince > 0 && days >= 14 ? "⚠" : "ℹ";
  const nudge =
    commitsSince > 0
      ? " If any of those commits changed domain behaviour, the pack may be stale — verify before trusting it, and update it as part of your change."
      : "";
  return `> ${marker} **Pack freshness:** domain model last changed ${age}; ${commitsSince} commit(s) have landed since.${nudge}\n\n`;
}

// ── Dynamic domain summary ───────────────────────────────────────────

/**
 * Build a dynamic "Current Domain Summary" section from the live domain
 * model on disk.  Returns the Markdown string to append after the static
 * instructions.
 */
export function buildDomainSummary(root?: string): string {
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
  const flows = model.index.flows ?? [];
  lines.push(
    `**${model.contexts.size}** bounded context(s), ` +
    `**${totalItems}** domain item(s), ` +
    `**${model.actors.length}** actor(s), ` +
    `**${flows.length}** flow(s), ` +
    `**${model.adrs.size}** ADR(s)\n`,
  );

  // ── Service identity & peers (federation) ────────────────────────
  if (model.service) {
    lines.push(`### Service Identity\n`);
    lines.push(`- **name:** \`${model.service.name}\``);
    lines.push(`- **exports:** ${model.service.exports.map((e) => `\`${e}\``).join(", ") || "(none)"}`);
    if (model.service.description) {
      lines.push(`- **description:** ${model.service.description}`);
    }
    lines.push("");
  }
  if (model.peers && model.peers.size > 0) {
    lines.push(`### Federated Peers (${model.peers.size})\n`);
    for (const [peerName, peerModel] of model.peers) {
      const peerExports = peerModel.service?.exports ?? [];
      const peerCtxCount = peerModel.contexts.size;
      const exportsStr = peerExports.length ? peerExports.map((e) => `\`${e}\``).join(", ") : "(none declared)";
      lines.push(`- **${peerName}**: ${peerCtxCount} context(s), exports: ${exportsStr}`);
    }
    lines.push("");
    lines.push("Reference any peer item as \`<service>:<context>.<Name>\` (e.g. \`ordering:ordering.OrderPlaced\`).");
    lines.push("");
  }

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

  // ── Flows ─────────────────────────────────────────────────────────
  if (flows.length > 0) {
    lines.push("### Flows\n");
    for (const flow of flows) {
      const steps = flow.steps ?? [];
      let span = "";
      if (steps.length === 1) {
        span = ` (${steps[0].ref})`;
      } else if (steps.length > 1) {
        span = ` (${steps[0].ref} → ${steps[steps.length - 1].ref})`;
      }
      const desc = flow.description ? `${flow.description} — ` : "";
      lines.push(`- **${flow.name}**: ${desc}${steps.length} step(s)${span}`);
    }
    lines.push("");
    lines.push("Expand any flow into a full story context with `dkk story <flow.Name>`.");
    lines.push("");
  }

  return lines.join("\n");
}

/** Register the `prime` subcommand. */
export function registerPrime(program: Cmd): void {
  program
    .command("prime")
    .description("Output the lean DKK agent context to stdout (--full for the complete reference)")
    .option("-r, --root <path>", "Override repository root")
    .option("--full", "Output the full reference (YAML structure, workflows, full CLI reference)")
    .option("--static-only", "Output only the static instructions (skip the current domain summary)")
    .action((opts: { root?: string; full?: boolean; staticOnly?: boolean }) => {
      if (!opts.staticOnly) {
        process.stdout.write(buildStalenessHeadline(opts.root));
      }
      process.stdout.write(opts.full ? fullPrimeContent() : primeContent());
      if (!opts.staticOnly) {
        process.stdout.write(buildDomainSummary(opts.root));
      }
    });
}
