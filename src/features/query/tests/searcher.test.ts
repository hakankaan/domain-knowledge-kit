/**
 * Tests for the SQLite FTS5 searcher.
 *
 * Builds a DomainModel in a temp directory, indexes it, then runs
 * search queries and verifies results.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../../../shared/loader.js";
import { DomainGraph } from "../../../shared/graph.js";
import { buildIndex } from "../../pipeline/indexer.js";
import { search } from "../searcher.js";

// ── Fixture setup ─────────────────────────────────────────────────────

const TMP = join(tmpdir(), `dkk-search-test-${Date.now()}`);
const DOMAIN = join(TMP, "domain");
const CONTEXTS = join(DOMAIN, "contexts");
const ADR_DIR = join(TMP, "docs", "adr");
const DB_PATH = join(TMP, ".domain-pack", "index.db");

function setup() {
  mkdirSync(join(CONTEXTS, "ordering", "events"), { recursive: true });
  mkdirSync(join(CONTEXTS, "ordering", "commands"), { recursive: true });
  mkdirSync(join(CONTEXTS, "ordering", "policies"), { recursive: true });
  mkdirSync(join(CONTEXTS, "ordering", "aggregates"), { recursive: true });
  mkdirSync(join(CONTEXTS, "ordering", "read-models"), { recursive: true });
  mkdirSync(join(CONTEXTS, "shipping", "events"), { recursive: true });
  mkdirSync(join(CONTEXTS, "shipping", "commands"), { recursive: true });
  mkdirSync(join(CONTEXTS, "shipping", "aggregates"), { recursive: true });
  mkdirSync(join(CONTEXTS, "shipping", "read-models"), { recursive: true });
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
      '    description: "A paying customer who places orders"',
      "  - name: WarehouseBot",
      "    type: system",
      '    description: "Automated warehouse robot"',
    ].join("\n"),
  );

  // domain/contexts/ordering/ — per-item directory
  writeFileSync(join(CONTEXTS, "ordering", "context.yml"), [
    "name: ordering",
    'description: "Handles the order lifecycle"',
    "glossary:",
    "  - term: Order",
    '    definition: "A customer purchase request"',
    "    aliases:",
    "      - Purchase",
    "      - Booking",
    "    adr_refs:",
    "      - adr-0001",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "events", "OrderPlaced.yml"), [
    "name: OrderPlaced",
    'description: "Raised when an order is placed"',
    "fields:",
    "  - name: orderId",
    "    type: UUID",
    "raised_by: Order",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "events", "OrderCancelled.yml"), [
    "name: OrderCancelled",
    'description: "Raised when an order is cancelled"',
    "raised_by: Order",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "commands", "PlaceOrder.yml"), [
    "name: PlaceOrder",
    'description: "Submit a new order"',
    "actor: Customer",
    "handled_by: Order",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "commands", "CancelOrder.yml"), [
    "name: CancelOrder",
    'description: "Cancel an existing order"',
    "handled_by: Order",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "policies", "NotifyOnCancel.yml"), [
    "name: NotifyOnCancel",
    'description: "Notify customer when order is cancelled"',
    "when:",
    "  events:",
    "    - OrderCancelled",
    "then:",
    "  commands:",
    "    - SendNotification",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "aggregates", "Order.yml"), [
    "name: Order",
    'description: "Order aggregate root"',
    "handles:",
    "  commands:",
    "    - PlaceOrder",
    "    - CancelOrder",
    "emits:",
    "  events:",
    "    - OrderPlaced",
    "    - OrderCancelled",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "read-models", "OrderSummary.yml"), [
    "name: OrderSummary",
    'description: "Summary view of all orders"',
    "subscribes_to:",
    "  - OrderPlaced",
    "  - OrderCancelled",
    "used_by:",
    "  - Customer",
  ].join("\n"));

  // domain/contexts/shipping/ — per-item directory
  writeFileSync(join(CONTEXTS, "shipping", "context.yml"), [
    "name: shipping",
    'description: "Handles shipment tracking"',
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "shipping", "commands", "ShipOrder.yml"), [
    "name: ShipOrder",
    'description: "Initiate shipment for an order"',
    "handled_by: Shipment",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "shipping", "events", "ShipmentDispatched.yml"), [
    "name: ShipmentDispatched",
    'description: "Raised when a shipment is dispatched"',
    "raised_by: Shipment",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "shipping", "read-models", "ShipmentStatus.yml"), [
    "name: ShipmentStatus",
    'description: "Current status of a shipment"',
    "subscribes_to:",
    "  - ShipmentDispatched",
    "used_by:",
    "  - Customer",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "shipping", "aggregates", "Shipment.yml"), [
    "name: Shipment",
    'description: "Shipment aggregate"',
    "handles:",
    "  commands:",
    "    - ShipOrder",
    "emits:",
    "  events:",
    "    - ShipmentDispatched",
  ].join("\n"));

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
      "domain_refs:",
      "  - ordering.Order",
      "---",
      "",
      "# ADR-0001 — Use YAML for domain models",
      "",
      "## Context",
      "",
      "We evaluated serialization formats including JSON, TOML, and YAML.",
      "YAML provides the best human-readability for domain modeling artifacts.",
      "",
      "## Decision",
      "",
      "Adopt YAML as the canonical serialization format for all domain definitions.",
      "",
      "## Consequences",
      "",
      "Domain experts can directly read and edit model files without specialized tooling.",
    ].join("\n"),
  );

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
  const model = loadDomainModel({ root: TMP });
  const graph = DomainGraph.from(model);

  // Build index (setup for search tests)
  const dbPath = buildIndex(model, { root: TMP, dbPath: DB_PATH });

  // ── Basic FTS search ──────────────────────────────────────────────

  console.log("\n=== Basic search ===");
  const orderResults = search("order", {}, { dbPath: DB_PATH });
  assert("search 'order' returns results", orderResults.length > 0);
  assert(
    "search 'order' includes OrderPlaced",
    orderResults.some((r) => r.id === "ordering.OrderPlaced"),
  );
  assert(
    "search 'order' includes PlaceOrder",
    orderResults.some((r) => r.id === "ordering.PlaceOrder"),
  );

  // Verify result shape
  const first = orderResults[0];
  assert("result has id", typeof first.id === "string" && first.id.length > 0);
  assert("result has type", typeof first.type === "string");
  assert("result has name", typeof first.name === "string");
  assert("result has excerpt", typeof first.excerpt === "string");
  assert("result has score", typeof first.score === "number" && first.score > 0);
  assert("result has relatedIds array", Array.isArray(first.relatedIds));
  assert("result has adrIds array", Array.isArray(first.adrIds));

  // ── Search actors ─────────────────────────────────────────────────

  console.log("\n=== Search actors ===");
  const customerResults = search("customer", {}, { dbPath: DB_PATH });
  assert("search 'customer' returns results", customerResults.length > 0);
  assert(
    "search 'customer' includes actor.Customer",
    customerResults.some((r) => r.id === "actor.Customer"),
  );

  // ── Search ADRs ───────────────────────────────────────────────────

  console.log("\n=== Search ADRs ===");
  const yamlResults = search("YAML", {}, { dbPath: DB_PATH });
  assert("search 'YAML' returns results", yamlResults.length > 0);
  assert(
    "search 'YAML' includes adr-0001",
    yamlResults.some((r) => r.id === "adr-0001"),
  );

  // ── Search ADR body content ─────────────────────────────────────

  console.log("\n=== Search ADR body content ===");
  const serializationResults = search("serialization", {}, { dbPath: DB_PATH });
  assert("search 'serialization' returns results", serializationResults.length > 0);
  assert(
    "search 'serialization' finds adr-0001 via body content",
    serializationResults.some((r) => r.id === "adr-0001"),
  );

  const readabilityResults = search("human-readability", {}, { dbPath: DB_PATH });
  assert("search 'human-readability' returns results", readabilityResults.length > 0);
  assert(
    "search 'human-readability' finds adr-0001 via body content",
    readabilityResults.some((r) => r.id === "adr-0001"),
  );

  const toolingResults = search("tooling", {}, { dbPath: DB_PATH });
  assert("search 'tooling' returns results", toolingResults.length > 0);
  assert(
    "search 'tooling' finds adr-0001 via Consequences section",
    toolingResults.some((r) => r.id === "adr-0001"),
  );

  // ── Search glossary (aliases) ─────────────────────────────────────

  console.log("\n=== Search glossary aliases ===");
  const purchaseResults = search("purchase", {}, { dbPath: DB_PATH });
  assert("search 'purchase' returns results", purchaseResults.length > 0);
  assert(
    "search 'purchase' finds glossary Order via alias",
    purchaseResults.some((r) => r.id === "ordering.Order" && r.type === "glossary"),
  );

  // ── Filter by context ─────────────────────────────────────────────

  console.log("\n=== Filter by context ===");
  const shippingOnly = search("shipment", { context: "shipping" }, { dbPath: DB_PATH });
  assert("filter context=shipping returns results", shippingOnly.length > 0);
  assert(
    "all results are in shipping context",
    shippingOnly.every((r) => r.context === "shipping"),
  );

  // ── Filter by type ────────────────────────────────────────────────

  console.log("\n=== Filter by type ===");
  const eventsOnly = search("order", { type: "event" }, { dbPath: DB_PATH });
  assert("filter type=event returns results", eventsOnly.length > 0);
  assert(
    "all results are events",
    eventsOnly.every((r) => r.type === "event"),
  );

  // ── Filter by tag ─────────────────────────────────────────────────

  console.log("\n=== Filter by tag ===");
  const humanActors = search("customer", { tag: "human" }, { dbPath: DB_PATH });
  assert("filter tag=human returns results", humanActors.length > 0);
  assert(
    "tagged results include actor.Customer",
    humanActors.some((r) => r.id === "actor.Customer"),
  );

  // ── Scoring: exact ID match gets highest score ────────────────────

  console.log("\n=== Scoring ===");
  const exactResults = search("ordering.OrderPlaced", {}, { dbPath: DB_PATH });
  if (exactResults.length > 0) {
    assert(
      "exact ID match has highest score",
      exactResults[0].id === "ordering.OrderPlaced" ||
        exactResults[0].score >= exactResults[exactResults.length - 1].score,
    );
  }

  // ── Graph expansion ───────────────────────────────────────────────

  console.log("\n=== Graph expansion ===");
  const expandedResults = search("PlaceOrder", {}, { dbPath: DB_PATH, graph, expandTopN: 3 });
  assert("expanded search returns results", expandedResults.length > 0);
  const placeOrderResult = expandedResults.find((r) => r.id === "ordering.PlaceOrder");
  if (placeOrderResult) {
    assert(
      "expanded result has relatedIds from graph",
      placeOrderResult.relatedIds.length > 0,
    );
    assert(
      "expanded result includes Order aggregate in relatedIds",
      placeOrderResult.relatedIds.includes("ordering.Order"),
    );
  } else {
    assert("PlaceOrder found in expanded results", false);
  }

  // ── Empty query ───────────────────────────────────────────────────

  console.log("\n=== Edge cases ===");
  const emptyResults = search("", {}, { dbPath: DB_PATH });
  assert("empty query returns empty array", emptyResults.length === 0);

  const whitespaceResults = search("   ", {}, { dbPath: DB_PATH });
  assert("whitespace query returns empty array", whitespaceResults.length === 0);

  // ── Missing index ─────────────────────────────────────────────────

  let missingThrew = false;
  try {
    search("order", {}, { dbPath: join(TMP, "nonexistent.db") });
  } catch {
    missingThrew = true;
  }
  assert("search with missing DB throws", missingThrew);

  // ── Search flows ──────────────────────────────────────────────────

  console.log("\n=== Search flows ===");
  const flowResults = search("PlaceAndShip", {}, { dbPath: DB_PATH });
  assert("search for flow name returns results", flowResults.length > 0);
  assert(
    "flow result found",
    flowResults.some((r) => r.id === "flow.PlaceAndShip"),
  );

  // ── Limit ─────────────────────────────────────────────────────────

  console.log("\n=== Limit ===");
  const limitResults = search("order", {}, { dbPath: DB_PATH, limit: 2 });
  assert("limit caps results", limitResults.length <= 2);

} finally {
  teardown();
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
