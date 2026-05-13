/**
 * Tests for the sparse-checkout git fetcher.
 *
 * Uses a local bare repository as the "remote" so the test runs
 * fully offline. Verifies that:
 *  - sparseFetch clones with a `.dkk/` sparse pattern.
 *  - Only `.dkk/` content is materialised; other top-level files are
 *    excluded by the sparse rule.
 *  - The returned SHA matches `HEAD` of the configured branch.
 *  - `dkk pull` populates the cache and writes a lockfile entry.
 *  - A subsequent `dkk pull` is a no-op (the SHA in the lock matches).
 *  - `dkk pull --refresh` re-fetches.
 *
 * If `git` is not available on PATH, the test is skipped (we don't
 * fail CI on environments without git).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sparseFetch } from "../git-fetcher.js";

let passed = 0;
let failed = 0;
let skipped = false;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  OK: ${label}`);
    passed++;
  } else {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!gitAvailable()) {
  console.log("git not available on PATH — skipping git-fetcher tests");
  skipped = true;
}

if (!skipped) {
  const RAW_TMP = join(tmpdir(), `dkk-git-${Date.now()}`);
  mkdirSync(RAW_TMP, { recursive: true });
  const TMP = realpathSync(RAW_TMP);

  // Layout:
  //   <TMP>/remote/         — a bare git repo (the "remote")
  //   <TMP>/source/         — a regular repo we'll push from
  //     .dkk/               — the only content sparseFetch should pull
  //       service.yml
  //       domain/.../OrderPlaced.yml
  //     README.md           — should NOT appear in the cache
  //   <TMP>/local/.dkk/imports/ordering/  — destination cache
  const REMOTE = join(TMP, "remote");
  const SOURCE = join(TMP, "source");
  const LOCAL = join(TMP, "local");
  const CACHE_DIR = join(LOCAL, ".dkk", "imports", "ordering");

  function run(args: string[], cwd: string) {
    const result = spawnSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed in ${cwd}\nstderr: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  try {
    // Create the bare remote.
    mkdirSync(REMOTE, { recursive: true });
    run(["init", "--bare", "--initial-branch=main"], REMOTE);

    // Create the source repo with .dkk/ content + a noise file.
    mkdirSync(join(SOURCE, ".dkk", "domain", "contexts", "ordering", "events"), {
      recursive: true,
    });
    writeFileSync(
      join(SOURCE, ".dkk", "service.yml"),
      "name: ordering\nexports:\n  - ordering\n",
    );
    writeFileSync(
      join(SOURCE, ".dkk", "domain", "index.yml"),
      "contexts:\n  - name: ordering\n    description: Ordering context\nflows: []\n",
    );
    writeFileSync(
      join(SOURCE, ".dkk", "domain", "actors.yml"),
      "actors: []\n",
    );
    writeFileSync(
      join(SOURCE, ".dkk", "domain", "contexts", "ordering", "context.yml"),
      "name: ordering\ndescription: Ordering bounded context\n",
    );
    writeFileSync(
      join(SOURCE, ".dkk", "domain", "contexts", "ordering", "events", "OrderPlaced.yml"),
      "name: OrderPlaced\ndescription: Raised when an order is placed.\n",
    );
    writeFileSync(join(SOURCE, "README.md"), "# Should NOT be in the sparse checkout\n");

    run(["init", "--initial-branch=main"], SOURCE);
    run(["config", "user.email", "test@example.com"], SOURCE);
    run(["config", "user.name", "Test"], SOURCE);
    run(["config", "commit.gpgsign", "false"], SOURCE);
    run(["add", "."], SOURCE);
    run(["commit", "-m", "initial"], SOURCE);
    run(["remote", "add", "origin", REMOTE], SOURCE);
    run(["push", "-u", "origin", "main"], SOURCE);
    const sourceHead = run(["rev-parse", "HEAD"], SOURCE);

    // ── sparseFetch pulls only .dkk/ ──────────────────────────────────
    console.log("\n=== sparseFetch ===");
    const result = sparseFetch({
      url: REMOTE,
      branch: "main",
      subpath: "",
      dest: CACHE_DIR,
    });

    assert("returned SHA matches source HEAD", result.sha === sourceHead);
    assert(".dkk/ exists in cache", existsSync(join(CACHE_DIR, ".dkk")));
    assert(
      "service.yml present",
      existsSync(join(CACHE_DIR, ".dkk", "service.yml")),
    );
    assert(
      "OrderPlaced.yml present",
      existsSync(
        join(CACHE_DIR, ".dkk", "domain", "contexts", "ordering", "events", "OrderPlaced.yml"),
      ),
    );
    assert(
      "README.md NOT in cache (sparse rule excluded it)",
      !existsSync(join(CACHE_DIR, "README.md")),
    );

    // ── dkk pull integrates the fetcher + lockfile ────────────────────
    console.log("\n=== dkk pull (CLI integration) ===");

    // Set up a `local` repo with a federation manifest pointing at the
    // bare remote. Wipe the cache from the previous step so `pull` has
    // to re-fetch.
    rmSync(join(LOCAL, ".dkk"), { recursive: true, force: true });
    mkdirSync(join(LOCAL, ".dkk", "domain"), { recursive: true });
    writeFileSync(
      join(LOCAL, ".dkk", "service.yml"),
      "name: billing\nexports:\n  - billing\n",
    );
    writeFileSync(
      join(LOCAL, ".dkk", "federation.yml"),
      [
        "peers:",
        "  - name: ordering",
        "    source:",
        "      type: git",
        `      url: ${REMOTE}`,
        "      branch: main",
      ].join("\n") + "\n",
    );

    const cliEntry = join(process.cwd(), "src", "cli.ts");
    const pullResult = spawnSync(
      "npx",
      ["tsx", cliEntry, "pull", "--root", LOCAL, "--json"],
      { encoding: "utf-8" },
    );
    if (pullResult.status !== 0) {
      throw new Error(`dkk pull failed: ${pullResult.stderr}\n${pullResult.stdout}`);
    }
    const pullReport = JSON.parse(pullResult.stdout) as {
      peers: { name: string; outcome: string; sha?: string }[];
    };
    assert("pull report has one peer", pullReport.peers.length === 1);
    assert(
      "ordering peer fetched",
      pullReport.peers[0].name === "ordering" && pullReport.peers[0].outcome === "fetched",
    );
    assert(
      "lockfile sha matches source HEAD",
      pullReport.peers[0].sha === sourceHead,
    );
    assert(
      "lockfile written to disk",
      existsSync(join(LOCAL, ".dkk", "federation.lock.json")),
    );

    // Subsequent pull is a no-op.
    const pullAgain = spawnSync(
      "npx",
      ["tsx", cliEntry, "pull", "--root", LOCAL, "--json"],
      { encoding: "utf-8" },
    );
    const pullAgainReport = JSON.parse(pullAgain.stdout) as {
      peers: { outcome: string }[];
    };
    assert(
      "second pull is cached (no-op)",
      pullAgainReport.peers[0].outcome === "cached",
    );

    // --refresh forces re-fetch even when cached.
    const pullRefresh = spawnSync(
      "npx",
      ["tsx", cliEntry, "pull", "--root", LOCAL, "--refresh", "--json"],
      { encoding: "utf-8" },
    );
    const pullRefreshReport = JSON.parse(pullRefresh.stdout) as {
      peers: { outcome: string }[];
    };
    assert(
      "--refresh re-fetches even when cached",
      pullRefreshReport.peers[0].outcome === "fetched",
    );

    // --offline with cache present is a no-op.
    const pullOffline = spawnSync(
      "npx",
      ["tsx", cliEntry, "pull", "--root", LOCAL, "--offline", "--json"],
      { encoding: "utf-8" },
    );
    const pullOfflineReport = JSON.parse(pullOffline.stdout) as {
      peers: { outcome: string }[];
    };
    assert(
      "--offline with cache returns skipped-offline-cached",
      pullOfflineReport.peers[0].outcome === "skipped-offline-cached",
    );

    // Verify lockfile contents.
    const lock = JSON.parse(
      readFileSync(join(LOCAL, ".dkk", "federation.lock.json"), "utf-8"),
    ) as Record<string, { source: { type: string }; sha?: string }>;
    assert("lockfile has ordering entry", lock.ordering !== undefined);
    assert("lockfile entry has git source", lock.ordering.source.type === "git");
    assert("lockfile entry has sha", typeof lock.ordering.sha === "string" && lock.ordering.sha.length > 0);

    // ── Federation loader sees the cached peer ────────────────────────
    console.log("\n=== loader sees cached peer ===");
    const showResult = spawnSync(
      "npx",
      ["tsx", cliEntry, "show", "ordering:OrderPlaced", "--root", LOCAL, "--json"],
      { encoding: "utf-8" },
    );
    if (showResult.status !== 0) {
      throw new Error(`dkk show failed: ${showResult.stderr}\n${showResult.stdout}`);
    }
    const shown = JSON.parse(showResult.stdout) as { label: string; data: { name: string } };
    assert("peer item resolved via cache", shown.data?.name === "OrderPlaced");
    assert("peer label includes [peer: ordering]", shown.label.includes("peer: ordering"));
  } finally {
    rmSync(RAW_TMP, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? " (test suite skipped)" : ""}`);
if (failed > 0) process.exit(1);
