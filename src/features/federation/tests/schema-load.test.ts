/**
 * Schema-at-load tests — `.dkk/service.yml` and `.dkk/federation.yml`
 * are now validated against their JSON schemas when read, so malformed
 * manifests produce a clean error up front rather than crashing later
 * in the pipeline.
 */
import { mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadServiceId } from "../../../shared/service-id.js";
import { loadFederation } from "../loader.js";

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

function assertThrows(label: string, fn: () => unknown, match: RegExp) {
  try {
    fn();
    console.error(`FAIL: ${label} — expected throw, got success`);
    failed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (match.test(msg)) {
      console.log(`  OK: ${label}`);
      passed++;
    } else {
      console.error(`FAIL: ${label} — error did not match: ${msg}`);
      failed++;
    }
  }
}

const RAW_TMP = join(tmpdir(), `dkk-schema-load-${Date.now()}`);
mkdirSync(RAW_TMP, { recursive: true });
const TMP = realpathSync(RAW_TMP);
const ROOT = join(TMP, "repo");
mkdirSync(join(ROOT, ".dkk"), { recursive: true });

try {
  // ── service.yml: valid manifests load ────────────────────────────────
  console.log("\n=== service.yml: valid ===");
  writeFileSync(join(ROOT, ".dkk", "service.yml"), "name: billing\nexports:\n  - billing\n");
  const ok = loadServiceId(ROOT);
  assert("valid manifest loads", ok?.name === "billing");

  // ── service.yml: PascalCase name rejected ────────────────────────────
  console.log("\n=== service.yml: invalid name ===");
  writeFileSync(join(ROOT, ".dkk", "service.yml"), "name: Billing\nexports:\n  - billing\n");
  assertThrows("PascalCase service name rejected", () => loadServiceId(ROOT), /Invalid.*service\.yml/);

  // ── service.yml: missing required field ──────────────────────────────
  console.log("\n=== service.yml: missing exports ===");
  writeFileSync(join(ROOT, ".dkk", "service.yml"), "name: billing\n");
  assertThrows("missing exports rejected", () => loadServiceId(ROOT), /exports/);

  // ── service.yml: unknown property rejected ───────────────────────────
  console.log("\n=== service.yml: unknown property ===");
  writeFileSync(
    join(ROOT, ".dkk", "service.yml"),
    "name: billing\nexports:\n  - billing\nrogue: true\n",
  );
  assertThrows("unknown property rejected", () => loadServiceId(ROOT), /additional/i);

  // Restore a valid service.yml for federation tests.
  writeFileSync(join(ROOT, ".dkk", "service.yml"), "name: billing\nexports:\n  - billing\n");

  // ── federation.yml: valid local peer ─────────────────────────────────
  console.log("\n=== federation.yml: valid local ===");
  writeFileSync(
    join(ROOT, ".dkk", "federation.yml"),
    "peers:\n  - name: ordering\n    source:\n      type: local\n      path: ../order-svc\n",
  );
  const fed = loadFederation(ROOT);
  assert("valid local peer loads", fed?.peers[0].name === "ordering");

  // ── federation.yml: missing source ───────────────────────────────────
  console.log("\n=== federation.yml: missing source ===");
  writeFileSync(join(ROOT, ".dkk", "federation.yml"), "peers:\n  - name: ordering\n");
  assertThrows("missing source rejected", () => loadFederation(ROOT), /Invalid.*federation\.yml/);

  // ── federation.yml: invalid source type ──────────────────────────────
  console.log("\n=== federation.yml: bogus source type ===");
  writeFileSync(
    join(ROOT, ".dkk", "federation.yml"),
    "peers:\n  - name: ordering\n    source:\n      type: ftp\n      path: x\n",
  );
  assertThrows("invalid source type rejected", () => loadFederation(ROOT), /Invalid.*federation\.yml/);

  // ── federation.yml: git source missing branch ────────────────────────
  console.log("\n=== federation.yml: git missing branch ===");
  writeFileSync(
    join(ROOT, ".dkk", "federation.yml"),
    "peers:\n  - name: ordering\n    source:\n      type: git\n      url: https://example.com/repo.git\n",
  );
  assertThrows("git without branch rejected", () => loadFederation(ROOT), /branch/);

  // ── No manifest = null (no error) ────────────────────────────────────
  console.log("\n=== absent manifest returns null ===");
  rmSync(join(ROOT, ".dkk", "service.yml"));
  rmSync(join(ROOT, ".dkk", "federation.yml"));
  assert("loadServiceId returns null when absent", loadServiceId(ROOT) === null);
  assert("loadFederation returns null when absent", loadFederation(ROOT) === null);
} finally {
  rmSync(RAW_TMP, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
