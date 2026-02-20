/**
 * Tests for the SQLite FTS5 indexer.
 *
 * Builds a DomainModel in a temp directory, indexes it, then verifies
 * that the index is created correctly.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../../../shared/loader.js";
import { buildIndex } from "../indexer.js";

// ── Fixture setup ─────────────────────────────────────────────────────

const TMP = join(tmpdir(), `dkk-search-test-${Date.now()}`);
const DOMAIN = join(TMP, "domain");
const CONTEXTS = join(DOMAIN, "contexts");
const ADR_DIR = join(TMP, "docs", "adr");
const DB_PATH = join(TMP, ".domain-pack", "index.db");

function setup() {
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
      '    description: "A paying customer who places orders"',
      "  - name: WarehouseBot",
      "    type: system",
      '    description: "Automated warehouse robot"',
    ].join("\n"),
  );

  // domain/contexts/ordering.yml
  writeFileSync(
    join(CONTEXTS, "ordering.yml"),
    [
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
      "events:",
      "  - name: OrderPlaced",
      '    description: "Raised when an order is placed"',
      "    fields:",
      "      - name: orderId",
      "        type: UUID",
      "    raised_by: Order",
      "  - name: OrderCancelled",
      '    description: "Raised when an order is cancelled"',
      "    raised_by: Order",
      "commands:",
      "  - name: PlaceOrder",
      '    description: "Submit a new order"',
      "    actor: Customer",
      "    handled_by: Order",
      "  - name: CancelOrder",
      '    description: "Cancel an existing order"',
      "    handled_by: Order",
      "policies:",
      "  - name: NotifyOnCancel",
      '    description: "Notify customer when order is cancelled"',
      "    triggers:",
      "      - OrderCancelled",
      "    emits:",
      "      - SendNotification",
      "aggregates:",
      "  - name: Order",
      '    description: "Order aggregate root"',
      "    handles:",
      "      - PlaceOrder",
      "      - CancelOrder",
      "    emits:",
      "      - OrderPlaced",
      "      - OrderCancelled",
      "read_models:",
      "  - name: OrderSummary",
      '    description: "Summary view of all orders"',
      "    subscribes_to:",
      "      - OrderPlaced",
      "      - OrderCancelled",
      "    used_by:",
      "      - Customer",
    ].join("\n"),
  );

  // domain/contexts/shipping/context.yml
  writeFileSync(
    join(CONTEXTS, "shipping", "context.yml"),
    [
      "name: shipping",
      'description: "Handles shipment tracking"',
      "commands:",
      "  - name: ShipOrder",
      '    description: "Initiate shipment for an order"',
      "    handled_by: Shipment",
      "events:",
      "  - name: ShipmentDispatched",
      '    description: "Raised when a shipment is dispatched"',
      "    raised_by: Shipment",
      "read_models:",
      "  - name: ShipmentStatus",
      '    description: "Current status of a shipment"',
      "    subscribes_to:",
      "      - ShipmentDispatched",
      "    used_by:",
      "      - Customer",
      "aggregates:",
      "  - name: Shipment",
      '    description: "Shipment aggregate"',
      "    handles:",
      "      - ShipOrder",
      "    emits:",
      "      - ShipmentDispatched",
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

  // ── Build index ───────────────────────────────────────────────────

  console.log("\n=== Build index ===");
  const dbPath = buildIndex(model, { root: TMP, dbPath: DB_PATH });
  assert("buildIndex returns path", dbPath === DB_PATH);
  assert("index.db file exists", existsSync(DB_PATH));

  // Rebuild is idempotent — should not throw
  const dbPath2 = buildIndex(model, { root: TMP, dbPath: DB_PATH });
  assert("rebuild is idempotent", dbPath2 === DB_PATH);

} finally {
  teardown();
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
