/**
 * CLI integration tests for command wiring and error paths.
 *
 * Exercises the CLI commands (src/features/{query,pipeline,adr}/commands)
 * through their actual Commander action handlers by spawning the CLI as a child process
 * and asserting stdout/stderr/exit codes.
 *
 * Uses temporary directories with the --root flag to isolate each test.
 */
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
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
  const execOpts: ExecFileSyncOptions = {
    encoding: "utf-8",
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1" },
  };

  const fullArgs = [...TSX_ARGS, ...args];
  if (opts?.root) {
    fullArgs.push("--root", opts.root);
  }

  try {
    const stdout = execFileSync(TSX, fullArgs, {
      ...execOpts,
      stdio: ["pipe", "pipe", "pipe"],
    }) as unknown as string;
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      exitCode: e.status ?? 1,
    };
  }
}

/** Create a minimal temp domain tree and return its root path. */
function makeTempRoot(suffix: string): string {
  const root = join(tmpdir(), `dkk-cli-${suffix}-${Date.now()}`);
  mkdirSync(join(root, "domain", "contexts"), { recursive: true });
  mkdirSync(join(root, "docs", "adr"), { recursive: true });
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
  const ctxDir = join(root, "domain", "contexts", name);
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
    join(root, "docs", "adr", filename),
    `---\n${frontmatter}\n---\n\n# Title\n\n${body}\n`,
    "utf-8",
  );
}

/** Create a fully valid minimal domain for positive tests. */
function makeValidDomain(suffix: string): string {
  const root = makeTempRoot(suffix);
  // Copy templates so render command can find them
  cpSync(TOOLS_DIR, join(root, "tools"), { recursive: true });
  writeYaml(root, "domain/index.yml", [
    "contexts:",
    "  - name: ordering",
    '    description: "Order management"',
    "flows: []",
  ].join("\n"));

  writeYaml(root, "domain/actors.yml", [
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
    writeYaml(root, "domain/index.yml", [
      "contexts:",
      "  - name: ordering",
      '    description: "Order management"',
      "flows: []",
    ].join("\n"));
    writeYaml(root, "domain/actors.yml", "actors: []\n");
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
  // 3. search command — no index shows helpful error
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== search: no index shows error ===");
  {
    const root = makeValidDomain("search-noindex");
    tempRoots.push(root);
    // No render has been run, so no index exists
    const result = run(["search", "order"], { root });
    assert("search no-index exits 1", result.exitCode === 1);
    assert("search no-index mentions render", result.stderr.includes("render") || result.stderr.includes("index"));
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
    writeYaml(root, "domain/index.yml", "contexts: [\n  - name: broken\n  bad_indent");
    writeYaml(root, "domain/actors.yml", "actors: []\n");
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
    assert("prime has Retrieval", result.stdout.includes("Domain-First Retrieval"));
    assert("prime has Making Domain Changes", result.stdout.includes("Making Domain Changes"));
    assert("prime has ID Conventions", result.stdout.includes("ID Conventions"));
    assert("prime has CLI Command Reference", result.stdout.includes("CLI Command Reference"));
    assert("prime has File Conventions", result.stdout.includes("File Conventions"));
    assert("prime uses dkk as CLI name", result.stdout.includes("dkk list"));
  }

  // ═══════════════════════════════════════════════════════════════════
  // 13. Smoke test: all commands registered in --help output
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== smoke: all commands registered in --help ===");
  {
    const result = run(["--help"]);
    assert("--help exits 0", result.exitCode === 0);
    const helpText = result.stdout;
    const topLevelCommands = ["list", "show", "search", "related", "validate", "render", "init", "prime", "adr"];
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

} finally {
  cleanup();
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
