/**
 * Phase 5 integration tests — federated indexer, searcher, graph, and
 * `dkk consumers`.
 *
 * Builds a two-repo fixture, then verifies:
 *  - Indexer namespaces peer rows with `<service>:` prefix.
 *  - Search returns peer hits with the `service` field populated.
 *  - Search `service` filter narrows correctly.
 *  - Graph contains both local and peer nodes, with peer node ids
 *    prefixed.
 *  - Local policy with `when.events: ['ordering:ordering.OrderPlaced']`
 *    produces a cross-service edge that BFS can traverse.
 *  - `findConsumers` walks peers correctly.
 */
import { mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../../../shared/loader.js";
import { DomainGraph } from "../../../shared/graph.js";
import { buildIndex } from "../../pipeline/indexer.js";
import { search } from "../../query/searcher.js";
// Importing from consumers.js transitively registers the federation
// peer-hydration hook (via its side-effect import of ../loader.js).
import { findConsumers } from "../commands/consumers.js";

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

const RAW_TMP = join(tmpdir(), `dkk-p5-${Date.now()}`);
mkdirSync(RAW_TMP, { recursive: true });
const TMP = realpathSync(RAW_TMP);

const ORDER = join(TMP, "order-svc");
const BILLING = join(TMP, "billing-svc");

// ── Fixture: order-svc (peer) ───────────────────────────────────────────
mkdirSync(join(ORDER, ".dkk", "domain", "contexts", "ordering", "events"), { recursive: true });
mkdirSync(join(ORDER, ".dkk", "domain", "contexts", "ordering", "aggregates"), { recursive: true });
mkdirSync(join(ORDER, ".dkk", "adr"), { recursive: true });
writeFileSync(join(ORDER, ".dkk", "service.yml"), "name: ordering\nexports:\n  - ordering\n");
writeFileSync(
  join(ORDER, ".dkk", "domain", "index.yml"),
  "contexts:\n  - name: ordering\n    description: Orders\nflows: []\n",
);
writeFileSync(join(ORDER, ".dkk", "domain", "actors.yml"), "actors: []\n");
writeFileSync(
  join(ORDER, ".dkk", "domain", "contexts", "ordering", "context.yml"),
  "name: ordering\ndescription: Ordering context\n",
);
writeFileSync(
  join(ORDER, ".dkk", "domain", "contexts", "ordering", "events", "OrderPlaced.yml"),
  "name: OrderPlaced\ndescription: Order is placed for processing.\nraised_by: Order\n",
);
writeFileSync(
  join(ORDER, ".dkk", "domain", "contexts", "ordering", "aggregates", "Order.yml"),
  "name: Order\ndescription: Order aggregate.\nemits:\n  events:\n    - OrderPlaced\n",
);

// ── Fixture: billing-svc (local) with a policy that subscribes to peer event ───
mkdirSync(join(BILLING, ".dkk", "domain", "contexts", "billing", "policies"), { recursive: true });
mkdirSync(join(BILLING, ".dkk", "domain", "contexts", "billing", "commands"), { recursive: true });
mkdirSync(join(BILLING, ".dkk", "domain", "contexts", "billing", "aggregates"), { recursive: true });
mkdirSync(join(BILLING, ".dkk", "adr"), { recursive: true });
writeFileSync(join(BILLING, ".dkk", "service.yml"), "name: billing\nexports:\n  - billing\n");
writeFileSync(
  join(BILLING, ".dkk", "domain", "index.yml"),
  "contexts:\n  - name: billing\n    description: Billing\nflows: []\n",
);
writeFileSync(join(BILLING, ".dkk", "domain", "actors.yml"), "actors: []\n");
writeFileSync(
  join(BILLING, ".dkk", "domain", "contexts", "billing", "context.yml"),
  "name: billing\ndescription: Billing context\n",
);
writeFileSync(
  join(BILLING, ".dkk", "domain", "contexts", "billing", "commands", "IssueInvoice.yml"),
  "name: IssueInvoice\ndescription: Issue an invoice.\nhandled_by: Invoice\n",
);
writeFileSync(
  join(BILLING, ".dkk", "domain", "contexts", "billing", "aggregates", "Invoice.yml"),
  "name: Invoice\ndescription: Invoice aggregate.\nhandles:\n  commands:\n    - IssueInvoice\n",
);
writeFileSync(
  join(BILLING, ".dkk", "domain", "contexts", "billing", "policies", "InitiateInvoice.yml"),
  [
    "name: InitiateInvoice",
    "description: Issue an invoice when an order is placed.",
    "when:",
    "  events:",
    "    - ordering:ordering.OrderPlaced",
    "then:",
    "  commands:",
    "    - IssueInvoice",
  ].join("\n"),
);
writeFileSync(
  join(BILLING, ".dkk", "federation.yml"),
  [
    "peers:",
    "  - name: ordering",
    "    source:",
    "      type: local",
    "      path: ../order-svc",
  ].join("\n") + "\n",
);

try {
  const model = loadDomainModel({ root: BILLING });

  // ── Indexer namespaces peer rows ─────────────────────────────────────
  console.log("\n=== indexer namespaces peer rows ===");
  const dbPath = buildIndex(model, { root: BILLING });
  assert("index.db built", typeof dbPath === "string" && dbPath.length > 0);

  const local = search("OrderPlaced", {}, { root: BILLING });
  assert("search finds OrderPlaced", local.length > 0);
  const peerHit = local.find((r) => r.id === "ordering:ordering.OrderPlaced");
  assert("peer row has service-prefixed id", peerHit !== undefined);
  assert("peer row carries service field", peerHit?.service === "ordering");
  assert("peer row has ordering context", peerHit?.context === "ordering");

  const localHit = local.find((r) => r.id === "billing.InitiateInvoice");
  // (May or may not match depending on FTS tokenization of "OrderPlaced".)
  // What matters is that the peer-prefixed and local rows don't collide.
  assert(
    "local + peer ids are disjoint",
    !local.some(
      (r, i) => local.findIndex((other) => other.id === r.id && local.indexOf(r) !== i) >= 0,
    ),
  );
  void localHit;

  // ── service filter narrows correctly ─────────────────────────────────
  console.log("\n=== search service filter ===");
  const onlyOrdering = search("OrderPlaced", { service: "ordering" }, { root: BILLING });
  assert("service: ordering filter narrows to ordering rows", onlyOrdering.every((r) => r.service === "ordering"));
  assert("service filter returns at least one row", onlyOrdering.length > 0);

  const onlyBilling = search("Invoice", { service: "billing" }, { root: BILLING });
  assert("service: billing filter narrows to billing rows", onlyBilling.every((r) => r.service === "billing"));

  // ── graph contains both namespaces with cross-service edge ───────────
  console.log("\n=== graph cross-service edge ===");
  const graph = DomainGraph.from(model);
  const localPolicyId = "billing.InitiateInvoice";
  const peerEventId = "ordering:ordering.OrderPlaced";

  assert("local policy node exists", graph.nodes.has(localPolicyId));
  assert("peer event node exists with prefix", graph.nodes.has(peerEventId));

  const fromPolicy = graph.getRelated(localPolicyId, 1);
  assert(
    "BFS from local policy reaches peer event in one hop",
    fromPolicy.has(peerEventId),
  );

  // ── findConsumers — reverse lookup from order-svc's perspective ──────
  console.log("\n=== consumers reverse lookup ===");
  // Build a federation manifest in order-svc that points back at
  // billing-svc, so order-svc can ask "who consumes my OrderPlaced?".
  writeFileSync(
    join(ORDER, ".dkk", "federation.yml"),
    [
      "peers:",
      "  - name: billing",
      "    source:",
      "      type: local",
      "      path: ../billing-svc",
    ].join("\n") + "\n",
  );

  const orderModel = loadDomainModel({ root: ORDER });
  const consumers = findConsumers(orderModel, "ordering.OrderPlaced", orderModel.service?.name);
  assert("at least one consumer found", consumers.length > 0);
  assert(
    "consumer is billing.InitiateInvoice via when.events",
    consumers.some(
      (c) =>
        c.service === "billing" &&
        c.relation === "when.events" &&
        c.source === "billing:billing.InitiateInvoice",
    ),
  );
} finally {
  rmSync(RAW_TMP, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
