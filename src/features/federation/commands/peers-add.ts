/**
 * `dkk peers add <name>` — append a peer to .dkk/federation.yml.
 *
 * Two source forms (Phase 2 ships local; --git lands in Phase 3 but
 * is parsed here so the CLI surface is forward-compatible):
 *   dkk peers add <name> --local <path>
 *   dkk peers add <name> --git <url> --branch <branch> [--git-path <subpath>]
 *
 * Idempotent: re-adding an existing peer with the same source is a
 * no-op; replacing requires --force.
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { federationFile } from "../../../shared/paths.js";
import { parseYaml, stringifyYaml } from "../../../shared/yaml.js";
import type {
  FederationManifest,
  PeerSpec,
  PeerSource,
} from "../../../shared/types/federation.js";

function isValidKebab(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

interface AddOpts {
  local?: string;
  git?: string;
  branch?: string;
  gitPath?: string;
  root?: string;
  force?: boolean;
  json?: boolean;
  minify?: boolean;
}

export function registerPeersAdd(parent: Cmd): void {
  parent
    .command("add <name>")
    .description("Register a peer service in .dkk/federation.yml")
    .option("--local <path>", "Local filesystem path to the peer's repository root")
    .option("--git <url>", "Git URL of the peer repository")
    .option("--branch <branch>", "Branch to track for git sources", "main")
    .option("--git-path <subpath>", "Sub-path inside the peer repo where .dkk/ lives")
    .option("-r, --root <path>", "Override repository root")
    .option("--force", "Replace an existing entry for this peer")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .action((name: string, opts: AddOpts) => {
      if (!isValidKebab(name)) {
        console.error(`Error: Peer name "${name}" must be kebab-case.`);
        process.exit(1);
      }

      if (!opts.local && !opts.git) {
        console.error("Error: must specify either --local <path> or --git <url>.");
        process.exit(1);
      }
      if (opts.local && opts.git) {
        console.error("Error: --local and --git are mutually exclusive.");
        process.exit(1);
      }

      let source: PeerSource;
      if (opts.local) {
        source = { type: "local", path: opts.local };
      } else {
        const branch = opts.branch ?? "main";
        source = { type: "git", url: opts.git!, branch };
        if (opts.gitPath) source.path = opts.gitPath;
      }

      const path = federationFile(opts.root);
      let manifest: FederationManifest;
      if (existsSync(path)) {
        manifest = parseYaml<FederationManifest>(readFileSync(path, "utf-8"));
        if (!Array.isArray(manifest.peers)) manifest.peers = [];
      } else {
        manifest = { peers: [] };
        mkdirSync(dirname(path), { recursive: true });
      }

      const existingIdx = manifest.peers.findIndex((p) => p.name === name);
      if (existingIdx >= 0 && !opts.force) {
        console.error(`Error: peer "${name}" already exists. Use --force to replace.`);
        process.exit(1);
      }

      const entry: PeerSpec = { name, source };
      if (existingIdx >= 0) {
        manifest.peers[existingIdx] = entry;
      } else {
        manifest.peers.push(entry);
      }

      const header = "# Federation manifest — peer services to load alongside this repo.\n";
      writeFileSync(path, header + stringifyYaml(manifest), "utf-8");

      if (opts.json) {
        console.log(
          JSON.stringify(
            { path, peer: entry, replaced: existingIdx >= 0 },
            null,
            opts.minify ? 0 : 2,
          ),
        );
        return;
      }

      const action = existingIdx >= 0 ? "Replaced" : "Added";
      const summary =
        source.type === "local"
          ? `local: ${source.path}`
          : `git: ${source.url} @ ${source.branch}`;
      console.log(`${action} peer "${name}" (${summary}) in ${path}`);
    });
}
