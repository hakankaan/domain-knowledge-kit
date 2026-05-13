/**
 * Tests for the ref-parsing utility.
 *
 * Covers all five id shapes (item, adr, actor, flow, context), the
 * optional service prefix on each, and a range of invalid inputs.
 */
import { parseRef, formatRef } from "../refs.js";

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

function assertEqual<T>(label: string, actual: T, expected: T) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(label, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── Bare refs (no service prefix) ──────────────────────────────────────
console.log("\n=== bare refs ===");

assertEqual("item", parseRef("ordering.OrderPlaced"), {
  kind: "item",
  context: "ordering",
  name: "OrderPlaced",
});

assertEqual("item with multi-word context", parseRef("order-management.PlaceOrder"), {
  kind: "item",
  context: "order-management",
  name: "PlaceOrder",
});

assertEqual("adr", parseRef("adr-0001"), { kind: "adr", id: "adr-0001" });

assertEqual("actor", parseRef("actor.Customer"), { kind: "actor", name: "Customer" });

assertEqual("flow", parseRef("flow.OrderFulfillment"), { kind: "flow", name: "OrderFulfillment" });

assertEqual("context", parseRef("context.ordering"), { kind: "context", name: "ordering" });

// ── Service-prefixed refs ──────────────────────────────────────────────
console.log("\n=== service-prefixed refs ===");

assertEqual("service-prefixed item", parseRef("payments:billing.PaymentCaptured"), {
  kind: "item",
  service: "payments",
  context: "billing",
  name: "PaymentCaptured",
});

assertEqual("service-prefixed adr", parseRef("ordering:adr-0007"), {
  kind: "adr",
  service: "ordering",
  id: "adr-0007",
});

assertEqual("service-prefixed actor", parseRef("payments:actor.PaymentGateway"), {
  kind: "actor",
  service: "payments",
  name: "PaymentGateway",
});

assertEqual("service-prefixed flow", parseRef("ordering:flow.OrderFulfillment"), {
  kind: "flow",
  service: "ordering",
  name: "OrderFulfillment",
});

assertEqual("service-prefixed context", parseRef("ordering:context.ordering"), {
  kind: "context",
  service: "ordering",
  name: "ordering",
});

// ── Invalid inputs ─────────────────────────────────────────────────────
console.log("\n=== invalid inputs ===");

assert("empty string", parseRef("") === null);
assert("just a colon", parseRef(":") === null);
assert("trailing colon", parseRef("payments:") === null);
assert("PascalCase service prefix", parseRef("Payments:billing.X") === null);
assert("digits-only context", parseRef("123.PlaceOrder") === null);
assert("lowercase item name", parseRef("ordering.placeOrder") !== null); // PascalCase pattern allows leading lowercase per existing schemas
assert("snake_case context", parseRef("order_mgmt.X") === null);
assert("bad adr format", parseRef("adr-99") === null);
assert("adr with extra chars", parseRef("adr-0001x") === null);
assert("actor with bad name", parseRef("actor.bad-name") === null);
assert("flow with empty name", parseRef("flow.") === null);
assert("context with PascalCase", parseRef("context.Ordering") === null);
assert("no dot in item", parseRef("ordering") === null);
assert("dot at start", parseRef(".Foo") === null);

// ── formatRef round-trip ───────────────────────────────────────────────
console.log("\n=== formatRef round-trip ===");

const samples = [
  "ordering.OrderPlaced",
  "payments:billing.PaymentCaptured",
  "adr-0001",
  "ordering:adr-0007",
  "actor.Customer",
  "payments:actor.PaymentGateway",
  "flow.OrderFulfillment",
  "context.ordering",
];

for (const s of samples) {
  const parsed = parseRef(s);
  assert(`round-trip ${s}`, parsed !== null && formatRef(parsed) === s);
}


// ── Summary ────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
