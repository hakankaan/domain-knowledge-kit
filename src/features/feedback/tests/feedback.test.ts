/**
 * Tests for the `dkk feedback` store and report renderer.
 *
 * These run in-process (no subprocess) because store.ts is deliberately
 * separate from the command file. The privacy assertions are the highest-
 * value ones here: they are what stops a future contributor from
 * "helpfully" adding context names to the auto-captured pack summary,
 * which would leak a user's confidential business domain into a public
 * issue tracker. See ADR-0005.
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir, hostname } from "node:os";
import {
  captureEnv,
  capturePack,
  loadFeedback,
  nextFeedbackId,
  saveFeedback,
  FeedbackParseError,
  type FeedbackEntry,
} from "../store.js";
import { exportMarkdown, issueUrl, filterEntries } from "../commands/feedback.js";

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

const roots: string[] = [];
function makeRoot(suffix: string): string {
  const root = join(tmpdir(), `dkk-feedback-${suffix}-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, ".dkk"), { recursive: true });
  roots.push(root);
  return root;
}

function writeRaw(root: string, body: string): void {
  writeFileSync(join(root, ".dkk", "feedback.yml"), body, "utf-8");
}

function entry(over: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    id: "fb-0001",
    kind: "bug",
    summary: "dkk render crashes on an empty context",
    date: "2026-07-27",
    shared: false,
    ...over,
  };
}

try {
  // ── loadFeedback: degradation ───────────────────────────────────────
  console.log("\n=== loadFeedback: missing and malformed files ===");

  {
    const root = makeRoot("missing");
    const { file, skipped } = loadFeedback(root);
    assert("missing file → empty log, no throw", file.entries.length === 0 && skipped === 0);
  }

  {
    const root = makeRoot("scalar");
    writeRaw(root, "version: 1\nentries: nope\n");
    const { file, skipped } = loadFeedback(root);
    assert(
      "wrong-typed `entries:` scalar is not iterated as characters",
      file.entries.length === 0 && skipped === 1,
      `entries=${file.entries.length} skipped=${skipped}`,
    );
  }

  {
    const root = makeRoot("mixed");
    writeRaw(
      root,
      [
        "version: 1",
        "entries:",
        "  - id: fb-0001",
        "    summary: good one",
        "  - nope",
        "  - id: fb-0002", // missing summary
        "  - null",
      ].join("\n") + "\n",
    );
    const { file, skipped } = loadFeedback(root);
    assert(
      "unusable entries dropped, well-formed sibling survives",
      file.entries.length === 1 && file.entries[0].id === "fb-0001" && skipped === 3,
      `entries=${file.entries.length} skipped=${skipped}`,
    );
  }

  {
    const root = makeRoot("unparseable");
    writeRaw(root, "entries: [oops\n");
    let threw = false;
    try {
      loadFeedback(root);
    } catch (err) {
      threw = err instanceof FeedbackParseError;
    }
    assert(
      "unparseable YAML throws FeedbackParseError (never a silent empty log)",
      threw,
    );
  }

  {
    // Forward compatibility: a file written by a newer dkk must survive a
    // round trip through an older one, rather than losing its extra fields.
    const root = makeRoot("forward-compat");
    writeRaw(
      root,
      [
        "version: 1",
        "entries:",
        "  - id: fb-0001",
        "    kind: bug",
        "    summary: keeps unknown keys",
        "    date: '2026-07-27'",
        "    shared: false",
        "    severity: blocker",
        "    reactions: 7",
      ].join("\n") + "\n",
    );
    const { file } = loadFeedback(root);
    saveFeedback(file, root);
    const text = readFileSync(join(root, ".dkk", "feedback.yml"), "utf-8");
    assert(
      "unknown entry keys survive a load→save round trip",
      text.includes("severity: blocker") && text.includes("reactions: 7"),
    );
    assert("saved file carries the explanatory header comment", text.startsWith("# DKK feedback"));
  }

  // ── nextFeedbackId ──────────────────────────────────────────────────
  console.log("\n=== nextFeedbackId ===");
  assert("empty log → fb-0001", nextFeedbackId([]) === "fb-0001");
  assert(
    "max + 1, not count + 1 (a removed entry never collides)",
    nextFeedbackId([entry({ id: "fb-0001" }), entry({ id: "fb-0007" })]) === "fb-0008",
    nextFeedbackId([entry({ id: "fb-0001" }), entry({ id: "fb-0007" })]),
  );
  assert(
    "duplicate ids (post-merge) self-heal on the next add",
    nextFeedbackId([entry({ id: "fb-0004" }), entry({ id: "fb-0004" })]) === "fb-0005",
  );

  // ── Privacy — the assertions that guard ADR-0005 ────────────────────
  console.log("\n=== privacy: auto-context discloses nothing identifying ===");

  {
    const env = JSON.stringify(captureEnv());
    assert("captureEnv omits cwd", !env.includes(process.cwd()));
    assert("captureEnv omits home directory", !env.includes(homedir()));
    assert("captureEnv omits hostname", !env.includes(hostname()));
  }

  {
    const root = makeRoot("no-model");
    const pack = capturePack(root);
    assert(
      "capturePack degrades to { loaded: true, all zero } or { loaded: false } — never throws",
      pack.loaded === false || pack.contexts === 0,
      JSON.stringify(pack),
    );
  }

  {
    // A real model with a distinctively-named context: the counts must be
    // right and the name must appear nowhere in the captured summary.
    const root = makeRoot("named-model");
    const ctxDir = join(root, ".dkk", "domain", "contexts", "ordering");
    mkdirSync(join(ctxDir, "events"), { recursive: true });
    writeFileSync(
      join(root, ".dkk", "domain", "index.yml"),
      "contexts:\n  - name: ordering\n    path: contexts/ordering\n",
      "utf-8",
    );
    writeFileSync(
      join(ctxDir, "context.yml"),
      "name: ordering\ndescription: Order capture\n",
      "utf-8",
    );
    writeFileSync(
      join(ctxDir, "events", "OrderPlaced.yml"),
      "name: OrderPlaced\ndescription: An order was placed\n",
      "utf-8",
    );
    const pack = capturePack(root);
    const serialized = JSON.stringify(pack);
    assert("capturePack counts contexts", pack.contexts === 1, serialized);
    assert("capturePack counts items", pack.items === 1, serialized);
    assert(
      "capturePack never records a context name",
      !serialized.includes("ordering"),
      serialized,
    );
    assert(
      "capturePack never records an item name",
      !serialized.includes("OrderPlaced"),
      serialized,
    );
  }

  // ── filterEntries ───────────────────────────────────────────────────
  console.log("\n=== filterEntries ===");
  {
    const all = [
      entry({ id: "fb-0001", kind: "bug", shared: true }),
      entry({ id: "fb-0002", kind: "idea", shared: false }),
    ];
    assert("--kind narrows", filterEntries(all, { kind: "idea" }).length === 1);
    assert(
      "--unshared excludes shared",
      filterEntries(all, { unshared: true }).map((e) => e.id).join() === "fb-0002",
    );
    assert("no filters → everything", filterEntries(all, {}).length === 2);
  }

  // ── exportMarkdown ──────────────────────────────────────────────────
  console.log("\n=== exportMarkdown ===");
  {
    const env = { dkk: "0.5.0", node: "v21.7.3", platform: "darwin", agent: "claude-code" };
    const pack = { loaded: true, contexts: 4, items: 63, adrs: 7, actors: 5, flows: 2 };

    const one = exportMarkdown([
      entry({ detail: "stack trace here", command: "dkk render", env, pack }),
    ]);
    assert("report carries the summary", one.includes("dkk render crashes on an empty context"));
    assert("report heads each entry with id/kind/date", one.includes("### fb-0001 — bug — 2026-07-27"));
    assert("report carries the provoking command", one.includes("**Command:** `dkk render`"));
    assert("report carries the detail", one.includes("stack trace here"));
    assert(
      "uniform environment is hoisted to the header (printed once)",
      one.split("**Environment:**").length - 1 === 1,
    );

    const skewed = exportMarkdown([
      entry({ id: "fb-0001", env, pack }),
      entry({ id: "fb-0002", env: { ...env, dkk: "0.4.9" }, pack }),
    ]);
    assert(
      "version skew within one report is NOT hoisted — both shown",
      skewed.split("**Environment:**").length - 1 === 2,
    );

    const empty = exportMarkdown([]);
    assert("empty export renders a real body, never undefined", empty.trim().length > 0);
  }

  // ── issueUrl ────────────────────────────────────────────────────────
  console.log("\n=== issueUrl ===");
  {
    const single = issueUrl([entry()]);
    assert("single entry prefills only the title", single.includes("/issues/new?title="));
    assert(
      "single-entry URL stays short enough to survive any browser",
      single.length < 500,
      String(single.length),
    );
    assert(
      "multi-entry export never prefills a body (would truncate silently)",
      issueUrl([entry({ id: "fb-0001" }), entry({ id: "fb-0002" })]) ===
        "https://github.com/hakankaan/domain-knowledge-kit/issues/new",
    );
    const longSummary = "x".repeat(600);
    assert(
      "an over-long summary falls back to the bare URL",
      !issueUrl([entry({ summary: longSummary })]).includes("?title="),
    );
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
