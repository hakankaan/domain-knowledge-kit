/**
 * Tests for paths.ts — primarily the walk-up `repoRoot()` behaviour
 * introduced for monorepo / sub-directory usage.
 */
import { mkdirSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  repoRoot,
  findDkkRoot,
  serviceFile,
  federationFile,
  feedbackFile,
  importedServiceDir,
} from "../paths.js";

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

// Save and restore cwd / env around each scenario.
const originalCwd = process.cwd();
const originalDisableWalkup = process.env.DKK_DISABLE_WALKUP;

function withCwd<T>(dir: string, fn: () => T): T {
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(originalCwd);
  }
}

// ── Setup fixture: nested service repo under a parent ──────────────────
// Layout:
//   <TMP>/repo/.dkk/                        ← the real repo root
//   <TMP>/repo/services/foo/                ← service subdir, no .dkk
//   <TMP>/repo/services/foo/src/            ← deeper subdir
//   <TMP>/elsewhere/                        ← unrelated dir, no .dkk anywhere
const RAW_TMP = join(tmpdir(), `dkk-paths-${Date.now()}`);
mkdirSync(RAW_TMP, { recursive: true });
// macOS resolves /tmp -> /private/tmp at chdir; mirror that so string
// comparisons line up with process.cwd().
const TMP = realpathSync(RAW_TMP);
const REPO = join(TMP, "repo");
const SERVICE = join(REPO, "services", "foo");
const DEEP = join(SERVICE, "src");
const ELSEWHERE = join(TMP, "elsewhere");

mkdirSync(join(REPO, ".dkk"), { recursive: true });
mkdirSync(DEEP, { recursive: true });
mkdirSync(ELSEWHERE, { recursive: true });

try {
  // ── repoRoot — at the repo with .dkk ──────────────────────────────────
  console.log("\n=== repoRoot() at repo with .dkk ===");
  withCwd(REPO, () => {
    delete process.env.DKK_DISABLE_WALKUP;
    assert("cwd at root with .dkk returns cwd", repoRoot() === REPO);
  });

  // ── repoRoot — walk-up from a sub-directory ───────────────────────────
  console.log("\n=== repoRoot() walks up from sub-dir ===");
  withCwd(SERVICE, () => {
    delete process.env.DKK_DISABLE_WALKUP;
    assert("from services/foo finds repo .dkk", repoRoot() === REPO);
  });
  withCwd(DEEP, () => {
    delete process.env.DKK_DISABLE_WALKUP;
    assert("from services/foo/src finds repo .dkk", repoRoot() === REPO);
  });

  // ── Explicit --root override skips walk-up ────────────────────────────
  console.log("\n=== explicit --root override ===");
  withCwd(DEEP, () => {
    delete process.env.DKK_DISABLE_WALKUP;
    assert(
      "explicit override is used verbatim, no walk-up",
      repoRoot(ELSEWHERE) === ELSEWHERE,
    );
  });

  // ── DKK_DISABLE_WALKUP=1 disables walk-up ─────────────────────────────
  console.log("\n=== DKK_DISABLE_WALKUP=1 ===");
  withCwd(DEEP, () => {
    process.env.DKK_DISABLE_WALKUP = "1";
    assert("walk-up disabled returns cwd as-is", repoRoot() === DEEP);
    delete process.env.DKK_DISABLE_WALKUP;
  });

  // ── No .dkk anywhere — fall back to cwd ───────────────────────────────
  console.log("\n=== no .dkk anywhere, fallback to cwd ===");
  withCwd(ELSEWHERE, () => {
    delete process.env.DKK_DISABLE_WALKUP;
    assert("fallback to cwd when no .dkk on walk-up path", repoRoot() === ELSEWHERE);
  });

  // ── Federation path helpers compose correctly ─────────────────────────
  console.log("\n=== federation path helpers ===");
  assert(
    "serviceFile",
    serviceFile(REPO) === join(REPO, ".dkk", "service.yml"),
  );
  assert(
    "federationFile",
    federationFile(REPO) === join(REPO, ".dkk", "federation.yml"),
  );
  assert(
    "importedServiceDir",
    importedServiceDir("payments", REPO) === join(REPO, ".dkk", "imports", "payments"),
  );
  assert(
    "feedbackFile",
    feedbackFile(REPO) === join(REPO, ".dkk", "feedback.yml"),
  );

  // ── findDkkRoot — direct walk-up search ───────────────────────────────
  console.log("\n=== findDkkRoot ===");
  assert("findDkkRoot at repo returns repo", findDkkRoot(REPO) === REPO);
  assert("findDkkRoot from sub-dir returns repo", findDkkRoot(SERVICE) === REPO);
  assert("findDkkRoot from deep sub-dir returns repo", findDkkRoot(DEEP) === REPO);
  assert("findDkkRoot from dir with no .dkk returns null", findDkkRoot(ELSEWHERE) === null);
} finally {
  rmSync(TMP, { recursive: true, force: true });
  if (originalDisableWalkup === undefined) {
    delete process.env.DKK_DISABLE_WALKUP;
  } else {
    process.env.DKK_DISABLE_WALKUP = originalDisableWalkup;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
