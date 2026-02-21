/**
 * Tests for the domain graph (adjacency-list) module.
 *
 * Builds a DomainModel in-memory (via the loader's temp-dir approach)
 * and verifies that DomainGraph correctly wires nodes and edges.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../loader.js";
import { DomainGraph } from "../graph.js";

// ── Fixture setup ─────────────────────────────────────────────────────

const TMP = join(tmpdir(), `dkk-graph-test-${Date.now()}`);
const DOMAIN = join(TMP, "domain");
const CONTEXTS = join(DOMAIN, "contexts");
const ADR_DIR = join(TMP, ".domain-pack", "adr");

function setup() {
  mkdirSync(join(CONTEXTS, "ordering", "events"), { recursive: true });
  mkdirSync(join(CONTEXTS, "ordering", "commands"), { recursive: true });
  mkdirSync(join(CONTEXTS, "ordering", "policies"), { recursive: true });
  mkdirSync(join(CONTEXTS, "ordering", "aggregates"), { recursive: true });
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
      '    description: "A paying customer"',
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
    'description: "Cancel an order"',
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
  writeFileSync(join(CONTEXTS, "shipping", "read-models", "ShipmentStatus.yml"), [
    "name: ShipmentStatus",
    'description: "Current status of a shipment"',
    "subscribes_to:",
    "  - ShipmentDispatched",
    "used_by:",
    "  - Customer",
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
    ].join("\n"),
  );

  // docs/adr/0002-superseded.md
  writeFileSync(
    join(ADR_DIR, "0002-superseded.md"),
    [
      "---",
      "id: adr-0002",
      "title: Old approach",
      "status: superseded",
      "date: 2026-01-10",
      "superseded_by: adr-0001",
      "---",
      "",
      "# ADR-0002",
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

  // ── Node existence ───────────────────────────────────────────────
  console.log("\n=== Node existence ===");
  assert("actor.Customer node exists", graph.hasNode("actor.Customer"));
  assert("actor.WarehouseBot node exists", graph.hasNode("actor.WarehouseBot"));
  assert("context.ordering node exists", graph.hasNode("context.ordering"));
  assert("context.shipping node exists", graph.hasNode("context.shipping"));
  assert("ordering.OrderPlaced node exists", graph.hasNode("ordering.OrderPlaced"));
  assert("ordering.PlaceOrder node exists", graph.hasNode("ordering.PlaceOrder"));
  assert("ordering.Order (aggregate) node exists", graph.hasNode("ordering.Order"));
  assert("ordering.Order (glossary) exists", graph.hasNode("ordering.Order"));
  assert("shipping.ShipmentStatus node exists", graph.hasNode("shipping.ShipmentStatus"));
  assert("adr-0001 node exists", graph.hasNode("adr-0001"));
  assert("adr-0002 node exists", graph.hasNode("adr-0002"));
  assert("flow.PlaceAndShip node exists", graph.hasNode("flow.PlaceAndShip"));
  assert("ordering.NotifyOnCancel (policy) exists", graph.hasNode("ordering.NotifyOnCancel"));

  // ── Edge counts (sanity) ─────────────────────────────────────────
  console.log("\n=== Edge existence ===");
  assert("graph has edges", graph.edges.length > 0);

  // ── getNeighbours ────────────────────────────────────────────────
  console.log("\n=== getNeighbours ===");
  const orderAggNeighbours = graph.getNeighbours("ordering.Order");
  assert(
    "Order aggregate neighbours include PlaceOrder",
    orderAggNeighbours.has("ordering.PlaceOrder"),
  );
  assert(
    "Order aggregate neighbours include OrderPlaced",
    orderAggNeighbours.has("ordering.OrderPlaced"),
  );
  assert(
    "Order aggregate neighbours include CancelOrder",
    orderAggNeighbours.has("ordering.CancelOrder"),
  );
  assert(
    "Order aggregate neighbours include OrderCancelled",
    orderAggNeighbours.has("ordering.OrderCancelled"),
  );
  assert(
    "Order aggregate neighbours include context.ordering",
    orderAggNeighbours.has("context.ordering"),
  );

  // Command → Actor
  const placeOrderNeighbours = graph.getNeighbours("ordering.PlaceOrder");
  assert(
    "PlaceOrder neighbours include actor.Customer",
    placeOrderNeighbours.has("actor.Customer"),
  );

  // ReadModel → Event (subscribes_to)
  const shipmentStatusNeighbours = graph.getNeighbours("shipping.ShipmentStatus");
  assert(
    "ShipmentStatus subscribes_to ShipmentDispatched",
    shipmentStatusNeighbours.has("shipping.ShipmentDispatched"),
  );
  // ReadModel → Actor (used_by)
  assert(
    "ShipmentStatus used_by Customer",
    shipmentStatusNeighbours.has("actor.Customer"),
  );

  // Policy → Event (triggers) and Command (emits)
  const policyNeighbours = graph.getNeighbours("ordering.NotifyOnCancel");
  assert(
    "NotifyOnCancel triggered by OrderCancelled",
    policyNeighbours.has("ordering.OrderCancelled"),
  );
  assert(
    "NotifyOnCancel emits SendNotification",
    policyNeighbours.has("ordering.SendNotification"),
  );

  // ADR → domain_ref
  const adr0001Neighbours = graph.getNeighbours("adr-0001");
  assert("adr-0001 linked to ordering.Order", adr0001Neighbours.has("ordering.Order"));

  // ADR superseded_by
  const adr0002Neighbours = graph.getNeighbours("adr-0002");
  assert("adr-0002 superseded_by adr-0001", adr0002Neighbours.has("adr-0001"));

  // Flow steps
  const flowNeighbours = graph.getNeighbours("flow.PlaceAndShip");
  assert("flow linked to ordering.PlaceOrder", flowNeighbours.has("ordering.PlaceOrder"));
  assert("flow linked to ordering.OrderPlaced", flowNeighbours.has("ordering.OrderPlaced"));
  assert("flow linked to shipping.ShipOrder", flowNeighbours.has("shipping.ShipOrder"));

  // Flow consecutive steps linked
  const placeOrderFlowNeighbours = graph.getNeighbours("ordering.PlaceOrder");
  assert(
    "PlaceOrder flow_next to OrderPlaced",
    placeOrderFlowNeighbours.has("ordering.OrderPlaced"),
  );
  const orderPlacedFlowNeighbours = graph.getNeighbours("ordering.OrderPlaced");
  assert(
    "OrderPlaced flow_next to ShipOrder",
    orderPlacedFlowNeighbours.has("shipping.ShipOrder"),
  );

  // Glossary adr_ref
  const orderGlossaryNeighbours = graph.getNeighbours("ordering.Order");
  assert(
    "Order glossary/aggregate linked to adr-0001",
    orderGlossaryNeighbours.has("adr-0001"),
  );

  // ── getRelated (depth traversal) ─────────────────────────────────
  console.log("\n=== getRelated (BFS depth) ===");

  // depth 0 equivalent — returns empty
  const related0 = graph.getRelated("ordering.PlaceOrder", 0);
  assert("depth 0 returns empty set", related0.size === 0);

  // depth 1 — immediate neighbours
  const related1 = graph.getRelated("ordering.PlaceOrder", 1);
  assert("depth 1 includes actor.Customer", related1.has("actor.Customer"));
  assert("depth 1 includes ordering.Order", related1.has("ordering.Order"));
  assert("depth 1 includes context.ordering", related1.has("context.ordering"));

  // depth 2 — two hops out
  const related2 = graph.getRelated("ordering.PlaceOrder", 2);
  assert("depth 2 includes OrderPlaced (via Order aggregate)", related2.has("ordering.OrderPlaced"));
  // actor.Customer → shipping.ShipmentStatus (via used_by)
  assert("depth 2 includes ShipmentStatus (via Customer)", related2.has("shipping.ShipmentStatus"));

  // ── Unknown node ──────────────────────────────────────────────────
  console.log("\n=== Edge cases ===");
  const unknownRelated = graph.getRelated("nonexistent.Node", 1);
  assert("unknown node returns empty set", unknownRelated.size === 0);
  assert("hasNode returns false for unknown", !graph.hasNode("nonexistent.Node"));

  // ── Empty model ───────────────────────────────────────────────────
  console.log("\n=== Empty model ===");
  const emptyTmp = join(tmpdir(), `dkk-graph-empty-${Date.now()}`);
  mkdirSync(join(emptyTmp, "domain", "contexts"), { recursive: true });
  mkdirSync(join(emptyTmp, "docs", "adr"), { recursive: true });
  writeFileSync(join(emptyTmp, "domain", "index.yml"), "contexts: []\n");
  writeFileSync(join(emptyTmp, "domain", "actors.yml"), "actors: []\n");

  const emptyModel = loadDomainModel({ root: emptyTmp });
  const emptyGraph = DomainGraph.from(emptyModel);
  assert("empty graph has 0 nodes", emptyGraph.nodes.size === 0);
  assert("empty graph has 0 edges", emptyGraph.edges.length === 0);
  rmSync(emptyTmp, { recursive: true, force: true });

} finally {
  teardown();
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
