/**
 * Tests for the GitHub Copilot install path (`dkk init --copilot`).
 *
 * Covers:
 *   1. installCopilotConfig writes prompts, agent, skills, instructions, and
 *      .vscode/mcp.json into a fresh repo.
 *   2. skipMcp / skipInstructions options suppress those two surfaces.
 *   3. refreshCopilotInstructions create / append / update marker behavior
 *      (non-destructive to surrounding content, no duplicate section).
 *   4. hasCopilotAdoption detects each opt-in signal and stays false otherwise.
 *
 * Runs the real install against the package's bundled `tools/dkk/copilot/` and
 * `.github/skills/` templates (present in the source repo and the published
 * package), writing into throwaway temp roots.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installCopilotConfig, refreshCopilotInstructions } from "../commands/init.js";
import { ensureVscodeMcpRegistered } from "../mcp-register.js";
import { hasCopilotAdoption, dkkCopilotFiles } from "../dkk-artifacts.js";

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
  const root = mkdtempSync(join(tmpdir(), "dkk-copilot-"));
  tempRoots.push(root);
  return root;
}

const START = "<!-- dkk:start -->";

console.log("\n=== copilot-install: full install into a fresh repo ===");
{
  const root = makeRoot();
  installCopilotConfig(root, /*force*/ false);

  const inv = dkkCopilotFiles();
  // Not an exact count: dkkCopilotFiles() walks the template dir at runtime,
  // so adding a `dkk-*` prompt would otherwise break this every time. The
  // guard that matters is "the walk found something" — each file it found is
  // then individually asserted installed below.
  assert("template ships prompt files", inv.prompts.length > 0, `prompts=${inv.prompts.length}`);
  for (const name of inv.prompts) {
    assert(`installed prompt ${name}`, existsSync(join(root, ".github", "prompts", name)));
  }
  assert(
    "installed domain-reviewer agent",
    existsSync(join(root, ".github", "agents", "dkk-domain-reviewer.agent.md")),
  );
  assert(
    "installed adr-author skill",
    existsSync(join(root, ".github", "skills", "dkk-adr-author", "skill.md")),
  );

  const instrPath = join(root, ".github", "copilot-instructions.md");
  assert("wrote copilot-instructions.md", existsSync(instrPath));
  const instr = existsSync(instrPath) ? readFileSync(instrPath, "utf-8") : "";
  assert("instructions carry the DKK marker", instr.includes(START));
  assert("instructions carry the static prime contract", instr.includes("Domain Knowledge Kit — Agent Context"));

  const vscodePath = join(root, ".vscode", "mcp.json");
  assert("wrote .vscode/mcp.json", existsSync(vscodePath));
  if (existsSync(vscodePath)) {
    const cfg = JSON.parse(readFileSync(vscodePath, "utf-8")) as { servers?: Record<string, unknown> };
    assert(".vscode/mcp.json declares dkk", Boolean(cfg.servers && "dkk" in cfg.servers));
  }
}

console.log("\n=== copilot-install: skipMcp + skipInstructions suppress those surfaces ===");
{
  const root = makeRoot();
  installCopilotConfig(root, false, { skipMcp: true, skipInstructions: true });
  assert("prompts still installed", existsSync(join(root, ".github", "prompts", "dkk-prime.prompt.md")));
  assert("no copilot-instructions.md", !existsSync(join(root, ".github", "copilot-instructions.md")));
  assert("no .vscode/mcp.json", !existsSync(join(root, ".vscode", "mcp.json")));
}

console.log("\n=== copilot-install: refreshCopilotInstructions create / append / update ===");
{
  const root = makeRoot();
  const path = join(root, ".github", "copilot-instructions.md");

  // create
  const s1 = refreshCopilotInstructions(root);
  assert("first call reports created", s1 === "created", `status=${s1}`);
  assert("marker present after create", readFileSync(path, "utf-8").includes(START));

  // update (replace in place, single occurrence)
  const s2 = refreshCopilotInstructions(root);
  assert("second call reports updated", s2 === "updated", `status=${s2}`);
  const body = readFileSync(path, "utf-8");
  const occurrences = body.split(START).length - 1;
  assert("marker not duplicated on update", occurrences === 1, `occurrences=${occurrences}`);
}

console.log("\n=== copilot-install: append preserves user content ===");
{
  const root = makeRoot();
  mkdirSync(join(root, ".github"), { recursive: true });
  const path = join(root, ".github", "copilot-instructions.md");
  writeFileSync(path, "# My Own Copilot Instructions\n\nKeep this line.\n", "utf-8");

  const status = refreshCopilotInstructions(root);
  assert("append onto existing marker-less file", status === "appended", `status=${status}`);
  const body = readFileSync(path, "utf-8");
  assert("user content preserved", body.includes("Keep this line."));
  assert("DKK section added", body.includes(START));
}

console.log("\n=== copilot-install: hasCopilotAdoption signals ===");
{
  const fresh = makeRoot();
  assert("fresh repo is not adopted", hasCopilotAdoption(fresh) === false);

  const installed = makeRoot();
  installCopilotConfig(installed, false);
  assert("installed repo is adopted", hasCopilotAdoption(installed) === true);

  const vscodeOnly = makeRoot();
  ensureVscodeMcpRegistered(vscodeOnly);
  assert("vscode mcp alone counts as adopted", hasCopilotAdoption(vscodeOnly) === true);

  const markerOnly = makeRoot();
  mkdirSync(join(markerOnly, ".github"), { recursive: true });
  writeFileSync(join(markerOnly, ".github", "copilot-instructions.md"), `x\n${START}\ny\n`, "utf-8");
  assert("instructions marker alone counts as adopted", hasCopilotAdoption(markerOnly) === true);

  const plainInstructions = makeRoot();
  mkdirSync(join(plainInstructions, ".github"), { recursive: true });
  writeFileSync(
    join(plainInstructions, ".github", "copilot-instructions.md"),
    "# Hand-written, no DKK here\n",
    "utf-8",
  );
  assert("marker-less instructions do not count", hasCopilotAdoption(plainInstructions) === false);
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
