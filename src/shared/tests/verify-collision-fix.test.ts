/**
 * E2E verification: glossary-aggregate namespace collision is resolved
 * in DomainGraph — structural kinds take precedence over glossary.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../loader.js";
import { DomainGraph } from "../graph.js";

const TMP = join(tmpdir(), `dkk-collision-fix-${Date.now()}`);
const DOMAIN = join(TMP, "domain");
const CONTEXTS = join(DOMAIN, "contexts");
const ADR_DIR = join(TMP, ".dkk", "adr");

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

function setup() {
  mkdirSync(join(CONTEXTS, "ordering", "events"), { recursive: true });
  mkdirSync(join(CONTEXTS, "ordering", "commands"), { recursive: true });
  mkdirSync(join(CONTEXTS, "ordering", "aggregates"), { recursive: true });
  mkdirSync(ADR_DIR, { recursive: true });

  writeFileSync(
    join(DOMAIN, "index.yml"),
    [
      "contexts:",
      "  - name: ordering",
      '    description: "Order management"',
    ].join("\n"),
  );

  writeFileSync(
    join(DOMAIN, "actors.yml"),
    ["actors:", "  - name: Customer", "    type: human", '    description: "A customer"'].join(
      "\n",
    ),
  );

  // Context where glossary term "Order" collides with aggregate "Order"
  writeFileSync(join(CONTEXTS, "ordering", "context.yml"), [
    "name: ordering",
    'description: "Handles orders"',
    "glossary:",
    "  - term: Order",
    '    definition: "A customer purchase request"',
    "  - term: LineItem",
    '    definition: "An item within an order"',
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "events", "OrderPlaced.yml"), [
    "name: OrderPlaced",
    'description: "Raised when an order is placed"',
    "raised_by: Order",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "commands", "PlaceOrder.yml"), [
    "name: PlaceOrder",
    'description: "Submit a new order"',
    "actor: Customer",
    "handled_by: Order",
  ].join("\n"));
  writeFileSync(join(CONTEXTS, "ordering", "aggregates", "Order.yml"), [
    "name: Order",
    'description: "Order aggregate root"',
    "handles:",
    "  commands:",
    "    - PlaceOrder",
    "emits:",
    "  events:",
    "    - OrderPlaced",
  ].join("\n"));

  writeFileSync(join(ADR_DIR, "README.md"), "# ADRs\n");
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

// ── Tests ─────────────────────────────────────────────────────────────

setup();

try {
  const model = loadDomainModel({ root: TMP });
  const graph = DomainGraph.from(model);

  console.log("\n=== Glossary-aggregate collision fix ===");

  // The key assertion: ordering.Order should be kind "aggregate", not "glossary"
  const orderNode = graph.nodes.get("ordering.Order");
  assert("ordering.Order node exists", orderNode !== undefined);
  assert(
    "ordering.Order kind is 'aggregate' (not 'glossary')",
    orderNode?.kind === "aggregate",
    `got kind="${orderNode?.kind}"`,
  );

  // Glossary-only terms should retain glossary kind
  const lineItemNode = graph.nodes.get("ordering.LineItem");
  assert("ordering.LineItem node exists", lineItemNode !== undefined);
  assert(
    "ordering.LineItem kind is 'glossary' (no collision)",
    lineItemNode?.kind === "glossary",
    `got kind="${lineItemNode?.kind}"`,
  );

  // Edges from glossary processing should still be wired
  const orderNeighbours = graph.getNeighbours("ordering.Order");
  assert(
    "Order aggregate neighbours include PlaceOrder",
    orderNeighbours.has("ordering.PlaceOrder"),
  );
  assert(
    "Order aggregate neighbours include OrderPlaced",
    orderNeighbours.has("ordering.OrderPlaced"),
  );
  assert(
    "Order neighbours include context.ordering (from both glossary and aggregate contains edges)",
    orderNeighbours.has("context.ordering"),
  );

  // The related command should show aggregate kind
  console.log("\n=== Related command output grouping ===");
  const related = graph.getRelated("ordering.PlaceOrder", 1);
  assert("PlaceOrder related includes ordering.Order", related.has("ordering.Order"));

  // Verify that grouped output would show "aggregate" not "glossary"
  const grouped = new Map<string, string[]>();
  for (const nId of related) {
    const node = graph.nodes.get(nId);
    const kind = node?.kind ?? "unknown";
    if (!grouped.has(kind)) grouped.set(kind, []);
    grouped.get(kind)!.push(nId);
  }
  assert(
    "related grouping shows 'aggregate' category",
    grouped.has("aggregate"),
    `categories: ${[...grouped.keys()].join(", ")}`,
  );
  assert(
    "related grouping does NOT show 'glossary' for Order",
    !(grouped.get("glossary") ?? []).includes("ordering.Order"),
  );
} finally {
  teardown();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
