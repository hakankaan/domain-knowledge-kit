/**
 * Tests for `dkk drift` — exercised through the real CLI against a
 * throwaway git repository, covering:
 *
 *  - stale-context detection (bound code committed after the model)
 *  - ack baseline reset (`dkk drift ack`)
 *  - dead bindings (bound paths deleted)
 *  - coverage (source dirs no context binds)
 *  - file→context mapping (`dkk drift map`)
 *  - --strict exit code
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "../../../cli.ts");
const TSX = join(import.meta.dirname, "../../../../node_modules/.bin/tsx");

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

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

interface DriftJson {
  adopted: boolean;
  gitAvailable: boolean;
  stale: Array<{ context: string; commitsSince: number }>;
  deadBindings: Array<{ context: string; glob: string }>;
  uncoveredDirs: string[];
  unboundContexts: string[];
}

function dkk(cwd: string, ...args: string[]): { status: number; stdout: string } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: res.status ?? -1, stdout: res.stdout };
}

function driftJson(cwd: string, ...extra: string[]): DriftJson {
  const res = dkk(cwd, "drift", "--json", "--minify", ...extra);
  return JSON.parse(res.stdout) as DriftJson;
}

// ── Fixture ───────────────────────────────────────────────────────────

function makeFixture(): string {
  const root = join(tmpdir(), `dkk-drift-${Date.now()}`);
  const ctxDir = join(root, ".dkk", "domain", "contexts", "ordering");
  mkdirSync(join(ctxDir, "aggregates"), { recursive: true });
  mkdirSync(join(root, ".dkk", "adr"), { recursive: true });
  mkdirSync(join(root, "apps", "api", "src"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src"), { recursive: true });

  writeFileSync(join(root, ".dkk", "domain", "index.yml"), "contexts:\n  - name: ordering\n");
  writeFileSync(join(root, ".dkk", "domain", "actors.yml"), "actors: []\n");
  writeFileSync(
    join(ctxDir, "context.yml"),
    "name: ordering\ndescription: Orders.\ncode_refs:\n  - apps/api/**\n",
  );
  writeFileSync(
    join(ctxDir, "aggregates", "Order.yml"),
    "name: Order\ndescription: Order aggregate.\nadr_refs:\n  - adr-0001\n",
  );
  writeFileSync(
    join(root, ".dkk", "adr", "adr-0001.md"),
    "---\nid: adr-0001\ntitle: T\nstatus: accepted\ndate: 2026-01-01\n---\n\nBody\n",
  );
  writeFileSync(join(root, "apps", "api", "src", "order.ts"), "export {};\n");
  writeFileSync(join(root, "apps", "web", "src", "app.ts"), "export {};\n");

  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t.co");
  git(root, "config", "user.name", "T");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "initial model + code");
  return root;
}

// ── Tests ─────────────────────────────────────────────────────────────

console.log("\n=== dkk drift ===");
const root = makeFixture();

// Fresh repo: nothing stale, web/ uncovered (only api/ is bound).
let report = driftJson(root);
assert("adopted", report.adopted);
assert("git available", report.gitAvailable);
assert("fresh repo has no stale contexts", report.stale.length === 0);
assert("no dead bindings", report.deadBindings.length === 0);
assert("apps/web uncovered", report.uncoveredDirs.includes("apps/web"));
assert("apps/api covered", !report.uncoveredDirs.includes("apps/api"));

// Land commits touching bound code → stale at threshold.
for (let i = 1; i <= 3; i++) {
  appendFileSync(join(root, "apps", "api", "src", "order.ts"), `// c${i}\n`);
  git(root, "commit", "-qam", `code change ${i}`);
}
report = driftJson(root, "--threshold", "3");
assert(
  "3 code commits ≥ threshold 3 → ordering stale",
  report.stale.some((s) => s.context === "ordering" && s.commitsSince === 3),
  JSON.stringify(report.stale),
);
assert("below threshold stays quiet", driftJson(root, "--threshold", "4").stale.length === 0);

// --strict gates, default does not.
assert("default exit 0 despite findings", dkk(root, "drift", "--threshold", "3").status === 0);
assert("--strict exits non-zero", dkk(root, "drift", "--threshold", "3", "--strict").status !== 0);

// map: bound file resolves to its context with ADRs; unbound file doesn't.
const mapRes = dkk(root, "drift", "map", "apps/api/src/order.ts", "--json", "--minify");
const mapped = JSON.parse(mapRes.stdout) as { context: string | null; adrs: string[] };
assert("map resolves bound file", mapped.context === "ordering", mapRes.stdout);
assert("map surfaces linked ADRs", mapped.adrs.includes("adr-0001"), mapRes.stdout);
const unmapped = JSON.parse(
  dkk(root, "drift", "map", "apps/web/src/app.ts", "--json", "--minify").stdout,
) as { context: string | null };
assert("map returns null for unbound file", unmapped.context === null);

// ack resets the staleness baseline.
const ackRes = dkk(root, "drift", "ack", "ordering");
assert("ack succeeds", ackRes.status === 0, ackRes.stdout);
report = driftJson(root, "--threshold", "3");
assert("acked context no longer stale", report.stale.length === 0, JSON.stringify(report.stale));

// deleting bound code → dead binding.
rmSync(join(root, "apps", "api"), { recursive: true, force: true });
git(root, "add", "-A");
git(root, "commit", "-qm", "delete api app");
report = driftJson(root);
assert(
  "deleted bound tree reported as dead binding",
  report.deadBindings.some((d) => d.context === "ordering" && d.glob === "apps/api/**"),
  JSON.stringify(report.deadBindings),
);

rmSync(root, { recursive: true, force: true });

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
