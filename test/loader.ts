/**
 * Tests for the domain model loader and supporting utilities.
 *
 * Uses a temporary directory tree that mirrors the real layout:
 *   tmp/
 *     domain/
 *       index.yml
 *       actors.yml
 *       contexts/
 *         ordering.yml          (flat context)
 *         shipping/
 *           context.yml         (directory context)
 *     docs/
 *       adr/
 *         0001-use-yaml.md
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../src/core/loader.js";
import { parseAdrFrontmatter } from "../src/utils/adr-parser.js";
import { parseYaml, stringifyYaml } from "../src/utils/yaml.js";

// ── Test scaffolding fixtures ─────────────────────────────────────────

const TMP = join(tmpdir(), `dkk-test-${Date.now()}`);
const DOMAIN = join(TMP, "domain");
const CONTEXTS = join(DOMAIN, "contexts");
const ADR_DIR = join(TMP, "docs", "adr");

function setup() {
  // Create directory tree
  mkdirSync(CONTEXTS, { recursive: true });
  mkdirSync(join(CONTEXTS, "shipping"), { recursive: true });
  mkdirSync(ADR_DIR, { recursive: true });

  // domain/index.yml
  writeFileSync(
    join(DOMAIN, "index.yml"),
    [
      "contexts:",
      "  - name: ordering",
      '    description: "Order management"',
      "  - name: shipping",
      '    description: "Shipping logistics"',
      "flows:",
      "  - name: PlaceAndShip",
      '    description: "Order to shipment"',
      "    steps:",
      "      - ref: ordering.PlaceOrder",
      "        type: command",
      "      - ref: ordering.OrderPlaced",
      "        type: event",
      "      - ref: shipping.ShipOrder",
      "        type: command",
    ].join("\n"),
  );

  // domain/actors.yml
  writeFileSync(
    join(DOMAIN, "actors.yml"),
    [
      "actors:",
      "  - name: Customer",
      "    type: human",
      '    description: "A paying customer"',
      "  - name: WarehouseBot",
      "    type: system",
      '    description: "Automated warehouse robot"',
    ].join("\n"),
  );

  // domain/contexts/ordering.yml (flat context)
  writeFileSync(
    join(CONTEXTS, "ordering.yml"),
    [
      "name: ordering",
      'description: "Handles the order lifecycle"',
      "glossary:",
      "  - term: Order",
      '    definition: "A customer purchase request"',
      "events:",
      "  - name: OrderPlaced",
      '    description: "Raised when an order is placed"',
      "    fields:",
      "      - name: orderId",
      "        type: UUID",
      "    raised_by: Order",
      "commands:",
      "  - name: PlaceOrder",
      '    description: "Submit a new order"',
      "    actor: Customer",
      "    handled_by: Order",
      "aggregates:",
      "  - name: Order",
      '    description: "Order aggregate root"',
      "    handles:",
      "      - PlaceOrder",
      "    emits:",
      "      - OrderPlaced",
    ].join("\n"),
  );

  // domain/contexts/shipping/context.yml (directory context)
  writeFileSync(
    join(CONTEXTS, "shipping", "context.yml"),
    [
      "name: shipping",
      'description: "Handles shipment tracking"',
      "commands:",
      "  - name: ShipOrder",
      '    description: "Initiate shipment for an order"',
      "    handled_by: Shipment",
      "read_models:",
      "  - name: ShipmentStatus",
      '    description: "Current status of a shipment"',
      "    subscribes_to:",
      "      - ShipmentDispatched",
      "    used_by:",
      "      - Customer",
    ].join("\n"),
  );

  // docs/adr/0001-use-yaml.md
  writeFileSync(
    join(ADR_DIR, "0001-use-yaml.md"),
    [
      "---",
      "id: adr-0001",
      "title: Use YAML for domain models",
      "status: accepted",
      "date: 2026-01-15",
      "deciders:",
      "  - Alice",
      "  - Bob",
      "domain_refs:",
      "  - ordering.Order",
      "---",
      "",
      "# ADR-0001 — Use YAML for domain models",
      "",
      "## Context",
      "We need a format...",
    ].join("\n"),
  );

  // docs/adr/README.md — should be skipped
  writeFileSync(join(ADR_DIR, "README.md"), "# ADRs\n");
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

// ── Assertions ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  OK: ${label}`);
    passed++;
  } else {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Run tests ─────────────────────────────────────────────────────────

setup();

try {
  // yaml.ts
  console.log("\n=== yaml.ts ===");
  const parsed = parseYaml<{ key: string }>("key: value\n");
  assert("parseYaml parses scalar", parsed.key === "value");
  const dumped = stringifyYaml({ a: 1, b: [2, 3] });
  assert("stringifyYaml returns string", typeof dumped === "string" && dumped.includes("a: 1"));

  // adr-parser.ts
  console.log("\n=== adr-parser.ts ===");
  const adr = parseAdrFrontmatter(
    "---\nid: adr-0042\ntitle: Test\nstatus: proposed\ndate: 2026-02-20\n---\n# Hello\n",
  );
  assert("parseAdrFrontmatter returns record", adr !== null);
  assert("parseAdrFrontmatter id correct", adr?.id === "adr-0042");
  assert("parseAdrFrontmatter status correct", adr?.status === "proposed");
  const noFront = parseAdrFrontmatter("# No frontmatter here\n");
  assert("parseAdrFrontmatter returns null for missing frontmatter", noFront === null);
  const incompleteFront = parseAdrFrontmatter("---\nid: adr-0042\n---\n");
  assert("parseAdrFrontmatter returns null for incomplete frontmatter", incompleteFront === null);

  // loader.ts
  console.log("\n=== loader.ts ===");
  const model = loadDomainModel({ root: TMP });

  // Index
  assert("index.contexts has 2 entries", model.index.contexts.length === 2);
  assert("index.flows has 1 entry", model.index.flows?.length === 1);
  assert(
    "flow has 3 steps",
    model.index.flows?.[0].steps.length === 3,
  );

  // Actors
  assert("actors has 2 entries", model.actors.length === 2);
  assert("first actor is Customer", model.actors[0].name === "Customer");

  // Contexts
  assert("contexts map has 2 entries", model.contexts.size === 2);

  const ordering = model.contexts.get("ordering");
  assert("ordering context loaded", ordering !== undefined);
  assert("ordering has 1 event", ordering?.events?.length === 1);
  assert("ordering event name", ordering?.events?.[0].name === "OrderPlaced");
  assert("ordering has 1 command", ordering?.commands?.length === 1);
  assert("ordering has 1 aggregate", ordering?.aggregates?.length === 1);
  assert("ordering has 1 glossary entry", ordering?.glossary?.length === 1);

  const shipping = model.contexts.get("shipping");
  assert("shipping context loaded", shipping !== undefined);
  assert("shipping has 1 command", shipping?.commands?.length === 1);
  assert("shipping has 1 read model", shipping?.read_models?.length === 1);

  // ADRs
  assert("adrs map has 1 entry", model.adrs.size === 1);
  const adrRec = model.adrs.get("adr-0001");
  assert("adr-0001 loaded", adrRec !== undefined);
  assert("adr-0001 title correct", adrRec?.title === "Use YAML for domain models");
  assert("adr-0001 status correct", adrRec?.status === "accepted");
  assert("adr-0001 has deciders", adrRec?.deciders?.length === 2);
  assert("adr-0001 has domain_refs", adrRec?.domain_refs?.length === 1);

  // Edge: load with empty domain
  console.log("\n=== loader.ts (empty domain) ===");
  const emptyTmp = join(tmpdir(), `dkk-empty-${Date.now()}`);
  mkdirSync(join(emptyTmp, "domain", "contexts"), { recursive: true });
  mkdirSync(join(emptyTmp, "docs", "adr"), { recursive: true });
  writeFileSync(join(emptyTmp, "domain", "index.yml"), "contexts: []\n");
  writeFileSync(join(emptyTmp, "domain", "actors.yml"), "actors: []\n");

  const emptyModel = loadDomainModel({ root: emptyTmp });
  assert("empty: contexts map is empty", emptyModel.contexts.size === 0);
  assert("empty: actors is empty", emptyModel.actors.length === 0);
  assert("empty: adrs is empty", emptyModel.adrs.size === 0);
  rmSync(emptyTmp, { recursive: true, force: true });

} finally {
  teardown();
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
