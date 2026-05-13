/**
 * `dkk peers list` — display the configured peer services and their
 * reachability state. Reads `.dkk/federation.yml` and resolves each
 * peer source without actually loading peer models.
 */
import type { Command as Cmd } from "commander";
import { repoRoot } from "../../../shared/paths.js";
import { loadFederation, resolvePeerRoot, peerEnvKey } from "../loader.js";

interface ListOpts {
  root?: string;
  json?: boolean;
  minify?: boolean;
}

export function registerPeersList(parent: Cmd): void {
  parent
    .command("list")
    .description("List configured federation peers and reachability state")
    .option("-r, --root <path>", "Override repository root")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .action((opts: ListOpts) => {
      const root = repoRoot(opts.root);
      const manifest = loadFederation(opts.root);

      if (!manifest || manifest.peers.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ peers: [] }, null, opts.minify ? 0 : 2));
          return;
        }
        console.log("No peers configured. Add one with `dkk peers add <name> --local <path>`.");
        return;
      }

      const rows = manifest.peers.map((peer) => {
        const resolution = resolvePeerRoot(peer, root);
        const envKey = peerEnvKey(peer.name);
        const envOverride = process.env[envKey];
        return {
          name: peer.name,
          source: peer.source,
          peerRoot: resolution.peerRoot,
          reachable: resolution.reachable,
          envOverride: envOverride ?? null,
          reason: resolution.reason ?? null,
        };
      });

      if (opts.json) {
        console.log(JSON.stringify({ peers: rows }, null, opts.minify ? 0 : 2));
        return;
      }

      for (const row of rows) {
        const label =
          row.source.type === "local"
            ? `local: ${row.source.path}`
            : `git: ${row.source.url} @ ${row.source.branch}`;
        const status = row.reachable ? "reachable" : "unreachable";
        const overrideTag = row.envOverride ? `  (env: ${row.envOverride})` : "";
        console.log(`${row.name}  ${label}  [${status}]${overrideTag}`);
        if (!row.reachable && row.reason) {
          console.log(`  ${row.reason}`);
        }
      }
    });
}
