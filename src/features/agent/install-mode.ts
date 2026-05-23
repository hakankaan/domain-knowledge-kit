/**
 * Detect how the running `dkk` binary was installed.
 *
 * `dkk update` needs to know this to pick the right `npm install`
 * incantation (global vs. local devDep) and to refuse upgrade attempts
 * under `npx`, where there's no persistent install to upgrade.
 */
import { execFileSync } from "node:child_process";
import { sep, normalize } from "node:path";
import { homedir } from "node:os";
import { packageRoot } from "../../shared/paths.js";
import { pkgName } from "../../version.js";

export type InstallMode = "global" | "local" | "npx" | "unknown";

export interface InstallInfo {
  /** How the running dkk binary was installed. */
  mode: InstallMode;
  /** Absolute path to the package root of the running install. */
  packageRoot: string;
  /** Absolute path to the npm global prefix's `node_modules` if resolvable, else null. */
  globalNodeModules: string | null;
}

/**
 * Inspect the running dkk binary's location and return its install mode.
 *
 * Resolution order:
 *   1. Path lives under `~/.npm/_npx/` → `npx`. npx installs are transient
 *      caches; upgrading them is meaningless.
 *   2. Path lives under the npm global `node_modules/` (resolved by
 *      `npm root -g`) → `global`.
 *   3. Otherwise treat as `local` — covers devDependency installs and
 *      direct `tsx src/cli.ts` (dev) invocations alike. Callers that care
 *      about the difference can re-check by looking for a host
 *      `package.json` that depends on the package.
 *   4. If `npm root -g` fails (npm not on PATH, unlikely) → `unknown`.
 */
export function detectInstallMode(): InstallInfo {
  const pkgRoot = normalize(packageRoot());
  const globalNm = resolveGlobalNodeModules();

  const npxPrefix = normalize(`${homedir()}${sep}.npm${sep}_npx${sep}`);
  if (pkgRoot.startsWith(npxPrefix)) {
    return { mode: "npx", packageRoot: pkgRoot, globalNodeModules: globalNm };
  }

  if (globalNm && pkgRoot.startsWith(normalize(globalNm) + sep)) {
    return { mode: "global", packageRoot: pkgRoot, globalNodeModules: globalNm };
  }

  if (!globalNm) {
    return { mode: "unknown", packageRoot: pkgRoot, globalNodeModules: null };
  }

  return { mode: "local", packageRoot: pkgRoot, globalNodeModules: globalNm };
}

function resolveGlobalNodeModules(): string | null {
  try {
    const out = execFileSync("npm", ["root", "-g"], {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const path = out.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Query the npm registry for the latest published version of `pkgName`.
 *
 * Uses `npm view <pkg> version` because it respects the user's npm config
 * (registry overrides, auth tokens, proxies) without us having to
 * re-implement any of that. Returns `null` on failure — callers should
 * treat that as "can't check" rather than failing the whole command.
 */
export function fetchLatestVersion(): string | null {
  try {
    const out = execFileSync("npm", ["view", pkgName, "version"], {
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const v = out.trim();
    return /^\d+\.\d+\.\d+/.test(v) ? v : null;
  } catch {
    return null;
  }
}
