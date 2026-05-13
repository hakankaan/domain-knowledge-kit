/**
 * TypeScript interfaces for the multi-repo federation layer.
 *
 * `service.yml` declares this repo's service identity. `federation.yml`
 * lists peer services whose `.dkk/` directories should be loaded
 * alongside the local model (read-only).
 *
 * Aligns with JSON schemas under tools/dkk/schema/service.schema.json
 * and federation.schema.json.
 */

/** Service identity file (.dkk/service.yml). */
export interface ServiceManifest {
  /** Kebab-case service identifier (e.g. "ordering"). Globally unique within an org. */
  name: string;
  /** Bounded-context names this service publishes for cross-repo consumption. */
  exports: string[];
  /** Optional human-readable description of the service. */
  description?: string;
}

/** Filesystem-path peer source. */
export interface LocalPeerSource {
  type: "local";
  /** Absolute or repo-root-relative path to the peer's repository root. */
  path: string;
}

/** Git-clone peer source (sparse-checkout of `.dkk/`). */
export interface GitPeerSource {
  type: "git";
  /** Git URL (https / ssh). */
  url: string;
  /** Branch to track. */
  branch: string;
  /** Optional sub-path inside the peer repo where `.dkk/` lives. Defaults to repo root. */
  path?: string;
}

/** Discriminated union of supported peer source types. */
export type PeerSource = LocalPeerSource | GitPeerSource;

/** A single peer entry in the federation manifest. */
export interface PeerSpec {
  /** Kebab-case service name (must match the peer's own `service.yml`). */
  name: string;
  /** Where to read the peer's `.dkk/` from. */
  source: PeerSource;
}

/** Federation manifest file (.dkk/federation.yml). */
export interface FederationManifest {
  peers: PeerSpec[];
}

/** A single entry in the federation lockfile (pins git SHAs). */
export interface LockEntry {
  /** Mirrors the manifest entry's source for change detection. */
  source: PeerSource;
  /** Resolved commit SHA at the time of fetch (git sources only). */
  sha?: string;
  /** ISO-8601 timestamp of the fetch. */
  fetchedAt?: string;
}

/** Lockfile shape (.dkk/federation.lock.json). */
export type FederationLock = Record<string, LockEntry>;
