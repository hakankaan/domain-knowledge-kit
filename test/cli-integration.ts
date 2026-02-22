/**
 * CLI integration tests for command wiring and error paths.
 *
 * Exercises the CLI commands (src/features/{query,pipeline,adr}/commands)
 * through their actual Commander action handlers by spawning the CLI as a child process
 * and asserting stdout/stderr/exit codes.
 *
 * Uses temporary directories with the --root flag to isolate each test.
 */
import { execFileSync, spawnSync, type ExecFileSyncOptions } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = join(import.meta.dirname, "..");
const TOOLS_DIR = join(REPO_ROOT, "tools");

// ── Helpers ───────────────────────────────────────────────────────────

const CLI = join(import.meta.dirname, "../src/cli.ts");
const TSX = "npx";
const TSX_ARGS = ["tsx", CLI];

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

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run the CLI with given arguments and return stdout, stderr, and exit code. */
function run(args: string[], opts?: { root?: string }): RunResult {
  const fullArgs = [...TSX_ARGS, ...args];
  if (opts?.root) {
    fullArgs.push("--root", opts.root);
  }

  const result = spawnSync(TSX, fullArgs, {
    encoding: "utf-8",
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    exitCode: result.status ?? 1,
  };
}

/** Create a minimal temp domain tree and return its root path. */
function makeTempRoot(suffix: string): string {
  const root = join(tmpdir(), `dkk-cli-${suffix}-${Date.now()}`);
  mkdirSync(join(root, ".dkk", "domain", "contexts"), { recursive: true });
  mkdirSync(join(root, ".dkk", "adr"), { recursive: true });
  return root;
}

/** Write a YAML string to a file inside a root. */
function writeYaml(root: string, relPath: string, content: string): void {
  writeFileSync(join(root, relPath), content, "utf-8");
}

/**
 * Write a per-item context directory under domain/contexts/<name>/.
 * - contextYaml: YAML for context.yml (name, description, optional glossary)
 * - items: map of sub-dir → array of [filename, yamlContent] pairs
 */
function writeContextDir(
  root: string,
  contextYaml: string,
  items: Record<string, Array<[string, string]>> = {},
): void {
  const nameMatch = contextYaml.match(/^name:\s*(\S+)/m);
  const name = nameMatch![1];
  const ctxDir = join(root, ".dkk", "domain", "contexts", name);
  mkdirSync(ctxDir, { recursive: true });
  writeFileSync(join(ctxDir, "context.yml"), contextYaml, "utf-8");
  for (const [subDir, files] of Object.entries(items)) {
    mkdirSync(join(ctxDir, subDir), { recursive: true });
    for (const [filename, content] of files) {
      writeFileSync(join(ctxDir, subDir, filename), content, "utf-8");
    }
  }
}

/** Write an ADR Markdown file. */
function writeAdr(root: string, filename: string, frontmatter: string, body = "Content."): void {
  writeFileSync(
    join(root, ".dkk", "adr", filename),
    `---\n${frontmatter}\n---\n\n# Title\n\n${body}\n`,
    "utf-8",
  );
}

/** Create a fully valid minimal domain for positive tests. */
function makeValidDomain(suffix: string): string {
  const root = makeTempRoot(suffix);
  // Copy templates so render command can find them
  cpSync(TOOLS_DIR, join(root, "tools"), { recursive: true });
  writeYaml(root, ".dkk/domain/index.yml", [
    "contexts:",
    "  - name: ordering",
    '    description: "Order management"',
    "flows: []",
  ].join("\n"));

  writeYaml(root, ".dkk/domain/actors.yml", [
    "actors:",
    "  - name: Customer",
    "    type: human",
    '    description: "A paying customer"',
  ].join("\n"));

  writeContextDir(root, [
    "name: ordering",
    'description: "Handles the order lifecycle"',
    "glossary:",
    "  - term: SKU",
    '    definition: "Stock keeping unit identifier"',
  ].join("\n"), {
    events: [["OrderPlaced.yml", [
      "name: OrderPlaced",
      'description: "Raised when an order is placed"',
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
    policies: [["NotifyOnOrder.yml", [
      "name: NotifyOnOrder",
      'description: "Send email when order placed"',
      "when:",
      "  events:",
      "    - OrderPlaced",
    ].join("\n")]],
  });

  return root;
}

// ── Tests ─────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

function cleanup() {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

try {
  // ═══════════════════════════════════════════════════════════════════
  // 1. validate command — exits 0 on success, exits 1 on errors
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== validate: exits 0 on valid domain ===");
  {
    const root = makeValidDomain("validate-ok");
    tempRoots.push(root);
    const result = run(["validate"], { root });
    assert("validate exits 0", result.exitCode === 0);
    assert("validate stdout mentions passed", result.stdout.includes("Validation passed"));
  }

  console.log("\n=== validate: exits 1 on broken domain ===");
  {
    const root = makeTempRoot("validate-fail");
    tempRoots.push(root);
    writeYaml(root, ".dkk/domain/index.yml", [
      "contexts:",
      "  - name: ordering",
      '    description: "Order management"',
      "flows: []",
    ].join("\n"));
    writeYaml(root, ".dkk/domain/actors.yml", "actors: []\n");
    // Create a context that references a non-existent aggregate
    writeContextDir(root, "name: ordering\ndescription: \"Handles the order lifecycle\"", {
      commands: [["PlaceOrder.yml", [
        "name: PlaceOrder",
        'description: "Submit a new order"',
        "handled_by: NonExistent",
      ].join("\n")]],
    });

    const result = run(["validate"], { root });
    assert("validate exits 1 on errors", result.exitCode === 1);
    assert("validate stderr mentions failed", result.stderr.includes("Validation failed") || result.stderr.includes("NonExistent"));
  }

  console.log("\n=== validate: --json flag produces JSON output ===");
  {
    const root = makeValidDomain("validate-json");
    tempRoots.push(root);
    const result = run(["validate", "--json"], { root });
    assert("validate --json exits 0", result.exitCode === 0);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("validate --json produces valid JSON", parsed !== null);
    assert("validate --json has valid: true", (parsed as any)?.valid === true);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. show command — exits 1 for unknown IDs, exits 0 for valid IDs
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== show: exits 1 for unknown ID ===");
  {
    const root = makeValidDomain("show-unknown");
    tempRoots.push(root);
    const result = run(["show", "ordering.NonExistent"], { root });
    assert("show unknown exits 1", result.exitCode === 1);
    assert("show unknown has error message", result.stderr.includes("not found"));
  }

  console.log("\n=== show: exits 0 for valid event ID ===");
  {
    const root = makeValidDomain("show-ok");
    tempRoots.push(root);
    const result = run(["show", "ordering.OrderPlaced"], { root });
    assert("show valid exits 0", result.exitCode === 0);
    assert("show valid stdout has item data", result.stdout.includes("OrderPlaced"));
  }

  console.log("\n=== show: --json flag for valid item ===");
  {
    const root = makeValidDomain("show-json");
    tempRoots.push(root);
    const result = run(["show", "ordering.OrderPlaced", "--json"], { root });
    assert("show --json exits 0", result.exitCode === 0);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("show --json produces valid JSON", parsed !== null);
    assert("show --json has id field", (parsed as any)?.id === "ordering.OrderPlaced");
  }

  console.log("\n=== show: --json for unknown ID ===");
  {
    const root = makeValidDomain("show-json-err");
    tempRoots.push(root);
    const result = run(["show", "ordering.BogusItem", "--json"], { root });
    assert("show --json unknown exits 1", result.exitCode === 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("show --json unknown produces JSON error", (parsed as any)?.error?.includes("not found"));
  }

  console.log("\n=== show: actor by ID ===");
  {
    const root = makeValidDomain("show-actor");
    tempRoots.push(root);
    const result = run(["show", "actor.Customer"], { root });
    assert("show actor exits 0", result.exitCode === 0);
    assert("show actor stdout has Customer", result.stdout.includes("Customer"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. search command — auto-builds index when missing
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== search: auto-builds index when missing ===");
  {
    const root = makeValidDomain("search-autoindex");
    tempRoots.push(root);
    // No render has been run, so no index exists — search should auto-build
    const result = run(["search", "order"], { root });
    assert("search auto-build exits 0", result.exitCode === 0);
    assert("search auto-build finds results", result.stdout.includes("result(s)") || result.stdout.includes("OrderPlaced"));
    assert("search auto-build prints building message", result.stderr.includes("building"));
  }

  console.log("\n=== search: --no-auto-index fails on missing index ===");
  {
    const root = makeValidDomain("search-noauto");
    tempRoots.push(root);
    // With --no-auto-index, the old fail-fast behavior is preserved
    const result = run(["search", "order", "--no-auto-index"], { root });
    assert("search --no-auto-index exits 1", result.exitCode === 1);
    assert("search --no-auto-index mentions index", result.stderr.includes("index") || result.stderr.includes("Search index not found"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4. related command — exits 1 for unknown nodes, exits 0 for valid
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== related: exits 1 for unknown node ===");
  {
    const root = makeValidDomain("related-unknown");
    tempRoots.push(root);
    const result = run(["related", "ordering.FakeItem"], { root });
    assert("related unknown exits 1", result.exitCode === 1);
    assert("related unknown has error message", result.stderr.includes("not found"));
  }

  console.log("\n=== related: exits 0 for valid node ===");
  {
    const root = makeValidDomain("related-ok");
    tempRoots.push(root);
    const result = run(["related", "ordering.OrderPlaced"], { root });
    assert("related valid exits 0", result.exitCode === 0);
    assert("related valid lists items", result.stdout.includes("related to"));
  }

  console.log("\n=== related: --json flag ===");
  {
    const root = makeValidDomain("related-json");
    tempRoots.push(root);
    const result = run(["related", "ordering.OrderPlaced", "--json"], { root });
    assert("related --json exits 0", result.exitCode === 0);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("related --json produces valid JSON", parsed !== null);
    assert("related --json has id field", (parsed as any)?.id === "ordering.OrderPlaced");
  }

  console.log("\n=== related: --json for unknown node ===");
  {
    const root = makeValidDomain("related-json-err");
    tempRoots.push(root);
    const result = run(["related", "ordering.NothingHere", "--json"], { root });
    assert("related --json unknown exits 1", result.exitCode === 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("related --json unknown produces JSON error", (parsed as any)?.error?.includes("not found"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5. list — with --context and --type filters produces correct output
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== list: unfiltered lists items ===");
  {
    const root = makeValidDomain("list-all");
    tempRoots.push(root);
    const result = run(["list"], { root });
    assert("list exits 0", result.exitCode === 0);
    assert("list shows ordering context", result.stdout.includes("ordering"));
    assert("list shows OrderPlaced", result.stdout.includes("OrderPlaced"));
    assert("list shows Customer actor", result.stdout.includes("Customer"));
  }

  console.log("\n=== list: --context filter ===");
  {
    const root = makeValidDomain("list-ctx");
    tempRoots.push(root);
    const result = run(["list", "--context", "ordering"], { root });
    assert("list --context exits 0", result.exitCode === 0);
    assert("list --context includes ordering items", result.stdout.includes("OrderPlaced"));
    // Actor (no context) should not appear when filtering by context
    assert("list --context excludes actors", !result.stdout.includes("actor.Customer"));
  }

  console.log("\n=== list: --type filter ===");
  {
    const root = makeValidDomain("list-type");
    tempRoots.push(root);
    const result = run(["list", "--type", "event"], { root });
    assert("list --type exits 0", result.exitCode === 0);
    assert("list --type=event includes events", result.stdout.includes("OrderPlaced"));
    assert("list --type=event excludes commands", !result.stdout.includes("PlaceOrder"));
  }

  console.log("\n=== list: --context and --type combined ===");
  {
    const root = makeValidDomain("list-combined");
    tempRoots.push(root);
    const result = run(["list", "--context", "ordering", "--type", "command"], { root });
    assert("list combined exits 0", result.exitCode === 0);
    assert("list combined includes PlaceOrder", result.stdout.includes("PlaceOrder"));
    assert("list combined excludes events", !result.stdout.includes("OrderPlaced"));
  }

  console.log("\n=== list: --json flag ===");
  {
    const root = makeValidDomain("list-json");
    tempRoots.push(root);
    const result = run(["list", "--json"], { root });
    assert("list --json exits 0", result.exitCode === 0);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("list --json produces valid JSON array", Array.isArray(parsed));
    assert("list --json has items", (parsed as any[])?.length > 0);
  }

  console.log("\n=== list: --type filter with no matches ===");
  {
    const root = makeValidDomain("list-nomatch");
    tempRoots.push(root);
    const result = run(["list", "--type", "flow"], { root });
    assert("list --type=flow exits 0", result.exitCode === 0);
    assert("list --type=flow shows 0 items", result.stdout.includes("0 item(s)"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6. adr show — exits 1 for unknown IDs, exits 0 for valid IDs
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== adr show: exits 1 for unknown ID ===");
  {
    const root = makeValidDomain("adr-show-unknown");
    tempRoots.push(root);
    const result = run(["adr", "show", "adr-9999"], { root });
    assert("adr show unknown exits 1", result.exitCode === 1);
    assert("adr show unknown has error message", result.stderr.includes("not found"));
  }

  console.log("\n=== adr show: exits 0 for valid ADR ===");
  {
    const root = makeValidDomain("adr-show-ok");
    tempRoots.push(root);
    writeAdr(root, "adr-0001.md", [
      "id: adr-0001",
      "title: Use YAML for domain models",
      "status: accepted",
      "date: 2025-01-15",
      "deciders:",
      "  - Alice",
      "domain_refs:",
      "  - ordering.OrderPlaced",
    ].join("\n"));

    const result = run(["adr", "show", "adr-0001"], { root });
    assert("adr show valid exits 0", result.exitCode === 0);
    assert("adr show valid has title", result.stdout.includes("Use YAML"));
  }

  console.log("\n=== adr show: --json flag ===");
  {
    const root = makeValidDomain("adr-show-json");
    tempRoots.push(root);
    writeAdr(root, "adr-0001.md", [
      "id: adr-0001",
      "title: Use YAML for domain models",
      "status: accepted",
      "date: 2025-01-15",
    ].join("\n"));

    const result = run(["adr", "show", "adr-0001", "--json"], { root });
    assert("adr show --json exits 0", result.exitCode === 0);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("adr show --json produces valid JSON", parsed !== null);
    assert("adr show --json has title", (parsed as any)?.title === "Use YAML for domain models");
  }

  console.log("\n=== adr show: --json for unknown ID ===");
  {
    const root = makeValidDomain("adr-show-json-err");
    tempRoots.push(root);
    const result = run(["adr", "show", "adr-9999", "--json"], { root });
    assert("adr show --json unknown exits 1", result.exitCode === 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("adr show --json unknown has error", (parsed as any)?.error?.includes("not found"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 7. adr related — exits 1 for unknown ADR, works for valid ADR
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== adr related: exits 1 for unknown ADR ===");
  {
    const root = makeValidDomain("adr-rel-unknown");
    tempRoots.push(root);
    const result = run(["adr", "related", "adr-9999"], { root });
    assert("adr related unknown exits 1", result.exitCode === 1);
    assert("adr related unknown has error", result.stderr.includes("not found"));
  }

  console.log("\n=== adr related: exits 0 for valid ADR with domain_refs ===");
  {
    const root = makeValidDomain("adr-rel-ok");
    tempRoots.push(root);
    writeAdr(root, "adr-0001.md", [
      "id: adr-0001",
      "title: Use YAML",
      "status: accepted",
      "date: 2025-01-15",
      "domain_refs:",
      "  - ordering.OrderPlaced",
    ].join("\n"));

    const result = run(["adr", "related", "adr-0001"], { root });
    assert("adr related valid exits 0", result.exitCode === 0);
    assert("adr related valid shows domain refs", result.stdout.includes("ordering.OrderPlaced"));
  }

  console.log("\n=== adr related: --json flag ===");
  {
    const root = makeValidDomain("adr-rel-json");
    tempRoots.push(root);
    writeAdr(root, "adr-0001.md", [
      "id: adr-0001",
      "title: Use YAML",
      "status: accepted",
      "date: 2025-01-15",
      "domain_refs:",
      "  - ordering.OrderPlaced",
    ].join("\n"));

    const result = run(["adr", "related", "adr-0001", "--json"], { root });
    assert("adr related --json exits 0", result.exitCode === 0);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("adr related --json produces valid JSON", parsed !== null);
    assert("adr related --json has id", (parsed as any)?.id === "adr-0001");
  }

  console.log("\n=== adr related: --json for unknown ADR ===");
  {
    const root = makeValidDomain("adr-rel-json-err");
    tempRoots.push(root);
    const result = run(["adr", "related", "adr-9999", "--json"], { root });
    assert("adr related --json unknown exits 1", result.exitCode === 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    assert("adr related --json unknown has error", (parsed as any)?.error?.includes("not found"));
  }

  console.log("\n=== adr related: domain item → ADR direction ===");
  {
    const root = makeValidDomain("adr-rel-reverse");
    tempRoots.push(root);
    writeAdr(root, "adr-0001.md", [
      "id: adr-0001",
      "title: Use YAML",
      "status: accepted",
      "date: 2025-01-15",
      "domain_refs:",
      "  - ordering.OrderPlaced",
    ].join("\n"));

    const result = run(["adr", "related", "ordering.OrderPlaced"], { root });
    assert("adr related reverse exits 0", result.exitCode === 0);
    assert("adr related reverse shows adr-0001", result.stdout.includes("adr-0001"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 8. render command — exits 0 on valid domain
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== render: exits 0 on valid domain ===");
  {
    const root = makeValidDomain("render-ok");
    tempRoots.push(root);
    const result = run(["render"], { root });
    assert("render exits 0", result.exitCode === 0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 9. search after render — returns results
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== search: after render returns results ===");
  {
    const root = makeValidDomain("search-after-render");
    tempRoots.push(root);
    // First render to build the index
    const renderResult = run(["render"], { root });
    assert("search: render first exits 0", renderResult.exitCode === 0);

    // Now search should work
    const result = run(["search", "order"], { root });
    assert("search after render exits 0", result.exitCode === 0);
    assert("search after render finds results", result.stdout.includes("result(s)") || result.stdout.includes("OrderPlaced"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 10. Error paths — malformed YAML causes error
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== error: malformed YAML causes exit 1 ===");
  {
    const root = makeTempRoot("bad-yaml");
    tempRoots.push(root);
    // Write syntactically invalid YAML
    writeYaml(root, ".dkk/domain/index.yml", "contexts: [\n  - name: broken\n  bad_indent");
    writeYaml(root, ".dkk/domain/actors.yml", "actors: []\n");
    const result = run(["validate"], { root });
    assert("malformed YAML exits 1", result.exitCode === 1);
    assert("malformed YAML has error msg", result.stderr.length > 0);
  }

  console.log("\n=== error: empty domain dir loads gracefully ===");
  {
    const root = makeTempRoot("nodom");
    tempRoots.push(root);
    // No index.yml or actors.yml — loader returns empty model
    const result = run(["list"], { root });
    assert("empty domain exits 0", result.exitCode === 0);
    assert("empty domain shows 0 items", result.stdout.includes("0 item(s)"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 11. init command — create, append, idempotent
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== init: creates AGENTS.md when none exists ===");
  {
    const root = makeTempRoot("init-create");
    tempRoots.push(root);
    const result = run(["init"], { root });
    assert("init exits 0", result.exitCode === 0);
    assert("init prints created", result.stdout.includes("Created"));
    const content = readFileSync(join(root, "AGENTS.md"), "utf-8");
    assert("AGENTS.md has DKK markers", content.includes("<!-- dkk:start -->") && content.includes("<!-- dkk:end -->"));
    assert("AGENTS.md has dkk prime reference", content.includes("dkk prime"));
  }

  console.log("\n=== init: appends to existing AGENTS.md ===");
  {
    const root = makeTempRoot("init-append");
    tempRoots.push(root);
    const existingContent = "# Agent Instructions\n\nExisting content here.\n";
    writeFileSync(join(root, "AGENTS.md"), existingContent, "utf-8");
    const result = run(["init"], { root });
    assert("init append exits 0", result.exitCode === 0);
    assert("init prints appended", result.stdout.includes("Appended"));
    const content = readFileSync(join(root, "AGENTS.md"), "utf-8");
    assert("preserves existing content", content.includes("Existing content here"));
    assert("appended DKK section", content.includes("<!-- dkk:start -->"));
  }

  console.log("\n=== init: idempotent on re-run ===");
  {
    const root = makeTempRoot("init-idempotent");
    tempRoots.push(root);
    // First run
    run(["init"], { root });
    const afterFirst = readFileSync(join(root, "AGENTS.md"), "utf-8");
    // Second run
    const result = run(["init"], { root });
    assert("init re-run exits 0", result.exitCode === 0);
    assert("init re-run prints updated", result.stdout.includes("Updated"));
    const afterSecond = readFileSync(join(root, "AGENTS.md"), "utf-8");
    assert("content unchanged after re-run", afterFirst === afterSecond);
    // Only one pair of markers
    const startCount = (afterSecond.match(/<!-- dkk:start -->/g) || []).length;
    assert("only one start marker", startCount === 1);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 12. prime command — stdout output with key sections
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== prime: outputs agent context ===");
  {
    const result = run(["prime"]);
    assert("prime exits 0", result.exitCode === 0);
    assert("prime has Project Overview", result.stdout.includes("Project Overview"));
    assert("prime has Core Principles", result.stdout.includes("Core Principles"));
    assert("prime has Domain Model Structure", result.stdout.includes("Domain Model Structure"));
    assert("prime has Retrieval", result.stdout.includes("Domain Search Workflow"));
    assert("prime has Making Domain Changes", result.stdout.includes("Domain Update Workflow"));
    assert("prime has ID Conventions", result.stdout.includes("ID Conventions"));
    assert("prime has CLI Command Reference", result.stdout.includes("CLI Command Reference"));
    assert("prime has File Conventions", result.stdout.includes("File Conventions"));
    assert("prime uses dkk as CLI name", result.stdout.includes("dkk list"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 13. cwd-based path resolution (no --root flag)
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== cwd resolution: validate works from project cwd without --root ===");
  {
    const root = makeValidDomain("cwd-validate");
    tempRoots.push(root);
    // Run CLI with cwd set to the temp root, NO --root flag
    const execOpts: ExecFileSyncOptions = {
      encoding: "utf-8",
      timeout: 30_000,
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
    };
    let result: RunResult;
    try {
      const stdout = execFileSync(TSX, [...TSX_ARGS, "validate"], {
        ...execOpts,
        stdio: ["pipe", "pipe", "pipe"],
      }) as unknown as string;
      result = { stdout, stderr: "", exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
      result = { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), exitCode: e.status ?? 1 };
    }
    assert("cwd validate exits 0", result.exitCode === 0);
    assert("cwd validate stdout mentions passed", result.stdout.includes("Validation passed"));
  }

  console.log("\n=== cwd resolution: list works from project cwd without --root ===");
  {
    const root = makeValidDomain("cwd-list");
    tempRoots.push(root);
    const execOpts: ExecFileSyncOptions = {
      encoding: "utf-8",
      timeout: 30_000,
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
    };
    let result: RunResult;
    try {
      const stdout = execFileSync(TSX, [...TSX_ARGS, "list"], {
        ...execOpts,
        stdio: ["pipe", "pipe", "pipe"],
      }) as unknown as string;
      result = { stdout, stderr: "", exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
      result = { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), exitCode: e.status ?? 1 };
    }
    assert("cwd list exits 0", result.exitCode === 0);
    assert("cwd list shows OrderPlaced", result.stdout.includes("OrderPlaced"));
    assert("cwd list shows Customer", result.stdout.includes("Customer"));
  }

  console.log("\n=== cwd resolution: render works from project cwd without --root ===");
  {
    const root = makeValidDomain("cwd-render");
    tempRoots.push(root);
    const execOpts: ExecFileSyncOptions = {
      encoding: "utf-8",
      timeout: 30_000,
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
    };
    let result: RunResult;
    try {
      const stdout = execFileSync(TSX, [...TSX_ARGS, "render"], {
        ...execOpts,
        stdio: ["pipe", "pipe", "pipe"],
      }) as unknown as string;
      result = { stdout, stderr: "", exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
      result = { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), exitCode: e.status ?? 1 };
    }
    assert("cwd render exits 0", result.exitCode === 0);
    // Verify docs were written into the cwd-based root
    const docsExist = existsSync(join(root, ".dkk", "docs", "index.md"));
    assert("cwd render creates docs in project dir", docsExist);
    // Verify search index was written into the cwd-based root
    const indexExists = existsSync(join(root, ".dkk", "index.db"));
    assert("cwd render creates search index in project dir", indexExists);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 14. Smoke test: all commands registered in --help output
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== smoke: all commands registered in --help ===");
  {
    const result = run(["--help"]);
    assert("--help exits 0", result.exitCode === 0);
    const helpText = result.stdout;
    const topLevelCommands = ["list", "show", "search", "related", "validate", "render", "init", "prime", "adr", "new"];
    for (const cmd of topLevelCommands) {
      assert(`--help lists '${cmd}' command`, helpText.includes(cmd));
    }

    // Also verify the adr sub-commands
    const adrResult = run(["adr", "--help"]);
    assert("adr --help exits 0", adrResult.exitCode === 0);
    const adrHelp = adrResult.stdout;
    const adrSubCommands = ["show", "related"];
    for (const sub of adrSubCommands) {
      assert(`adr --help lists '${sub}' sub-command`, adrHelp.includes(sub));
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 15. new domain — scaffolds full .dkk/domain/ structure
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== new domain: scaffolds full domain structure ===");
  {
    const root = makeTempRoot("new-domain");
    // Remove the pre-created domain structure so new domain can create fresh
    rmSync(join(root, ".dkk"), { recursive: true, force: true });
    tempRoots.push(root);
    const result = run(["new", "domain"], { root });
    assert("new domain exits 0", result.exitCode === 0);
    assert("new domain creates index.yml", existsSync(join(root, ".dkk", "domain", "index.yml")));
    assert("new domain creates actors.yml", existsSync(join(root, ".dkk", "domain", "actors.yml")));
    assert("new domain creates context.yml", existsSync(join(root, ".dkk", "domain", "contexts", "sample", "context.yml")));
    assert("new domain creates sample event", existsSync(join(root, ".dkk", "domain", "contexts", "sample", "events", "SampleCreated.yml")));
    assert("new domain creates sample command", existsSync(join(root, ".dkk", "domain", "contexts", "sample", "commands", "CreateSample.yml")));
    assert("new domain creates sample aggregate", existsSync(join(root, ".dkk", "domain", "contexts", "sample", "aggregates", "Sample.yml")));
    assert("new domain creates policies dir", existsSync(join(root, ".dkk", "domain", "contexts", "sample", "policies")));
    assert("new domain creates read-models dir", existsSync(join(root, ".dkk", "domain", "contexts", "sample", "read-models")));
    assert("new domain stdout mentions created", result.stdout.includes("Created"));
  }

  console.log("\n=== new domain: validates and renders successfully ===");
  {
    const root = makeTempRoot("new-domain-render");
    rmSync(join(root, ".dkk"), { recursive: true, force: true });
    tempRoots.push(root);
    // Copy tools so render can find templates
    cpSync(TOOLS_DIR, join(root, "tools"), { recursive: true });
    const scaffoldResult = run(["new", "domain"], { root });
    assert("new domain scaffold exits 0", scaffoldResult.exitCode === 0);
    const renderResult = run(["render"], { root });
    assert("new domain + render exits 0", renderResult.exitCode === 0);
    assert("new domain + render creates docs", existsSync(join(root, ".dkk", "docs", "index.md")));
  }

  console.log("\n=== new domain: errors when domain already exists ===");
  {
    const root = makeValidDomain("new-domain-exists");
    tempRoots.push(root);
    const result = run(["new", "domain"], { root });
    assert("new domain existing exits 1", result.exitCode === 1);
    assert("new domain existing has error", result.stderr.includes("already exists"));
  }

  console.log("\n=== new domain: --force overwrites existing domain ===");
  {
    const root = makeValidDomain("new-domain-force");
    tempRoots.push(root);
    const result = run(["new", "domain", "--force"], { root });
    assert("new domain --force exits 0", result.exitCode === 0);
    assert("new domain --force creates sample context", existsSync(join(root, ".dkk", "domain", "contexts", "sample", "context.yml")));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 16. new context — scaffolds context directory and registers in index
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== new context: creates directory and registers in index ===");
  {
    const root = makeValidDomain("new-context");
    tempRoots.push(root);
    const result = run(["new", "context", "shipping", "--description", "Shipping and delivery"], { root });
    assert("new context exits 0", result.exitCode === 0);
    assert("new context creates context.yml", existsSync(join(root, ".dkk", "domain", "contexts", "shipping", "context.yml")));
    assert("new context creates events dir", existsSync(join(root, ".dkk", "domain", "contexts", "shipping", "events")));
    assert("new context creates commands dir", existsSync(join(root, ".dkk", "domain", "contexts", "shipping", "commands")));
    assert("new context creates aggregates dir", existsSync(join(root, ".dkk", "domain", "contexts", "shipping", "aggregates")));
    assert("new context creates policies dir", existsSync(join(root, ".dkk", "domain", "contexts", "shipping", "policies")));
    assert("new context creates read-models dir", existsSync(join(root, ".dkk", "domain", "contexts", "shipping", "read-models")));

    // Verify context.yml content
    const ctxContent = readFileSync(join(root, ".dkk", "domain", "contexts", "shipping", "context.yml"), "utf-8");
    assert("new context context.yml has name", ctxContent.includes("name: shipping"));
    assert("new context context.yml has description", ctxContent.includes("Shipping and delivery"));

    // Verify index.yml was updated
    const indexContent = readFileSync(join(root, ".dkk", "domain", "index.yml"), "utf-8");
    assert("new context registered in index", indexContent.includes("shipping"));
  }

  console.log("\n=== new context: errors when context already exists ===");
  {
    const root = makeValidDomain("new-context-exists");
    tempRoots.push(root);
    const result = run(["new", "context", "ordering"], { root });
    assert("new context existing exits 1", result.exitCode === 1);
    assert("new context existing has error", result.stderr.includes("already exists"));
  }

  console.log("\n=== new context: errors on invalid name ===");
  {
    const root = makeValidDomain("new-context-invalid");
    tempRoots.push(root);
    const result = run(["new", "context", "InvalidName"], { root });
    assert("new context invalid name exits 1", result.exitCode === 1);
    assert("new context invalid name has error", result.stderr.includes("invalid"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 17. new adr — scaffolds ADR file with correct numbering
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== new adr: creates first ADR file ===");
  {
    const root = makeTempRoot("new-adr");
    // Remove pre-created adr dir to start fresh
    rmSync(join(root, ".dkk", "adr"), { recursive: true, force: true });
    tempRoots.push(root);
    const result = run(["new", "adr", "Use Event Sourcing"], { root });
    assert("new adr exits 0", result.exitCode === 0);
    assert("new adr creates adr-0001.md", existsSync(join(root, ".dkk", "adr", "adr-0001.md")));

    const content = readFileSync(join(root, ".dkk", "adr", "adr-0001.md"), "utf-8");
    assert("new adr has frontmatter id", content.includes("id: adr-0001"));
    assert("new adr has title", content.includes("title: Use Event Sourcing"));
    assert("new adr default status is proposed", content.includes("status: proposed"));
    assert("new adr has date", content.includes("date:"));
  }

  console.log("\n=== new adr: auto-increments number ===");
  {
    const root = makeTempRoot("new-adr-inc");
    tempRoots.push(root);
    // Create first ADR
    writeAdr(root, "adr-0001.md", [
      "id: adr-0001",
      "title: First Decision",
      "status: accepted",
      "date: 2025-01-01",
    ].join("\n"));

    const result = run(["new", "adr", "Second Decision"], { root });
    assert("new adr increment exits 0", result.exitCode === 0);
    assert("new adr increment creates adr-0002.md", existsSync(join(root, ".dkk", "adr", "adr-0002.md")));
    assert("new adr stdout mentions adr-0002", result.stdout.includes("adr-0002"));
  }

  console.log("\n=== new adr: --status flag ===");
  {
    const root = makeTempRoot("new-adr-status");
    rmSync(join(root, ".dkk", "adr"), { recursive: true, force: true });
    tempRoots.push(root);
    const result = run(["new", "adr", "Accept CQRS", "--status", "accepted"], { root });
    assert("new adr --status exits 0", result.exitCode === 0);
    const content = readFileSync(join(root, ".dkk", "adr", "adr-0001.md"), "utf-8");
    assert("new adr --status=accepted in frontmatter", content.includes("status: accepted"));
  }

  console.log("\n=== new adr: invalid status errors ===");
  {
    const root = makeTempRoot("new-adr-bad-status");
    tempRoots.push(root);
    const result = run(["new", "adr", "Bad Status", "--status", "invalid"], { root });
    assert("new adr invalid status exits 1", result.exitCode === 1);
    assert("new adr invalid status has error", result.stderr.includes("Invalid status"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 18. new --help — shows all subcommands
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== new --help: lists all subcommands ===");
  {
    const result = run(["new", "--help"]);
    assert("new --help exits 0", result.exitCode === 0);
    assert("new --help lists domain", result.stdout.includes("domain"));
    assert("new --help lists context", result.stdout.includes("context"));
    assert("new --help lists adr", result.stdout.includes("adr"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 19. add — scaffold individual domain items
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== add event: creates event YAML file ===");
  {
    const root = makeValidDomain("add-event");
    tempRoots.push(root);
    const result = run(["add", "event", "OrderShipped", "--context", "ordering", "--description", "Raised when order ships"], { root });
    assert("add event exits 0", result.exitCode === 0);
    const filePath = join(root, ".dkk", "domain", "contexts", "ordering", "events", "OrderShipped.yml");
    assert("add event creates file", existsSync(filePath));
    const content = readFileSync(filePath, "utf-8");
    assert("add event has name", content.includes("name: OrderShipped"));
    assert("add event has description", content.includes("description: Raised when order ships"));
  }

  console.log("\n=== add command: creates command YAML file ===");
  {
    const root = makeValidDomain("add-command");
    tempRoots.push(root);
    const result = run(["add", "command", "CancelOrder", "--context", "ordering", "--description", "Cancel an existing order"], { root });
    assert("add command exits 0", result.exitCode === 0);
    const filePath = join(root, ".dkk", "domain", "contexts", "ordering", "commands", "CancelOrder.yml");
    assert("add command creates file", existsSync(filePath));
    const content = readFileSync(filePath, "utf-8");
    assert("add command has name", content.includes("name: CancelOrder"));
    assert("add command has description", content.includes("description: Cancel an existing order"));
  }

  console.log("\n=== add aggregate: creates aggregate YAML file ===");
  {
    const root = makeValidDomain("add-aggregate");
    tempRoots.push(root);
    const result = run(["add", "aggregate", "Shipment", "--context", "ordering", "--description", "Shipment aggregate root"], { root });
    assert("add aggregate exits 0", result.exitCode === 0);
    const filePath = join(root, ".dkk", "domain", "contexts", "ordering", "aggregates", "Shipment.yml");
    assert("add aggregate creates file", existsSync(filePath));
    const content = readFileSync(filePath, "utf-8");
    assert("add aggregate has name", content.includes("name: Shipment"));
    assert("add aggregate has handles", content.includes("handles:"));
    assert("add aggregate has emits", content.includes("emits:"));
  }

  console.log("\n=== add policy: creates policy YAML file ===");
  {
    const root = makeValidDomain("add-policy");
    tempRoots.push(root);
    const result = run(["add", "policy", "SendShipmentNotice", "--context", "ordering", "--description", "Notify on shipment"], { root });
    assert("add policy exits 0", result.exitCode === 0);
    const filePath = join(root, ".dkk", "domain", "contexts", "ordering", "policies", "SendShipmentNotice.yml");
    assert("add policy creates file", existsSync(filePath));
    const content = readFileSync(filePath, "utf-8");
    assert("add policy has name", content.includes("name: SendShipmentNotice"));
  }

  console.log("\n=== add read-model: creates read-model YAML file ===");
  {
    const root = makeValidDomain("add-readmodel");
    tempRoots.push(root);
    const result = run(["add", "read-model", "OrderSummary", "--context", "ordering", "--description", "Summary view of orders"], { root });
    assert("add read-model exits 0", result.exitCode === 0);
    const filePath = join(root, ".dkk", "domain", "contexts", "ordering", "read-models", "OrderSummary.yml");
    assert("add read-model creates file", existsSync(filePath));
    const content = readFileSync(filePath, "utf-8");
    assert("add read-model has name", content.includes("name: OrderSummary"));
  }

  console.log("\n=== add glossary: appends entry to context.yml ===");
  {
    const root = makeValidDomain("add-glossary");
    tempRoots.push(root);
    const result = run(["add", "glossary", "Fulfillment", "--context", "ordering", "--description", "Process of completing an order"], { root });
    assert("add glossary exits 0", result.exitCode === 0);
    const contextYml = readFileSync(join(root, ".dkk", "domain", "contexts", "ordering", "context.yml"), "utf-8");
    assert("add glossary has term", contextYml.includes("Fulfillment"));
    assert("add glossary has definition", contextYml.includes("Process of completing an order"));
  }

  console.log("\n=== add: errors when context does not exist ===");
  {
    const root = makeValidDomain("add-no-context");
    tempRoots.push(root);
    const result = run(["add", "event", "SomeEvent", "--context", "nonexistent"], { root });
    assert("add missing context exits 1", result.exitCode === 1);
    assert("add missing context has error", result.stderr.includes("does not exist"));
  }

  console.log("\n=== add: errors when item already exists ===");
  {
    const root = makeValidDomain("add-duplicate");
    tempRoots.push(root);
    // OrderPlaced already exists in the valid domain
    const result = run(["add", "event", "OrderPlaced", "--context", "ordering"], { root });
    assert("add duplicate exits 1", result.exitCode === 1);
    assert("add duplicate has error", result.stderr.includes("already exists"));
  }

  console.log("\n=== add: errors on invalid item type ===");
  {
    const root = makeValidDomain("add-bad-type");
    tempRoots.push(root);
    const result = run(["add", "widget", "Foo", "--context", "ordering"], { root });
    assert("add bad type exits 1", result.exitCode === 1);
    assert("add bad type has error", result.stderr.includes("Unknown item type"));
  }

  console.log("\n=== add: errors on invalid name ===");
  {
    const root = makeValidDomain("add-bad-name");
    tempRoots.push(root);
    const result = run(["add", "event", "order-placed", "--context", "ordering"], { root });
    assert("add bad name exits 1", result.exitCode === 1);
    assert("add bad name has error", result.stderr.includes("invalid"));
  }

  console.log("\n=== add: default description when --description omitted ===");
  {
    const root = makeValidDomain("add-default-desc");
    tempRoots.push(root);
    const result = run(["add", "event", "OrderCancelled", "--context", "ordering"], { root });
    assert("add default desc exits 0", result.exitCode === 0);
    const filePath = join(root, ".dkk", "domain", "contexts", "ordering", "events", "OrderCancelled.yml");
    const content = readFileSync(filePath, "utf-8");
    assert("add default desc has TODO", content.includes("TODO: describe OrderCancelled"));
  }

  console.log("\n=== add: glossary duplicate errors ===");
  {
    const root = makeValidDomain("add-glossary-dup");
    tempRoots.push(root);
    // SKU already exists in the valid domain glossary
    const result = run(["add", "glossary", "SKU", "--context", "ordering"], { root });
    assert("add glossary dup exits 1", result.exitCode === 1);
    assert("add glossary dup has error", result.stderr.includes("already exists"));
  }

  console.log("\n=== add: creates type subdirectory if missing ===");
  {
    const root = makeValidDomain("add-creates-dir");
    tempRoots.push(root);
    // read-models directory might not exist in valid domain; let's add a read-model
    const result = run(["add", "read-model", "InventoryView", "--context", "ordering"], { root });
    assert("add creates dir exits 0", result.exitCode === 0);
    assert("add creates dir file exists", existsSync(join(root, ".dkk", "domain", "contexts", "ordering", "read-models", "InventoryView.yml")));
  }

  // ═══════════════════════════════════════════════════════════════════
  // prime command — static + dynamic domain summary
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== prime: outputs static instructions and domain summary ===");
  {
    const root = makeValidDomain("prime-summary");
    tempRoots.push(root);
    writeAdr(root, "adr-0001.md", [
      "id: adr-0001",
      "title: Use YAML for domain models",
      "status: accepted",
      "date: 2025-01-15",
    ].join("\n"));

    const result = run(["prime"], { root });
    assert("prime exits 0", result.exitCode === 0);
    assert("prime has static header", result.stdout.includes("Domain Knowledge Kit — Agent Context"));
    assert("prime has domain summary section", result.stdout.includes("Current Domain Summary"));
    assert("prime shows context name", result.stdout.includes("ordering"));
    assert("prime shows actor", result.stdout.includes("Customer"));
    assert("prime shows ADR", result.stdout.includes("adr-0001"));
    assert("prime shows ADR title", result.stdout.includes("Use YAML for domain models"));
    assert("prime shows item counts", result.stdout.includes("event(s)"));
    assert("prime shows aggregate relationship", result.stdout.includes("Order"));
  }

  console.log("\n=== prime: domain summary includes item counts ===");
  {
    const root = makeValidDomain("prime-counts");
    tempRoots.push(root);
    const result = run(["prime"], { root });
    assert("prime counts exits 0", result.exitCode === 0);
    // The valid domain has 1 event, 1 command, 1 aggregate, 1 policy
    assert("prime counts bounded context(s)", result.stdout.includes("1** bounded context(s)"));
    assert("prime counts domain item(s)", result.stdout.includes("domain item(s)"));
    assert("prime counts actor(s)", result.stdout.includes("1** actor(s)"));
  }

  console.log("\n=== prime: --static-only skips domain summary ===");
  {
    const root = makeValidDomain("prime-static");
    tempRoots.push(root);
    const result = run(["prime", "--static-only"], { root });
    assert("prime --static-only exits 0", result.exitCode === 0);
    assert("prime --static-only has static header", result.stdout.includes("Domain Knowledge Kit — Agent Context"));
    assert("prime --static-only no domain summary", !result.stdout.includes("Current Domain Summary"));
  }

  console.log("\n=== prime: empty project shows no-domain-found note ===");
  {
    const root = makeTempRoot("prime-empty");
    tempRoots.push(root);
    // Remove the .dkk directory entirely so no domain exists
    rmSync(join(root, ".dkk"), { recursive: true, force: true });
    const result = run(["prime"], { root });
    assert("prime empty exits 0", result.exitCode === 0);
    assert("prime empty has static header", result.stdout.includes("Domain Knowledge Kit — Agent Context"));
    assert("prime empty shows no-domain note", result.stdout.includes("No domain model found"));
    assert("prime empty shows scaffold hint", result.stdout.includes("dkk new domain"));
  }

  console.log("\n=== prime: key relationships show handled commands and emitted events ===");
  {
    const root = makeValidDomain("prime-relationships");
    tempRoots.push(root);
    const result = run(["prime"], { root });
    assert("prime relationships exits 0", result.exitCode === 0);
    assert("prime relationships section exists", result.stdout.includes("Key Relationships"));
    assert("prime relationships shows PlaceOrder", result.stdout.includes("PlaceOrder"));
    assert("prime relationships shows OrderPlaced", result.stdout.includes("OrderPlaced"));
    assert("prime relationships shows handles/emits", result.stdout.includes("handles"));
    assert("prime relationships shows emits", result.stdout.includes("emits"));
  }

} finally {
  cleanup();
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
