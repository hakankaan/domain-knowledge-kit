/**
 * Package version, read at runtime from `package.json`.
 *
 * Works in both dev (`src/version.ts`) and build (`dist/version.js`) because
 * `package.json` is one level above either entrypoint. Computed once at
 * module load.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const pkgPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../package.json",
);

export const pkgVersion = (
  JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }
).version;

/** Name of the package on the npm registry. Used by `dkk update`. */
export const pkgName = "domain-knowledge-kit";
