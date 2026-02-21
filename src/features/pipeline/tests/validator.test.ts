/**
 * Tests for the domain model validator.
 *
 * Builds various DomainModel fixtures (valid and intentionally broken)
 * and asserts that validateDomainModel reports the expected errors and warnings.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../../../shared/loader.js";
import {
  validateDomainModel,
  type ValidationResult,
} from "../validator.js";

// ── Helpers ───────────────────────────────────────────────────────────

const SCHEMA_DIR = join(import.meta.dirname, "../../../../tools/dkk/schema");

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

function hasError(result: ValidationResult, substring: string): boolean {
  return result.errors.some((e) => e.message.includes(substring));
}

function hasWarning(result: ValidationResult, substring: string): boolean {
  return result.warnings.some((w) => w.message.includes(substring));
}

/** Create a minimal temp domain tree and return its root path. */
function makeTempRoot(suffix: string): string {
  const root = join(tmpdir(), `dkk-validator-${suffix}-${Date.now()}`);
  mkdirSync(join(root, "domain", "contexts"), { recursive: true });
  mkdirSync(join(root, ".dkk", "adr"), { recursive: true });
  return root;
}

/** Write a YAML string to a file. */
function writeYaml(path: string, content: string): void {
  writeFileSync(path, content, "utf-8");
}

/** Write an ADR Markdown file. */
function writeAdr(dir: string, filename: string, frontmatter: string): void {
  writeFileSync(
    join(dir, filename),
    `---\n${frontmatter}\n---\n\n# Title\n\nContent.\n`,
    "utf-8",
  );
}

/**
 * Write a per-item context directory under domain/contexts/<name>/.
 * - contextYaml: YAML for context.yml (contains name, description, optional glossary)
 * - items: map of sub-dir name → array of [filename, yamlContent] pairs
 */
function writeContextDir(
  root: string,
  contextYaml: string,
  items: Record<string, Array<[string, string]>> = {},
): void {
  const nameMatch = contextYaml.match(/^name:\s*(\S+)/m);
  const name = nameMatch![1];
  const ctxDir = join(root, "domain", "contexts", name);
  mkdirSync(ctxDir, { recursive: true });
  writeYaml(join(ctxDir, "context.yml"), contextYaml);
  for (const [subDir, files] of Object.entries(items)) {
    mkdirSync(join(ctxDir, subDir), { recursive: true });
    for (const [filename, content] of files) {
      writeYaml(join(ctxDir, subDir, filename), content);
    }
  }
}

// ── Test: Valid model ─────────────────────────────────────────────────

function testValidModel() {
  console.log("\n=== Valid model ===");
  const root = makeTempRoot("valid");

  writeYaml(
    join(root, "domain", "index.yml"),
    [
      "contexts:",
      "  - name: ordering",
      "flows:",
      "  - name: PlaceFlow",
      "    steps:",
      "      - ref: ordering.PlaceOrder",
      "        type: command",
      "      - ref: ordering.OrderPlaced",
      "        type: event",
    ].join("\n"),
  );

  writeYaml(
    join(root, "domain", "actors.yml"),
    [
      "actors:",
      "  - name: Customer",
      "    type: human",
      '    description: "A paying customer"',
    ].join("\n"),
  );

  writeContextDir(root, [
    "name: ordering",
    'description: "Handles orders"',
    "glossary:",
    "  - term: OrderLifecycle",
    '    definition: "The lifecycle of a purchase request"',
  ].join("\n"), {
    events: [["OrderPlaced.yml", [
      "name: OrderPlaced",
      'description: "Raised when order placed"',
      "fields:",
      "  - name: orderId",
      "    type: UUID",
      "raised_by: Order",
    ].join("\n")]],
    commands: [["PlaceOrder.yml", [
      "name: PlaceOrder",
      'description: "Submit a new order"',
      "actor: Customer",
      "handled_by: Order",
      "fields:",
      "  - name: items",
      "    type: array",
    ].join("\n")]],
    aggregates: [["Order.yml", [
      "name: Order",
      'description: "Order aggregate root"',
      "handles:",
      "  commands:",
      "    - PlaceOrder",
      "emits:",
      "  events:",
      "    - OrderPlaced",
    ].join("\n")]],
  });

  writeAdr(
    join(root, ".dkk", "adr"),
    "0001-use-yaml.md",
    [
      "id: adr-0001",
      "title: Use YAML for domain models",
      "status: accepted",
      "date: 2026-01-15",
      "domain_refs:",
      "  - ordering.OrderPlaced",
    ].join("\n"),
  );

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert("valid model has no errors", result.valid, `errors: ${result.errors.map((e) => e.message).join("; ")}`);
  assert("valid model has no warnings", result.warnings.length === 0);

  rmSync(root, { recursive: true, force: true });
}

// ── Test: Broken ADR refs ─────────────────────────────────────────────

function testBrokenAdrRefs() {
  console.log("\n=== Broken ADR refs ===");
  const root = makeTempRoot("brokenadr");

  writeYaml(
    join(root, "domain", "index.yml"),
    "contexts:\n  - name: ordering\n",
  );
  writeYaml(
    join(root, "domain", "actors.yml"),
    "actors: []\n",
  );
  writeContextDir(root, [
    "name: ordering",
    'description: "Orders"',
  ].join("\n"), {
    events: [["OrderPlaced.yml", [
      "name: OrderPlaced",
      'description: "Placed"',
      "adr_refs:",
      "  - adr-9999",
    ].join("\n")]],
  });

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert("detects unresolved adr_ref", hasError(result, "adr-9999"));
  assert("result is invalid", !result.valid);

  rmSync(root, { recursive: true, force: true });
}

// ── Test: Broken domain_refs on ADR ───────────────────────────────────

function testBrokenDomainRefs() {
  console.log("\n=== Broken ADR domain_refs ===");
  const root = makeTempRoot("brokendomainref");

  writeYaml(join(root, "domain", "index.yml"), "contexts: []\n");
  writeYaml(join(root, "domain", "actors.yml"), "actors: []\n");
  writeAdr(
    join(root, ".dkk", "adr"),
    "0001-test.md",
    [
      "id: adr-0001",
      "title: Test",
      "status: accepted",
      "date: 2026-02-20",
      "domain_refs:",
      "  - nonexistent.Thing",
    ].join("\n"),
  );

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert("detects unresolved ADR domain_ref", hasError(result, "nonexistent.Thing"));
  assert("result is invalid", !result.valid);

  rmSync(root, { recursive: true, force: true });
}

// ── Test: Broken intra-context references ─────────────────────────────

function testBrokenIntraContextRefs() {
  console.log("\n=== Broken intra-context refs ===");
  const root = makeTempRoot("brokenintra");

  writeYaml(join(root, "domain", "index.yml"), "contexts:\n  - name: sales\n");
  writeYaml(
    join(root, "domain", "actors.yml"),
    "actors:\n  - name: Admin\n    type: human\n    description: Admin user\n",
  );
  writeContextDir(root, "name: sales\ndescription: \"Sales context\"", {
    events: [["SaleCompleted.yml", [
      "name: SaleCompleted",
      'description: "A sale was completed"',
      "raised_by: NonExistentAggregate",
    ].join("\n")]],
    commands: [["CompleteSale.yml", [
      "name: CompleteSale",
      'description: "Complete a sale"',
      "handled_by: GhostAggregate",
      "actor: GhostActor",
    ].join("\n")]],
    aggregates: [["Sale.yml", [
      "name: Sale",
      'description: "Sale aggregate"',
      "handles:",
      "  commands:",
      "    - NonExistentCommand",
      "emits:",
      "  events:",
      "    - NonExistentEvent",
    ].join("\n")]],
    policies: [["NotifyOnSale.yml", [
      "name: NotifyOnSale",
      'description: "Notify on sale"',
      "when:",
      "  events:",
      "    - GhostEvent",
      "then:",
      "  commands:",
      "    - GhostCommand",
    ].join("\n")]],
    "read-models": [["SaleDashboard.yml", [
      "name: SaleDashboard",
      'description: "Dashboard"',
      "subscribes_to:",
      "  - GhostEvent",
      "used_by:",
      "  - GhostActor",
    ].join("\n")]],
  });

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert("detects event raised_by unknown aggregate", hasError(result, "raised_by") && hasError(result, "NonExistentAggregate"));
  assert("detects command handled_by unknown aggregate", hasError(result, "handled_by") && hasError(result, "GhostAggregate"));
  assert("detects command actor unknown", hasError(result, "actor") && hasError(result, "GhostActor"));
  assert("detects aggregate handles unknown command", hasError(result, "NonExistentCommand"));
  assert("detects aggregate emits unknown event", hasError(result, "NonExistentEvent"));
  assert("detects policy triggers unknown event", hasError(result, 'when.events "GhostEvent"'));
  assert("detects policy emits unknown command", hasError(result, 'then.commands "GhostCommand"'));
  assert("detects read_model subscribes_to unknown event", hasError(result, 'subscribes_to "GhostEvent"'));
  assert("detects read_model used_by unknown actor", hasError(result, 'used_by "GhostActor"'));

  rmSync(root, { recursive: true, force: true });
}

// ── Test: Duplicate names ─────────────────────────────────────────────

function testDuplicateNames() {
  console.log("\n=== Duplicate names ===");
  const root = makeTempRoot("dupes");

  writeYaml(join(root, "domain", "index.yml"), "contexts:\n  - name: ctx\n");
  writeYaml(join(root, "domain", "actors.yml"), "actors: []\n");
  writeContextDir(root, "name: ctx\ndescription: \"Test context\"", {
    events: [["Clash.yml", "name: Clash\ndescription: \"Event\""]],
    commands: [["Clash.yml", "name: Clash\ndescription: \"Command\""]],
  });

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert("detects duplicate name", hasError(result, 'Duplicate name "Clash"'));

  rmSync(root, { recursive: true, force: true });
}

// ── Test: Glossary-aggregate name collision ───────────────────────────

function testGlossaryAggregateCollision() {
  console.log("\n=== Glossary-aggregate collision ===");
  const root = makeTempRoot("glosscoll");

  writeYaml(join(root, "domain", "index.yml"), "contexts:\n  - name: ctx\n");
  writeYaml(join(root, "domain", "actors.yml"), "actors: []\n");
  writeContextDir(root, [
    "name: ctx",
    'description: "Test context"',
    "glossary:",
    "  - term: Order",
    '    definition: "A purchase"',
  ].join("\n"), {
    aggregates: [["Order.yml", "name: Order\ndescription: \"Root\""]],
  });

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert(
    "detects glossary-aggregate collision",
    hasError(result, 'Duplicate name "Order"'),
  );

  rmSync(root, { recursive: true, force: true });
}

// ── Test: Missing context file ────────────────────────────────────────

function testMissingContextFile() {
  console.log("\n=== Missing context file ===");
  const root = makeTempRoot("missingctx");

  writeYaml(
    join(root, "domain", "index.yml"),
    "contexts:\n  - name: phantom\n",
  );
  writeYaml(join(root, "domain", "actors.yml"), "actors: []\n");

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert("detects missing context file", hasError(result, "phantom"));

  rmSync(root, { recursive: true, force: true });
}

// ── Test: Broken flow step refs ───────────────────────────────────────

function testBrokenFlowSteps() {
  console.log("\n=== Broken flow step refs ===");
  const root = makeTempRoot("brokenflow");

  writeYaml(
    join(root, "domain", "index.yml"),
    [
      "contexts: []",
      "flows:",
      "  - name: BadFlow",
      "    steps:",
      "      - ref: ghost.DoThing",
      "        type: command",
    ].join("\n"),
  );
  writeYaml(join(root, "domain", "actors.yml"), "actors: []\n");

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert("detects unresolved flow step ref", hasError(result, "ghost.DoThing"));

  rmSync(root, { recursive: true, force: true });
}

// ── Test: ADR superseded_by unresolved ────────────────────────────────

function testBrokenSupersededBy() {
  console.log("\n=== ADR superseded_by unresolved ===");
  const root = makeTempRoot("superseded");

  writeYaml(join(root, "domain", "index.yml"), "contexts: []\n");
  writeYaml(join(root, "domain", "actors.yml"), "actors: []\n");
  writeAdr(
    join(root, ".dkk", "adr"),
    "0001-old.md",
    [
      "id: adr-0001",
      "title: Old decision",
      "status: superseded",
      "date: 2026-02-20",
      "superseded_by: adr-9999",
    ].join("\n"),
  );

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert("detects unresolved superseded_by", hasError(result, "adr-9999"));

  rmSync(root, { recursive: true, force: true });
}

// ── Test: warnMissingFields ───────────────────────────────────────────

function testWarnMissingFields() {
  console.log("\n=== warnMissingFields ===");
  const root = makeTempRoot("warnfields");

  writeYaml(join(root, "domain", "index.yml"), "contexts:\n  - name: ctx\n");
  writeYaml(join(root, "domain", "actors.yml"), "actors: []\n");
  writeContextDir(root, 'name: ctx\ndescription: "Test"', {
    events: [["NoFieldsEvent.yml", 'name: NoFieldsEvent\ndescription: "Event with no fields"']],
    commands: [["NoFieldsCommand.yml", 'name: NoFieldsCommand\ndescription: "Command with no fields"']],
  });

  const model = loadDomainModel({ root });

  // Without the option — no warnings
  const r1 = validateDomainModel(model, { schemaDir: SCHEMA_DIR });
  assert("no warnings when warnMissingFields is off", r1.warnings.length === 0);

  // With the option — warnings
  const r2 = validateDomainModel(model, { schemaDir: SCHEMA_DIR, warnMissingFields: true });
  assert("warns about event without fields", hasWarning(r2, "NoFieldsEvent"));
  assert("warns about command without fields", hasWarning(r2, "NoFieldsCommand"));
  assert("warnings are non-blocking", r2.valid);

  rmSync(root, { recursive: true, force: true });
}

// ── Test: Empty model (should be valid) ───────────────────────────────

function testEmptyModel() {
  console.log("\n=== Empty model ===");
  const root = makeTempRoot("empty");

  writeYaml(join(root, "domain", "index.yml"), "contexts: []\n");
  writeYaml(join(root, "domain", "actors.yml"), "actors: []\n");

  const model = loadDomainModel({ root });
  const result = validateDomainModel(model, { schemaDir: SCHEMA_DIR });

  assert("empty model is valid", result.valid);
  assert("no errors", result.errors.length === 0);
  assert("no warnings", result.warnings.length === 0);

  rmSync(root, { recursive: true, force: true });
}

// ── Run all ───────────────────────────────────────────────────────────

testValidModel();
testBrokenAdrRefs();
testBrokenDomainRefs();
testBrokenIntraContextRefs();
testDuplicateNames();
testGlossaryAggregateCollision();
testMissingContextFile();
testBrokenFlowSteps();
testBrokenSupersededBy();
testWarnMissingFields();
testEmptyModel();

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
