/**
 * Tests for the `.mcp.json` registration logic used by `dkk init`/`dkk update`.
 *
 * Covers:
 *   1. Fresh repo  → `.mcp.json` is created with a `dkk` server entry.
 *   2. Existing `.mcp.json` with other servers → `dkk` is merged in, others kept.
 *   3. Already-registered `dkk` entry → left untouched (idempotent, no clobber).
 *   4. Corrupt `.mcp.json` → reported as a failure, file untouched.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureMcpRegistered, ensureVscodeMcpRegistered } from "../mcp-register.js";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  OK: ${label}`);
    passed++;
  } else {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const tempRoots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dkk-mcp-"));
  tempRoots.push(root);
  return root;
}

interface McpJson {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
  [k: string]: unknown;
}
function readMcp(root: string): McpJson {
  return JSON.parse(readFileSync(join(root, ".mcp.json"), "utf-8")) as McpJson;
}

console.log("\n=== mcp-register: creates .mcp.json in a fresh repo ===");
{
  const root = makeRoot();
  const outcome = ensureMcpRegistered(root);
  assert("status is registered", outcome.status === "registered");
  assert(".mcp.json exists", existsSync(join(root, ".mcp.json")));
  const cfg = readMcp(root);
  assert("declares dkk server", Boolean(cfg.mcpServers?.dkk));
  const last = cfg.mcpServers?.dkk?.args?.at(-1);
  assert("dkk command runs `mcp`", last === "mcp", `args=${JSON.stringify(cfg.mcpServers?.dkk?.args)}`);
}

console.log("\n=== mcp-register: merges into existing .mcp.json, preserving other servers ===");
{
  const root = makeRoot();
  writeFileSync(
    join(root, ".mcp.json"),
    JSON.stringify({ mcpServers: { other: { command: "other-bin", args: ["serve"] } } }, null, 2),
    "utf-8",
  );
  const outcome = ensureMcpRegistered(root);
  assert("status is registered", outcome.status === "registered");
  const cfg = readMcp(root);
  assert("preserves the other server", cfg.mcpServers?.other?.command === "other-bin");
  assert("adds the dkk server", Boolean(cfg.mcpServers?.dkk));
}

console.log("\n=== mcp-register: idempotent when dkk already registered ===");
{
  const root = makeRoot();
  // A user-customised dkk entry we must NOT overwrite.
  const custom = { command: "custom-dkk", args: ["mcp", "--root", "/elsewhere"] };
  writeFileSync(
    join(root, ".mcp.json"),
    JSON.stringify({ mcpServers: { dkk: custom } }, null, 2),
    "utf-8",
  );
  const outcome = ensureMcpRegistered(root);
  assert("status is already-registered", outcome.status === "already-registered");
  const cfg = readMcp(root);
  assert("leaves the custom entry untouched", cfg.mcpServers?.dkk?.command === "custom-dkk");
  assert("keeps custom args", JSON.stringify(cfg.mcpServers?.dkk?.args) === JSON.stringify(custom.args));
}

console.log("\n=== mcp-register: reports failure on corrupt .mcp.json ===");
{
  const root = makeRoot();
  writeFileSync(join(root, ".mcp.json"), "{ this is not json", "utf-8");
  const outcome = ensureMcpRegistered(root);
  assert("status is failed", outcome.status === "failed");
  assert("file left untouched", readFileSync(join(root, ".mcp.json"), "utf-8") === "{ this is not json");
}

// ── .vscode/mcp.json (VS Code Copilot) ────────────────────────────────

interface VscodeMcpJson {
  servers?: Record<string, { type?: string; command?: string; args?: string[] }>;
  [k: string]: unknown;
}
function readVscodeMcp(root: string): VscodeMcpJson {
  return JSON.parse(readFileSync(join(root, ".vscode", "mcp.json"), "utf-8")) as VscodeMcpJson;
}

console.log("\n=== mcp-register: creates .vscode/mcp.json in a fresh repo ===");
{
  const root = makeRoot();
  const outcome = ensureVscodeMcpRegistered(root);
  assert("status is registered", outcome.status === "registered");
  assert(".vscode/mcp.json exists", existsSync(join(root, ".vscode", "mcp.json")));
  const cfg = readVscodeMcp(root);
  assert("declares dkk server under `servers`", Boolean(cfg.servers?.dkk));
  assert("dkk entry is stdio", cfg.servers?.dkk?.type === "stdio", `type=${cfg.servers?.dkk?.type}`);
  const last = cfg.servers?.dkk?.args?.at(-1);
  assert("dkk command runs `mcp`", last === "mcp", `args=${JSON.stringify(cfg.servers?.dkk?.args)}`);
}

console.log("\n=== mcp-register: merges into existing .vscode/mcp.json, preserving other servers ===");
{
  const root = makeRoot();
  const dir = join(root, ".vscode");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "mcp.json"),
    JSON.stringify({ servers: { other: { type: "stdio", command: "other-bin", args: ["serve"] } } }, null, 2),
    "utf-8",
  );
  const outcome = ensureVscodeMcpRegistered(root);
  assert("status is registered", outcome.status === "registered");
  const cfg = readVscodeMcp(root);
  assert("preserves the other server", cfg.servers?.other?.command === "other-bin");
  assert("adds the dkk server", Boolean(cfg.servers?.dkk));
}

console.log("\n=== mcp-register: idempotent when dkk already in .vscode/mcp.json ===");
{
  const root = makeRoot();
  const dir = join(root, ".vscode");
  mkdirSync(dir, { recursive: true });
  const custom = { type: "stdio", command: "custom-dkk", args: ["mcp", "--root", "/elsewhere"] };
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: { dkk: custom } }, null, 2), "utf-8");
  const outcome = ensureVscodeMcpRegistered(root);
  assert("status is already-registered", outcome.status === "already-registered");
  const cfg = readVscodeMcp(root);
  assert("leaves the custom entry untouched", cfg.servers?.dkk?.command === "custom-dkk");
}

console.log("\n=== mcp-register: reports failure on corrupt .vscode/mcp.json ===");
{
  const root = makeRoot();
  const dir = join(root, ".vscode");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mcp.json"), "{ nope", "utf-8");
  const outcome = ensureVscodeMcpRegistered(root);
  assert("status is failed", outcome.status === "failed");
  assert("file left untouched", readFileSync(join(dir, "mcp.json"), "utf-8") === "{ nope");
}

// ── Teardown ──────────────────────────────────────────────────────────
for (const root of tempRoots) {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
