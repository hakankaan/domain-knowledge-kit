/**
 * `dkk peers status` — diagnostic view of each configured peer:
 * source, env override, reachability, loaded service identity, exports,
 * and a peer-load warning count. More detailed than `peers list`.
 */
import type { Command as Cmd } from "commander";
import { repoRoot } from "../../../shared/paths.js";
import { loadFederation, resolvePeerRoot, peerEnvKey, loadPeerModel } from "../loader.js";

interface StatusOpts {
  root?: string;
  json?: boolean;
  minify?: boolean;
}

interface PeerStatusRow {
  name: string;
  kind: "local" | "git";
  reachable: boolean;
  peerRoot: string | null;
  envOverride: string | null;
  service: string | null;
  exports: string[];
  contexts: string[];
  warning: string | null;
}

export function registerPeersStatus(parent: Cmd): void {
  parent
    .command("status")
    .description("Show detailed status for each configured federation peer")
    .option("-r, --root <path>", "Override repository root")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .action((opts: StatusOpts) => {
      const root = repoRoot(opts.root);
      const manifest = loadFederation(opts.root);

      if (!manifest || manifest.peers.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ peers: [] }, null, opts.minify ? 0 : 2));
          return;
        }
        console.log("No peers configured.");
        return;
      }

      const rows: PeerStatusRow[] = [];
      for (const peer of manifest.peers) {
        const resolution = resolvePeerRoot(peer, root);
        const envKey = peerEnvKey(peer.name);
        const envOverride = process.env[envKey] ?? null;
        const row: PeerStatusRow = {
          name: peer.name,
          kind: peer.source.type,
          reachable: resolution.reachable,
          peerRoot: resolution.peerRoot,
          envOverride,
          service: null,
          exports: [],
          contexts: [],
          warning: resolution.reason ?? null,
        };

        if (resolution.reachable && resolution.peerRoot) {
          try {
            const model = loadPeerModel(resolution.peerRoot);
            if (model.service) {
              row.service = model.service.name;
              row.exports = model.service.exports;
            }
            row.contexts = Array.from(model.contexts.keys()).sort();
          } catch (err) {
            row.warning = err instanceof Error ? err.message : String(err);
          }
        }

        rows.push(row);
      }

      if (opts.json) {
        const out: Record<string, Omit<PeerStatusRow, "name">> = {};
        for (const row of rows) {
          const { name, ...rest } = row;
          out[name] = rest;
        }
        console.log(JSON.stringify(out, null, opts.minify ? 0 : 2));
        return;
      }

      for (const row of rows) {
        const status = row.reachable ? "reachable" : "unreachable";
        console.log(`${row.name}  [${row.kind}]  ${status}`);
        if (row.peerRoot) console.log(`  path:     ${row.peerRoot}`);
        if (row.envOverride) console.log(`  env:      ${row.envOverride}`);
        if (row.service) {
          console.log(`  service:  ${row.service}`);
          console.log(`  exports:  ${row.exports.join(", ") || "(none)"}`);
          console.log(`  contexts: ${row.contexts.join(", ") || "(none)"}`);
        }
        if (row.warning) console.log(`  warning:  ${row.warning}`);
      }
    });
}
