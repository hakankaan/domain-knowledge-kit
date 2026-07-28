/**
 * Tests for the ADR feature slice: bidirectional linking, decision
 * lookup with supersession resolution, and the rot audit.
 *
 * Builds a real `.dkk/` tree in a temp directory so the link helpers
 * exercise the same file discovery the CLI uses.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../../../shared/loader.js";
import { parseYaml } from "../../../shared/yaml.js";
import { linkAdr, setItemAdrRef } from "../adr-links.js";
import { collectDecisions, resolveCurrent } from "../decisions.js";
import { auditAdrs } from "../audit.js";
import { findLinkGaps } from "../reciprocity.js";
import { adrView } from "../present.js";
import { transitionWarning } from "../status.js";

// ── Harness ───────────────────────────────────────────────────────────

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

const TMP = join(tmpdir(), `dkk-adr-test-${Date.now()}`);

function write(rel: string, content: string): void {
  const path = join(TMP, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function adr(id: string, frontmatter: string[], body = "## Context\n\nWhy.\n\n## Decision\n\nWhat.\n"): void {
  write(`.dkk/adr/${id}.md`, `---\n${frontmatter.join("\n")}\n---\n\n# ${id}\n\n${body}`);
}

function setup(): void {
  write(
    ".dkk/domain/index.yml",
    [
      "contexts:",
      "  - name: ordering",
      "flows:",
      "  - name: Checkout",
      "    steps:",
      "      - ref: ordering.OrderPlaced",
      "        type: event",
    ].join("\n"),
  );
  write(
    ".dkk/domain/actors.yml",
    ["actors:", "  - name: Customer", "    type: human", '    description: "A buyer"'].join("\n"),
  );
  write(
    ".dkk/domain/contexts/ordering/context.yml",
    [
      "name: ordering",
      'description: "Orders"',
      "code_refs:",
      "  - src/ordering/**",
      "glossary:",
      "  - term: BackOrder",
      '    definition: "An order awaiting stock"',
    ].join("\n"),
  );
  write(
    ".dkk/domain/contexts/ordering/events/OrderPlaced.yml",
    ["name: OrderPlaced", 'description: "Placed"'].join("\n"),
  );
  write(
    ".dkk/domain/contexts/ordering/aggregates/Order.yml",
    ["name: Order", 'description: "Order root"'].join("\n"),
  );

  adr("adr-0001", [
    "id: adr-0001",
    "title: Event sourcing",
    "status: superseded",
    "date: 2026-01-01",
    "superseded_by: adr-0002",
    "domain_refs:",
    "  - ordering.Order",
  ]);
  adr("adr-0002", [
    "id: adr-0002",
    "title: CRUD with an outbox",
    "status: accepted",
    "date: 2026-02-01",
    "supersedes:",
    "  - adr-0001",
    "domain_refs: []",
  ]);
  adr("adr-0003", [
    "id: adr-0003",
    "title: Storage layout",
    "status: accepted",
    "date: 2026-03-01",
    "domain_refs: []",
    "code_refs:",
    "  - src/ordering/storage/**",
  ]);
  adr("adr-0004", [
    "id: adr-0004",
    "title: Never decided",
    "status: proposed",
    "date: 2020-01-01",
    "domain_refs: []",
  ]);
}

setup();

try {
  // ── Bidirectional linking ───────────────────────────────────────────
  console.log("\n=== adr-links.ts ===");

  const linked = linkAdr("adr-0002", ["ordering.Order", "actor.Customer", "flow.Checkout", "context.ordering"], "add", TMP);
  assert("link writes the ADR half", linked.adr.changed);
  assert(
    "link writes every item half",
    linked.items.length === 4 && linked.items.every((i) => i.changed && !i.error),
    linked.items.map((i) => `${i.id}:${i.error ?? i.changed}`).join(", "),
  );

  const orderYaml = parseYaml<{ adr_refs?: string[] }>(
    readFileSync(join(TMP, ".dkk/domain/contexts/ordering/aggregates/Order.yml"), "utf-8"),
  );
  assert("item file gained adr_refs", orderYaml.adr_refs?.includes("adr-0002") === true);

  const actorsYaml = parseYaml<{ actors: { name: string; adr_refs?: string[] }[] }>(
    readFileSync(join(TMP, ".dkk/domain/actors.yml"), "utf-8"),
  );
  assert("actor gained adr_refs", actorsYaml.actors[0].adr_refs?.includes("adr-0002") === true);

  const glossaryLink = setItemAdrRef("ordering.BackOrder", "adr-0002", "add", TMP);
  assert("glossary term is linkable", glossaryLink.changed && !glossaryLink.error);

  const missing = setItemAdrRef("ordering.Nope", "adr-0002", "add", TMP);
  assert("unknown target reports an error", !missing.changed && Boolean(missing.error));

  const peer = setItemAdrRef("billing:billing.Invoice", "adr-0002", "add", TMP);
  assert("cross-service target is refused", !peer.changed && peer.error!.includes("peer"));

  // ── Reciprocity ─────────────────────────────────────────────────────
  console.log("\n=== reciprocity.ts ===");

  const model = loadDomainModel({ root: TMP });
  const gaps = findLinkGaps(model);
  assert(
    "detects the one-way adr-0001 → ordering.Order link",
    gaps.some((g) => g.adr === "adr-0001" && g.target === "ordering.Order" && g.direction === "adr-only"),
  );
  assert(
    "two-way links written by linkAdr are not reported",
    !gaps.some((g) => g.adr === "adr-0002" && g.target !== "ordering.BackOrder"),
    gaps.filter((g) => g.adr === "adr-0002").map((g) => `${g.target}:${g.direction}`).join(", "),
  );
  // BackOrder was linked with the item-half helper only, which is
  // exactly the one-sidedness linkAdr exists to prevent.
  assert(
    "an item-half-only link is reported as one-way",
    gaps.some((g) => g.adr === "adr-0002" && g.target === "ordering.BackOrder" && g.direction === "item-only"),
  );

  // ── Supersession ────────────────────────────────────────────────────
  console.log("\n=== decisions.ts ===");

  assert("resolveCurrent follows the chain", resolveCurrent(model, "adr-0001") === "adr-0002");
  assert("head of a chain resolves to undefined", resolveCurrent(model, "adr-0002") === undefined);

  const forOrder = collectDecisions(model, "ordering.Order");
  assert(
    "finds both the superseded and current decision",
    forOrder.decisions.some((d) => d.id === "adr-0001") &&
      forOrder.decisions.some((d) => d.id === "adr-0002"),
  );
  assert(
    "binding skips the superseded one and names its successor",
    forOrder.binding.includes("adr-0002") && !forOrder.binding.includes("adr-0001"),
    forOrder.binding.join(", "),
  );
  assert("superseded decision is listed as history", forOrder.retired.includes("adr-0001"));
  assert(
    "records provenance for each route",
    forOrder.decisions.find((d) => d.id === "adr-0002")?.via.includes("adr_refs") === true,
  );

  const contextGoverned = collectDecisions(model, "ordering.OrderPlaced");
  assert(
    "a context-level decision reaches items inside it",
    contextGoverned.decisions.some((d) => d.id === "adr-0002" && d.via.includes("context")),
    contextGoverned.decisions.map((d) => `${d.id}:${d.via.join("/")}`).join(", "),
  );

  const fileBound = collectDecisions(model, "src/ordering/storage/writer.ts", {
    fileBinding: { context: "ordering", adrs: ["adr-0003"] },
  });
  assert(
    "code_refs binding is the most direct provenance",
    fileBound.decisions[0]?.id === "adr-0003" && fileBound.decisions[0].via[0] === "code_refs",
  );

  // A path is not an id — its dots must never be read as a context
  // separator, whether or not a context claims the file.
  const unboundFile = collectDecisions(model, "src/other/writer.ts", {
    fileBinding: { context: null, adrs: ["adr-0003"] },
  });
  assert("an unbound file reports no context", unboundFile.context === undefined);
  assert(
    "an unbound file still reports its directly-bound decision",
    unboundFile.decisions.some((d) => d.id === "adr-0003"),
  );

  const unknown = collectDecisions(model, "ordering.Missing");
  assert("unknown item is flagged rather than answered confidently",
    unknown.subjectExists === false && Boolean(unknown.note));

  const nothing = collectDecisions(model, "nosuch.Thing");
  assert("empty result explains what to do next", Boolean(nothing.note));
  assert("empty result has no decisions", nothing.decisions.length === 0);

  // ── Audit ───────────────────────────────────────────────────────────
  console.log("\n=== audit.ts ===");

  const report = auditAdrs(model, { now: new Date("2026-06-01T00:00:00Z") });
  assert("counts by status", report.byStatus.accepted === 2 && report.byStatus.superseded === 1);
  assert(
    "flags the stalled proposal",
    report.stalledProposals.some((f) => f.id === "adr-0004"),
  );
  assert(
    "retired decisions are exempt from the unlinked check",
    !report.unlinked.some((f) => f.id === "adr-0001"),
  );
  assert(
    "an unlinked accepted decision is flagged",
    report.unlinked.some((f) => f.id === "adr-0003"),
    report.unlinked.map((f) => f.id).join(", "),
  );
  assert("consistent chains are not reported as broken", report.brokenChains.length === 0,
    report.brokenChains.map((f) => f.detail).join("; "));
  assert("audit is not clean for this fixture", !report.clean);

  // ── Presentation ────────────────────────────────────────────────────
  console.log("\n=== present.ts ===");

  const adr2 = model.adrs.get("adr-0002")!;
  const full = adrView(adr2);
  assert("full view keeps Markdown", full.ok && full.view.body.includes("## Decision"));
  assert(
    "full view lists sections",
    full.ok && full.view.availableSections.join(",") === "context,decision",
  );

  const section = adrView(adr2, "dec");
  assert("prefix section lookup works", section.ok && section.view.section === "Decision");
  assert(
    "section body excludes other sections",
    section.ok && section.view.body.includes("What.") && !section.view.body.includes("Why."),
  );

  const bad = adrView(adr2, "nonexistent");
  assert("unknown section lists what is available", !bad.ok && bad.message.includes("context"));

  // ── Status transitions ──────────────────────────────────────────────
  console.log("\n=== status.ts ===");

  assert("proposed → accepted is routine", transitionWarning("proposed", "accepted") === null);
  assert("accepted → proposed warns", transitionWarning("accepted", "proposed") !== null);
  assert("same status is a no-op", transitionWarning("accepted", "accepted") === null);

  // ── Unlink ──────────────────────────────────────────────────────────
  console.log("\n=== unlink ===");

  const unlinked = linkAdr("adr-0002", ["ordering.Order"], "remove", TMP);
  assert("unlink clears both halves", unlinked.adr.changed && unlinked.items[0].changed);
  const afterYaml = parseYaml<{ adr_refs?: string[] }>(
    readFileSync(join(TMP, ".dkk/domain/contexts/ordering/aggregates/Order.yml"), "utf-8"),
  );
  assert("empty adr_refs key is removed, not left empty", afterYaml.adr_refs === undefined);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
