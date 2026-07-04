/**
 * Tests for the freshness/lifecycle validator additions:
 *
 *  - ADR supersession status linting (superseded_by ⇄ status pairing)
 *  - pending-ADR hint (no fuzzy "did you mean" for not-yet-written ADRs)
 *  - code_refs glob validation (dead bindings warn)
 *  - validateSingleFile (schema-only, cross-ref-free per-edit gate)
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../../../shared/loader.js";
import {
  validateDomainModel,
  validateSingleFile,
  type ValidationResult,
} from "../validator.js";

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

function makeTempRoot(suffix: string): string {
  const root = join(tmpdir(), `dkk-freshness-${suffix}-${Date.now()}`);
  mkdirSync(join(root, ".dkk", "domain", "contexts"), { recursive: true });
  mkdirSync(join(root, ".dkk", "adr"), { recursive: true });
  writeFileSync(join(root, ".dkk", "domain", "index.yml"), "contexts:\n  - name: ordering\n", "utf-8");
  writeFileSync(join(root, ".dkk", "domain", "actors.yml"), "actors: []\n", "utf-8");
  const ctxDir = join(root, ".dkk", "domain", "contexts", "ordering");
  mkdirSync(join(ctxDir, "aggregates"), { recursive: true });
  writeFileSync(join(ctxDir, "context.yml"), "name: ordering\ndescription: Orders.\n", "utf-8");
  return root;
}

function writeAdr(root: string, id: string, frontmatter: string): void {
  writeFileSync(
    join(root, ".dkk", "adr", `${id}.md`),
    `---\n${frontmatter}\n---\n\n# ${id}\n\nBody.\n`,
    "utf-8",
  );
}

// ── Supersession lifecycle lint ───────────────────────────────────────

function testSupersessionLint() {
  console.log("\n=== Supersession status lint ===");
  const root = makeTempRoot("supersede");

  writeAdr(root, "adr-0001", `id: adr-0001\ntitle: Old\nstatus: accepted\ndate: 2026-01-01\nsuperseded_by: adr-0002`);
  writeAdr(root, "adr-0002", `id: adr-0002\ntitle: New\nstatus: accepted\ndate: 2026-02-01`);
  writeAdr(root, "adr-0003", `id: adr-0003\ntitle: Orphaned supersede\nstatus: superseded\ndate: 2026-01-01`);
  writeAdr(root, "adr-0004", `id: adr-0004\ntitle: Correct pair\nstatus: superseded\ndate: 2026-01-01\nsuperseded_by: adr-0002`);

  const result = validateDomainModel(loadDomainModel({ root }), { schemaDir: SCHEMA_DIR, root });

  assert(
    "superseded_by with non-superseded status warns",
    hasWarning(result, `ADR "adr-0001" has superseded_by "adr-0002" but status "accepted"`),
  );
  assert(
    "superseded status without superseded_by warns",
    hasWarning(result, `ADR "adr-0003" has status "superseded" but no superseded_by`),
  );
  assert(
    "correct pairing does not warn",
    !result.warnings.some((w) => w.message.includes("adr-0004")),
  );

  rmSync(root, { recursive: true, force: true });
}

// ── Pending-ADR hint ──────────────────────────────────────────────────

function testPendingAdrHint() {
  console.log("\n=== Pending-ADR hint ===");
  const root = makeTempRoot("pending");

  writeAdr(root, "adr-0001", `id: adr-0001\ntitle: One\nstatus: accepted\ndate: 2026-01-01`);
  writeAdr(root, "adr-0002", `id: adr-0002\ntitle: Two\nstatus: accepted\ndate: 2026-01-01`);
  writeFileSync(
    join(root, ".dkk", "domain", "contexts", "ordering", "aggregates", "Order.yml"),
    "name: Order\ndescription: Order aggregate.\nadr_refs:\n  - adr-0016\n",
    "utf-8",
  );

  const result = validateDomainModel(loadDomainModel({ root }), { schemaDir: SCHEMA_DIR, root });

  const pendingErr = result.errors.find((e) => e.message.includes(`adr_ref "adr-0016"`));
  assert("ref above max is still an error", pendingErr !== undefined);
  assert(
    "pending ref gets create-it hint, not fuzzy match",
    pendingErr !== undefined && pendingErr.message.includes("No ADR with this id exists yet"),
    pendingErr?.message,
  );
  assert(
    "pending ref does NOT suggest a different ADR",
    pendingErr !== undefined && !pendingErr.message.includes("Did you mean"),
    pendingErr?.message,
  );

  // A gap BELOW the max keeps the fuzzy suggestion (likely a typo).
  writeAdr(root, "adr-0009", `id: adr-0009\ntitle: Nine\nstatus: accepted\ndate: 2026-01-01`);
  writeFileSync(
    join(root, ".dkk", "domain", "contexts", "ordering", "aggregates", "Order.yml"),
    "name: Order\ndescription: Order aggregate.\nadr_refs:\n  - adr-0003\n",
    "utf-8",
  );
  const result2 = validateDomainModel(loadDomainModel({ root }), { schemaDir: SCHEMA_DIR, root });
  const gapErr = result2.errors.find((e) => e.message.includes(`adr_ref "adr-0003"`));
  assert(
    "gap below max keeps fuzzy suggestion",
    gapErr !== undefined && gapErr.message.includes("Did you mean"),
    gapErr?.message,
  );

  rmSync(root, { recursive: true, force: true });
}

// ── code_refs glob validation ─────────────────────────────────────────

function testCodeRefsValidation() {
  console.log("\n=== code_refs glob validation ===");
  const root = makeTempRoot("coderefs");

  mkdirSync(join(root, "apps", "api", "src"), { recursive: true });
  writeFileSync(join(root, "apps", "api", "src", "order.ts"), "export {};\n", "utf-8");
  writeFileSync(
    join(root, ".dkk", "domain", "contexts", "ordering", "context.yml"),
    "name: ordering\ndescription: Orders.\ncode_refs:\n  - apps/api/src/**\n  - apps/deleted-app/**\n",
    "utf-8",
  );

  const result = validateDomainModel(loadDomainModel({ root }), { schemaDir: SCHEMA_DIR, root });

  assert("live glob does not warn", !hasWarning(result, `"apps/api/src/**"`));
  assert(
    "dead glob warns",
    hasWarning(result, `code_refs glob "apps/deleted-app/**" matches no files`),
  );
  assert("code_refs passes context schema", !hasError(result, "context.schema.json"));

  rmSync(root, { recursive: true, force: true });
}

// ── validateSingleFile ────────────────────────────────────────────────

function testValidateSingleFile() {
  console.log("\n=== validateSingleFile (schema-only) ===");
  const root = makeTempRoot("singlefile");
  const aggPath = join(root, ".dkk", "domain", "contexts", "ordering", "aggregates", "Order.yml");

  // Dangling adr_ref is FINE here: single-file mode checks schema only,
  // so mid-batch edits don't false-fail on refs to files not yet written.
  writeFileSync(aggPath, "name: Order\ndescription: Order aggregate.\nadr_refs:\n  - adr-0099\n", "utf-8");
  const ok = validateSingleFile(aggPath, { schemaDir: SCHEMA_DIR, root });
  assert("valid item with dangling ref passes (no cross-ref checks)", ok.valid, JSON.stringify(ok.errors));

  writeFileSync(aggPath, "name: Order\nbogus_field: 1\n", "utf-8");
  const bad = validateSingleFile(aggPath, { schemaDir: SCHEMA_DIR, root });
  assert("schema violation fails", !bad.valid);
  assert("reports missing description", hasError(bad, "must have required property 'description'"));
  assert("reports additional property", hasError(bad, "must NOT have additional properties"));

  const ctxPath = join(root, ".dkk", "domain", "contexts", "ordering", "context.yml");
  writeFileSync(ctxPath, "name: ordering\ndescription: Orders.\ncode_refs:\n  - apps/**\n", "utf-8");
  assert("context.yml with code_refs passes", validateSingleFile(ctxPath, { schemaDir: SCHEMA_DIR, root }).valid);

  const adrPath = join(root, ".dkk", "adr", "adr-0001.md");
  writeFileSync(adrPath, "---\nid: adr-0001\ntitle: T\nstatus: accepted\ndate: 2026-01-01\n---\n\nBody\n", "utf-8");
  assert("valid ADR frontmatter passes", validateSingleFile(adrPath, { schemaDir: SCHEMA_DIR, root }).valid);

  writeFileSync(adrPath, "---\nid: adr-0001\ntitle: T\nstatus: bogus\ndate: 2026-01-01\n---\n\nBody\n", "utf-8");
  const badAdr = validateSingleFile(adrPath, { schemaDir: SCHEMA_DIR, root });
  assert("invalid ADR status fails", !badAdr.valid);

  const otherPath = join(root, "notes.yml");
  writeFileSync(otherPath, "hello: world\n", "utf-8");
  const other = validateSingleFile(otherPath, { schemaDir: SCHEMA_DIR, root });
  assert("unrecognised file is valid with warning", other.valid && other.warnings.length === 1);

  const missing = validateSingleFile(join(root, "nope.yml"), { schemaDir: SCHEMA_DIR, root });
  assert("missing file fails", !missing.valid);

  rmSync(root, { recursive: true, force: true });
}

// ── Run all ───────────────────────────────────────────────────────────

testSupersessionLint();
testPendingAdrHint();
testCodeRefsValidation();
testValidateSingleFile();

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
