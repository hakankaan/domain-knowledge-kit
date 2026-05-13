/**
 * Tests for the federation loader.
 *
 * Verifies two-repo local-path federation:
 *  - Local peer is reachable, its items are loaded into model.peers
 *  - Unreachable peer becomes a warning, not an error
 *  - DKK_PEER_<NAME> env override redirects a peer to a different path
 *  - Peer loading is one level deep (a peer's own federation.yml is ignored)
 */
import { mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDomainModel } from "../../../shared/loader.js";
import { loadFederation, resolvePeerRoot, peerEnvKey } from "../loader.js";

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

const RAW_TMP = join(tmpdir(), `dkk-fed-${Date.now()}`);
mkdirSync(RAW_TMP, { recursive: true });
const TMP = realpathSync(RAW_TMP);

// Two-repo fixture layout:
//   <TMP>/order-svc/.dkk/        — peer service "ordering" with one event
//   <TMP>/billing-svc/.dkk/      — local service "billing" with federation.yml pointing at order-svc
const ORDER = join(TMP, "order-svc");
const BILLING = join(TMP, "billing-svc");
const ALT_ORDER = join(TMP, "alt-order-svc"); // for env override test

function writeServiceRepo(root: string, opts: {
  serviceName: string;
  exportName: string;
  contextName: string;
  eventName?: string;
  federationYml?: string;
}) {
  const dkk = join(root, ".dkk");
  const domain = join(dkk, "domain");
  const ctx = join(domain, "contexts", opts.contextName);
  mkdirSync(join(ctx, "events"), { recursive: true });
  mkdirSync(join(dkk, "adr"), { recursive: true });

  // service.yml
  writeFileSync(
    join(dkk, "service.yml"),
    [`name: ${opts.serviceName}`, `exports:`, `  - ${opts.exportName}`].join("\n"),
  );

  // domain/index.yml
  writeFileSync(
    join(domain, "index.yml"),
    [`contexts:`, `  - name: ${opts.contextName}`, `    description: ${opts.contextName} context`].join("\n"),
  );

  // domain/actors.yml
  writeFileSync(join(domain, "actors.yml"), "actors: []\n");

  // contexts/<name>/context.yml
  writeFileSync(
    join(ctx, "context.yml"),
    [`name: ${opts.contextName}`, `description: ${opts.contextName} bounded context`].join("\n"),
  );

  if (opts.eventName) {
    writeFileSync(
      join(ctx, "events", `${opts.eventName}.yml`),
      [`name: ${opts.eventName}`, `description: Raised when ${opts.eventName.toLowerCase()}.`].join("\n"),
    );
  }

  if (opts.federationYml) {
    writeFileSync(join(dkk, "federation.yml"), opts.federationYml);
  }
}

writeServiceRepo(ORDER, {
  serviceName: "ordering",
  exportName: "ordering",
  contextName: "ordering",
  eventName: "OrderPlaced",
});

writeServiceRepo(BILLING, {
  serviceName: "billing",
  exportName: "billing",
  contextName: "billing",
  federationYml: [
    "peers:",
    "  - name: ordering",
    "    source:",
    "      type: local",
    "      path: ../order-svc",
  ].join("\n"),
});

// Alt peer for env override
writeServiceRepo(ALT_ORDER, {
  serviceName: "ordering",
  exportName: "ordering",
  contextName: "ordering",
  eventName: "OrderShipped",
});

try {
  // ── loadFederation reads the manifest ─────────────────────────────────
  console.log("\n=== loadFederation ===");
  const manifest = loadFederation(BILLING);
  assert("federation manifest loaded", manifest !== null);
  assert("manifest has one peer", manifest?.peers.length === 1);
  assert("peer name is ordering", manifest?.peers[0].name === "ordering");
  assert(
    "peer source type is local",
    manifest?.peers[0].source.type === "local",
  );

  // unfederated repo returns null
  const noFed = loadFederation(ORDER);
  assert("unfederated repo returns null", noFed === null);

  // ── resolvePeerRoot for local source ──────────────────────────────────
  console.log("\n=== resolvePeerRoot (local) ===");
  const resolved = resolvePeerRoot(manifest!.peers[0], BILLING);
  assert("local peer is reachable", resolved.reachable);
  assert("peerRoot resolves to order-svc", resolved.peerRoot === ORDER);

  // ── resolvePeerRoot for unreachable local source ─────────────────────
  console.log("\n=== resolvePeerRoot (unreachable local) ===");
  const unreachable = resolvePeerRoot(
    {
      name: "missing",
      source: { type: "local", path: "../does-not-exist" },
    },
    BILLING,
  );
  assert("unreachable peer not reachable", !unreachable.reachable);
  assert("unreachable peer has reason", typeof unreachable.reason === "string");

  // ── End-to-end: loadDomainModel from billing hydrates ordering peer ──
  console.log("\n=== loadDomainModel with federation ===");
  const model = loadDomainModel({ root: BILLING });
  assert("model.service is billing", model.service?.name === "billing");
  assert("model.peers exists", model.peers !== undefined);
  assert("model.peers has ordering", model.peers?.has("ordering") === true);

  const peer = model.peers?.get("ordering");
  assert("peer has service identity", peer?.service?.name === "ordering");
  assert("peer has ordering context", peer?.contexts.has("ordering") === true);
  assert(
    "peer has OrderPlaced event",
    (peer?.contexts.get("ordering")?.events ?? []).some((e) => e.name === "OrderPlaced"),
  );

  // ── One level deep: peer.peers stays undefined ────────────────────────
  console.log("\n=== peer-of-peer not followed ===");
  assert("peer.peers is undefined (no transitive)", peer?.peers === undefined);

  // ── Env override redirects peer to a different path ──────────────────
  console.log("\n=== env override ===");
  const envKey = peerEnvKey("ordering");
  assert("env key formatted correctly", envKey === "DKK_PEER_ORDERING");

  const originalEnv = process.env[envKey];
  process.env[envKey] = ALT_ORDER;
  try {
    const altModel = loadDomainModel({ root: BILLING });
    const altPeer = altModel.peers?.get("ordering");
    assert(
      "env override points peer at alt-order-svc",
      (altPeer?.contexts.get("ordering")?.events ?? []).some((e) => e.name === "OrderShipped"),
    );
    assert(
      "env override drops OrderPlaced (different repo)",
      !(altPeer?.contexts.get("ordering")?.events ?? []).some((e) => e.name === "OrderPlaced"),
    );
  } finally {
    if (originalEnv === undefined) delete process.env[envKey];
    else process.env[envKey] = originalEnv;
  }
} finally {
  rmSync(RAW_TMP, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
