/**
 * Tests for the domain documentation renderer.
 *
 * Creates a temporary domain model in memory, renders it to a
 * temporary output directory, and verifies the generated files.
 */
import { mkdirSync, readFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderDocs } from "../src/features/pipeline/renderer.js";
import type {
  DomainModel,
  DomainIndex,
  Actor,
  DomainContext,
  AdrRecord,
} from "../src/shared/types/domain.js";

// ── Helpers ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function assertContains(label: string, content: string, expected: string): void {
  assert(label, content.includes(expected));
}

// ── Fixtures ──────────────────────────────────────────────────────────

const TMP = join(tmpdir(), `dkk-renderer-test-${Date.now()}`);
const OUT_DIR = join(TMP, "output");
const TPL_DIR = join(TMP, "templates");
const REAL_TPL_DIR = join(import.meta.dirname, "..", "tools", "domain-pack", "templates");

function buildModel(): DomainModel {
  const index: DomainIndex = {
    contexts: [
      { name: "ordering", description: "Order management" },
      { name: "shipping", description: "Shipping logistics" },
    ],
    flows: [
      {
        name: "PlaceAndShip",
        description: "End-to-end order to shipment",
        steps: [
          { ref: "ordering.PlaceOrder" as `${string}.${string}`, type: "command" },
          { ref: "ordering.OrderPlaced" as `${string}.${string}`, type: "event" },
          { ref: "shipping.ShipOrder" as `${string}.${string}`, type: "command" },
        ],
      },
    ],
  };

  const actors: Actor[] = [
    { name: "Customer", type: "human", description: "A paying customer" },
    { name: "WarehouseBot", type: "system", description: "Automated warehouse robot" },
  ];

  const ordering: DomainContext = {
    name: "ordering",
    description: "Handles the order lifecycle",
    glossary: [
      { term: "Order", definition: "A customer's purchase intent", aliases: ["Purchase"] },
    ],
    events: [
      {
        name: "OrderPlaced",
        description: "Emitted when a customer places an order",
        fields: [
          { name: "orderId", type: "UUID" },
          { name: "amount", type: "Money" },
        ],
        raised_by: "Order",
        adr_refs: ["adr-0001" as `adr-${string}`],
      },
    ],
    commands: [
      {
        name: "PlaceOrder",
        description: "Instructs the system to create an order",
        actor: "Customer",
        handled_by: "Order",
        fields: [{ name: "items", type: "LineItem[]" }],
      },
    ],
    policies: [
      {
        name: "SendConfirmation",
        description: "Sends an email after order placement",
        triggers: ["OrderPlaced"],
        emits: ["ConfirmationSent"],
      },
    ],
    aggregates: [
      {
        name: "Order",
        description: "Order aggregate root",
        handles: ["PlaceOrder"],
        emits: ["OrderPlaced"],
      },
    ],
    read_models: [],
  };

  const shipping: DomainContext = {
    name: "shipping",
    description: "Manages shipment creation and tracking",
    commands: [
      {
        name: "ShipOrder",
        description: "Create a shipment for an order",
        handled_by: "Shipment",
      },
    ],
    read_models: [
      {
        name: "ShipmentTracker",
        description: "Provides shipment status to customers",
        subscribes_to: ["ShipmentCreated"],
        used_by: ["Customer"],
      },
    ],
  };

  const contexts = new Map<string, DomainContext>();
  contexts.set("ordering", ordering);
  contexts.set("shipping", shipping);

  const adrs = new Map<string, AdrRecord>();
  adrs.set("adr-0001", {
    id: "adr-0001" as `adr-${string}`,
    title: "Use YAML for domain models",
    status: "accepted",
    date: "2026-01-15",
    deciders: ["Alice", "Bob"],
  });

  return { index, actors, contexts, adrs };
}

// ── Setup ─────────────────────────────────────────────────────────────

function setup() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(TPL_DIR, { recursive: true });

  // Copy real templates to temp so we test the actual templates
  for (const name of ["index.md.hbs", "context.md.hbs", "item.md.hbs"]) {
    copyFileSync(join(REAL_TPL_DIR, name), join(TPL_DIR, name));
  }
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

// ── Tests ─────────────────────────────────────────────────────────────

setup();

try {
  const model = buildModel();

  console.log("=== renderer.ts ===");

  // ── Render ──────────────────────────────────────────────────────

  const result = renderDocs(model, {
    outputDir: OUT_DIR,
    templateDir: TPL_DIR,
  });

  // ── File count ──────────────────────────────────────────────────

  console.log(`\n  Files rendered: ${result.fileCount}`);
  // Expected: 1 index + 2 context index pages + items
  //   ordering: OrderPlaced, PlaceOrder, SendConfirmation, Order, Order(glossary) = 5
  //   shipping: ShipOrder, ShipmentTracker = 2
  //   Total: 1 + 2 + 5 + 2 = 10
  assert("rendered 10 files", result.fileCount === 10);

  // ── Top-level index ─────────────────────────────────────────────

  console.log("\n  -- index.md --");
  const indexMd = readFileSync(join(OUT_DIR, "index.md"), "utf-8");
  assertContains("index has title", indexMd, "# Domain Knowledge Index");
  assertContains("index lists ordering context", indexMd, "ordering");
  assertContains("index lists shipping context", indexMd, "shipping");
  assertContains("index has actors table", indexMd, "Customer");
  assertContains("index has WarehouseBot", indexMd, "WarehouseBot");
  assertContains("index has glossary section", indexMd, "## Glossary Index");
  assertContains("index glossary has Order term", indexMd, "Order");
  assertContains("index has flows section", indexMd, "## Key Flows");
  assertContains("index flow has PlaceAndShip", indexMd, "PlaceAndShip");
  assertContains("index flow has step refs", indexMd, "ordering.PlaceOrder");

  // ── Ordering context index ──────────────────────────────────────

  console.log("\n  -- ordering/index.md --");
  const orderCtxMd = readFileSync(join(OUT_DIR, "ordering", "index.md"), "utf-8");
  assertContains("ordering has title", orderCtxMd, "# ordering");
  assertContains("ordering has description", orderCtxMd, "Handles the order lifecycle");
  assertContains("ordering has event table", orderCtxMd, "OrderPlaced");
  assertContains("ordering has command table", orderCtxMd, "PlaceOrder");
  assertContains("ordering has policy table", orderCtxMd, "SendConfirmation");
  assertContains("ordering has aggregate table", orderCtxMd, "Order");
  assertContains("ordering has glossary term", orderCtxMd, "Order");
  assertContains("ordering has linked ADR", orderCtxMd, "adr-0001");

  // ── Shipping context index ──────────────────────────────────────

  console.log("\n  -- shipping/index.md --");
  const shipCtxMd = readFileSync(join(OUT_DIR, "shipping", "index.md"), "utf-8");
  assertContains("shipping has title", shipCtxMd, "# shipping");
  assertContains("shipping has read model", shipCtxMd, "ShipmentTracker");
  assertContains("shipping has command", shipCtxMd, "ShipOrder");

  // ── Item pages ──────────────────────────────────────────────────

  console.log("\n  -- item pages --");

  // Event item
  const eventMd = readFileSync(join(OUT_DIR, "ordering", "OrderPlaced.md"), "utf-8");
  assertContains("event item has name", eventMd, "# OrderPlaced");
  assertContains("event item has type", eventMd, "Event");
  assertContains("event item has context link", eventMd, "ordering");
  assertContains("event item has description", eventMd, "Emitted when a customer places an order");
  assertContains("event item has fields table", eventMd, "orderId");
  assertContains("event item has field type", eventMd, "UUID");
  assertContains("event item has raised_by", eventMd, "Raised by");
  assertContains("event item has adr ref", eventMd, "adr-0001");

  // Command item
  const cmdMd = readFileSync(join(OUT_DIR, "ordering", "PlaceOrder.md"), "utf-8");
  assertContains("command item has name", cmdMd, "# PlaceOrder");
  assertContains("command item has actor", cmdMd, "Customer");
  assertContains("command item has handled_by", cmdMd, "Order");

  // Policy item
  const policyMd = readFileSync(join(OUT_DIR, "ordering", "SendConfirmation.md"), "utf-8");
  assertContains("policy item has name", policyMd, "# SendConfirmation");
  assertContains("policy item has trigger", policyMd, "OrderPlaced");
  assertContains("policy item has emit", policyMd, "ConfirmationSent");

  // Read model item
  const rmMd = readFileSync(join(OUT_DIR, "shipping", "ShipmentTracker.md"), "utf-8");
  assertContains("read model has name", rmMd, "# ShipmentTracker");
  assertContains("read model has subscribes_to", rmMd, "ShipmentCreated");
  assertContains("read model has used_by", rmMd, "Customer");

  // ── Edge: empty model ───────────────────────────────────────────

  console.log("\n  -- empty model --");
  const emptyOut = join(TMP, "empty-output");
  mkdirSync(emptyOut, { recursive: true });
  const emptyModel: DomainModel = {
    index: { contexts: [] },
    actors: [],
    contexts: new Map(),
    adrs: new Map(),
  };

  const emptyResult = renderDocs(emptyModel, {
    outputDir: emptyOut,
    templateDir: TPL_DIR,
  });
  assert("empty model renders 1 file (index only)", emptyResult.fileCount === 1);
  const emptyIndex = readFileSync(join(emptyOut, "index.md"), "utf-8");
  assertContains("empty index has no contexts message", emptyIndex, "No bounded contexts registered");
  assertContains("empty index has no actors message", emptyIndex, "No actors defined");

  // ── Edge: output dirs are auto-created ──────────────────────────

  console.log("\n  -- auto-create output dirs --");
  const freshOut = join(TMP, "fresh-nested", "deep", "output");
  const freshResult = renderDocs(model, {
    outputDir: freshOut,
    templateDir: TPL_DIR,
  });
  assert("fresh nested output created", existsSync(join(freshOut, "index.md")));
  assert("fresh nested has same count", freshResult.fileCount === 10);

} finally {
  teardown();
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
