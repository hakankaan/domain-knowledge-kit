/**
 * Federation loader — resolves peer services declared in
 * `.dkk/federation.yml` and loads each peer's `.dkk/` as a read-only
 * sub-model attached at `model.peers.get(serviceName)`.
 *
 * Peer loading is exactly one level deep: a peer's own `federation.yml`
 * is intentionally NOT followed. Peers are loaded in lenient mode so
 * that DKK schema drift across services (peer YAML using fields the
 * local DKK version doesn't understand) degrades to a warning rather
 * than failing the consumer's load.
 *
 * Two source types are supported:
 *  - `local`: a filesystem path (absolute or relative to repo root).
 *  - `git`:   resolved against the cache at `.dkk/imports/<service>/`
 *             populated by `dkk pull` (Phase 3).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, resolve, join } from "node:path";
import { createRequire } from "node:module";
import { parseYaml } from "../../shared/yaml.js";
import { federationFile, importedServiceDir, schemaDir, repoRoot } from "../../shared/paths.js";
import { loadDomainModel, setFederationHook } from "../../shared/loader.js";
import type { DomainModel } from "../../shared/types/domain.js";
import type {
  FederationManifest,
  PeerSpec,
} from "../../shared/types/federation.js";

// ajv is a CJS package — use createRequire for ESM interop.
const require = createRequire(import.meta.url);
const Ajv = require("ajv").default as typeof import("ajv").default;
const addFormats = require("ajv-formats").default as typeof import("ajv-formats").default;

/** Cached Ajv instance for federation.yml validation. */
let cachedAjv: InstanceType<typeof Ajv> | null = null;

function getAjv(): InstanceType<typeof Ajv> {
  if (cachedAjv) return cachedAjv;
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  const dir = schemaDir();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".schema.json"))) {
    const schema = JSON.parse(readFileSync(join(dir, f), "utf-8"));
    ajv.addSchema(schema, schema.$id);
  }
  cachedAjv = ajv;
  return ajv;
}

/** Per-peer resolution outcome surfaced to the loader/caller. */
export interface PeerResolution {
  /** The peer's repo root on disk (where its `.dkk/` lives), if reachable. */
  peerRoot: string | null;
  /** True when the peer's `.dkk/` directory exists on disk. */
  reachable: boolean;
  /** A short reason string used for warnings (e.g. "git cache empty"). */
  reason?: string;
}

/**
 * Read `.dkk/federation.yml` (if present), validate it against
 * `federation.schema.json`, and return the parsed manifest. Returns
 * `null` for unfederated repos.
 *
 * Throws when the file exists but does not conform to the schema —
 * the message includes Ajv's error list so the user can fix the
 * manifest directly.
 */
export function loadFederation(root?: string): FederationManifest | null {
  const path = federationFile(root);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf-8");
  const parsed = parseYaml<FederationManifest>(text);

  const ajv = getAjv();
  const valid = ajv.validate("federation.schema.json", parsed);
  if (!valid) {
    const details = (ajv.errors ?? [])
      .map((e) => `  - ${e.instancePath || "/"}: ${e.message ?? "invalid"}`)
      .join("\n");
    throw new Error(
      `Invalid ${path}:\n${details}\n\nExpected shape: { peers: [{ name, source: { type: "local" | "git", ... } }] }`,
    );
  }

  return parsed;
}

/**
 * Resolve a single peer spec into an absolute repo-root path on disk.
 *
 * - `local` sources resolve relative to the local repo root (so
 *   `../order-svc` in `billing-svc/.dkk/federation.yml` points at the
 *   sibling directory regardless of `cwd`). Env-var override
 *   `DKK_PEER_<SERVICE_NAME_UPPER>` (uppercase, hyphens → underscores)
 *   takes precedence over the manifest's `source.path`.
 * - `git` sources resolve to the cache directory
 *   `.dkk/imports/<service>/` populated by `dkk pull`.
 *
 * The returned `peerRoot` points at the peer's repository root (so
 * `<peerRoot>/.dkk/` is where the peer's domain lives).
 */
export function resolvePeerRoot(spec: PeerSpec, localRepoRoot: string): PeerResolution {
  const source = spec.source;

  // Env-var override: applies to any source type for the convenience of
  // developers who want to point at a local checkout regardless of
  // what the committed manifest says.
  const envKey = `DKK_PEER_${spec.name.toUpperCase().replace(/-/g, "_")}`;
  const envOverride = process.env[envKey];
  if (envOverride && envOverride.length > 0) {
    const peerRoot = isAbsolute(envOverride)
      ? envOverride
      : resolve(localRepoRoot, envOverride);
    const reachable = existsSync(peerRoot + "/.dkk");
    return {
      peerRoot,
      reachable,
      reason: reachable ? undefined : `env override ${envKey} points at ${peerRoot} but it has no .dkk/`,
    };
  }

  if (source.type === "local") {
    const peerRoot = isAbsolute(source.path)
      ? source.path
      : resolve(localRepoRoot, source.path);
    const reachable = existsSync(peerRoot + "/.dkk");
    return {
      peerRoot,
      reachable,
      reason: reachable ? undefined : `local path ${peerRoot} has no .dkk/`,
    };
  }

  if (source.type === "git") {
    const cacheRoot = importedServiceDir(spec.name, localRepoRoot);
    // When the peer's `.dkk/` lives in a sub-directory of its repo
    // (monorepo case), the manifest's `source.path` names that
    // sub-directory; the sparse-checkout pulls it into the cache at
    // the same relative location.
    const peerRoot = source.path
      ? `${cacheRoot}/${source.path.replace(/\/$/, "")}`
      : cacheRoot;
    const reachable = existsSync(peerRoot + "/.dkk");
    return {
      peerRoot,
      reachable,
      reason: reachable ? undefined : `git cache empty for "${spec.name}" — run \`dkk pull ${spec.name}\``,
    };
  }

  // Exhaustiveness check — future source types should be added here.
  const exhaustive: never = source;
  return { peerRoot: null, reachable: false, reason: `unknown source type: ${JSON.stringify(exhaustive)}` };
}

/**
 * Load a peer's domain model in "peer mode": one level deep (peer's
 * own `federation.yml` is skipped) and resilient to minor schema
 * drift. The peer's model is structurally identical to a local model
 * so the same `loadDomainModel` is reused; the federation pass is
 * suppressed via the `followPeers: false` option.
 */
export function loadPeerModel(peerRoot: string): DomainModel {
  return loadDomainModel({ root: peerRoot, followPeers: false });
}

/**
 * Resolve and load every peer declared in the manifest. Unreachable
 * peers are reported via `warnings` (each line is one peer) but never
 * abort the load — the caller (typically the main loader) attaches
 * the resulting map to `model.peers`.
 */
export function loadAllPeers(
  localRepoRoot: string,
  manifest: FederationManifest,
): { peers: Map<string, DomainModel>; warnings: string[] } {
  const peers = new Map<string, DomainModel>();
  const warnings: string[] = [];

  for (const spec of manifest.peers ?? []) {
    const resolution = resolvePeerRoot(spec, localRepoRoot);
    if (!resolution.reachable || !resolution.peerRoot) {
      warnings.push(`peer "${spec.name}" unreachable: ${resolution.reason ?? "unknown"}`);
      continue;
    }
    try {
      const model = loadPeerModel(resolution.peerRoot);
      peers.set(spec.name, model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`peer "${spec.name}" failed to load: ${msg}`);
    }
  }

  return { peers, warnings };
}

/**
 * Build the env-var key used to override a peer's source path.
 * Exposed for tests and for the `peers status` command.
 */
export function peerEnvKey(serviceName: string): string {
  return `DKK_PEER_${serviceName.toUpperCase().replace(/-/g, "_")}`;
}

// ── Hook registration ────────────────────────────────────────────────
//
// Register the peer-hydration hook with the shared loader at module
// initialisation. Any CLI command that imports this slice (directly or
// transitively via the federation commands wired in cli.ts) will cause
// `loadDomainModel` to start populating `model.peers`. Scripts that
// import the shared loader without the federation slice get plain
// unfederated behaviour — no surprises, no cycles.
setFederationHook((root, model) => {
  const manifest = loadFederation(root);
  if (!manifest) return;
  const resolvedRoot = repoRoot(root);
  const { peers, warnings } = loadAllPeers(resolvedRoot, manifest);
  if (peers.size > 0) model.peers = peers;
  for (const w of warnings) {
    console.warn(`dkk: ${w}`);
  }
});
