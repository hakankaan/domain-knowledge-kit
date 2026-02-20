/**
 * Quick validation smoke test for all JSON Schemas.
 * Loads every schema into ajv with $ref resolution and
 * validates one good + one bad sample for key schemas.
 */
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_DIR = join(import.meta.dirname, "../../../../tools/domain-pack/schema");
const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json"));

// ---- Load all schemas into ajv ----
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const schemas = new Map();
for (const file of files) {
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf-8"));
  schemas.set(file, schema);
  ajv.addSchema(schema, schema.$id);
}

let passed = 0;
let failed = 0;

function expect(label: string, schemaId: string, data: unknown, shouldPass: boolean) {
  const valid = ajv.validate(schemaId, data);
  const ok = valid === shouldPass;
  if (!ok) {
    console.error(`FAIL: ${label}`);
    if (!shouldPass) console.error("  Expected validation to fail but it passed");
    else console.error("  Errors:", ajv.errorsText());
    failed++;
  } else {
    console.log(`  OK: ${label}`);
    passed++;
  }
}

console.log(`Loaded ${files.length} schemas: ${files.join(", ")}\n`);

// ---- actors.schema.json ----
expect("actors: valid", "actors.schema.json", {
  actors: [{ name: "Customer", type: "human", description: "A person who buys" }],
}, true);
expect("actors: missing type", "actors.schema.json", {
  actors: [{ name: "Customer", description: "A person" }],
}, false);
expect("actors: extra field", "actors.schema.json", {
  actors: [{ name: "X", type: "human", description: "Y", extra: 1 }],
}, false);

// ---- event.schema.json ----
expect("event: valid", "event.schema.json", {
  name: "OrderPlaced",
  description: "An order was placed",
  fields: [{ name: "orderId", type: "string" }],
  raised_by: "Order",
}, true);
expect("event: missing description", "event.schema.json", {
  name: "OrderPlaced",
}, false);
expect("event: bad name pattern", "event.schema.json", {
  name: "order-placed",
  description: "bad",
}, false);

// ---- command.schema.json ----
expect("command: valid", "command.schema.json", {
  name: "PlaceOrder",
  description: "Place a new order",
  actor: "Customer",
  handled_by: "Order",
}, true);

// ---- policy.schema.json ----
expect("policy: valid", "policy.schema.json", {
  name: "SendConfirmation",
  description: "Sends email after order",
  triggers: ["OrderPlaced"],
  emits: ["SendEmail"],
}, true);

// ---- aggregate.schema.json ----
expect("aggregate: valid", "aggregate.schema.json", {
  name: "Order",
  description: "Order aggregate",
  handles: ["PlaceOrder"],
  emits: ["OrderPlaced"],
}, true);

// ---- read-model.schema.json ----
expect("read-model: valid", "read-model.schema.json", {
  name: "OrderSummary",
  description: "Summary projection",
  subscribes_to: ["OrderPlaced"],
  used_by: ["Customer"],
}, true);

// ---- glossary.schema.json ----
expect("glossary: valid", "glossary.schema.json", {
  term: "Order",
  definition: "A request to purchase items",
  aliases: ["Purchase Order"],
}, true);
expect("glossary: missing definition", "glossary.schema.json", {
  term: "Order",
}, false);

// ---- adr-frontmatter.schema.json ----
expect("adr: valid", "adr-frontmatter.schema.json", {
  id: "adr-0001",
  title: "Use YAML for domain models",
  status: "accepted",
  date: "2026-02-20",
  deciders: ["Kaan"],
  domain_refs: ["ordering.OrderPlaced"],
}, true);
expect("adr: bad id", "adr-frontmatter.schema.json", {
  id: "adr-1",
  title: "Bad",
  status: "accepted",
  date: "2026-02-20",
}, false);
expect("adr: bad status", "adr-frontmatter.schema.json", {
  id: "adr-0002",
  title: "Bad status",
  status: "draft",
  date: "2026-02-20",
}, false);
expect("adr: bad domain_ref format", "adr-frontmatter.schema.json", {
  id: "adr-0003",
  title: "Bad ref",
  status: "accepted",
  date: "2026-02-20",
  domain_refs: ["not-a-valid-ref"],
}, false);

// ---- index.schema.json ----
expect("index: valid", "index.schema.json", {
  contexts: [{ name: "ordering", description: "Order management" }],
  flows: [{
    name: "Place Order Flow",
    steps: [
      { ref: "ordering.PlaceOrder", type: "command" },
      { ref: "ordering.OrderPlaced", type: "event" },
    ],
  }],
}, true);
expect("index: bad context name", "index.schema.json", {
  contexts: [{ name: "OrderContext" }],
}, false);

// ---- context.schema.json ----
expect("context: valid full", "context.schema.json", {
  name: "ordering",
  description: "Handles order lifecycle",
  glossary: [{ term: "Order", definition: "A request to buy" }],
  events: [{ name: "OrderPlaced", description: "Order was placed" }],
  commands: [{ name: "PlaceOrder", description: "Place a new order" }],
  policies: [{ name: "SendConfirmation", description: "Send email" }],
  aggregates: [{ name: "Order", description: "Order aggregate" }],
  read_models: [{ name: "OrderSummary", description: "Summary view" }],
}, true);
expect("context: minimal", "context.schema.json", {
  name: "shipping",
  description: "Handles shipment",
}, true);
expect("context: bad name", "context.schema.json", {
  name: "Ordering",
  description: "bad",
}, false);

// ---- Summary ----
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
