/**
 * Service identity loader.
 *
 * Reads `.dkk/service.yml` (if present) and returns the parsed
 * `ServiceManifest`. Returns `null` for legacy repos that haven't
 * adopted federation — the rest of the loader/validator stack treats
 * `model.service === undefined` as "unfederated, behave as before".
 *
 * Validates against `tools/dkk/schema/service.schema.json` at load
 * time so a malformed manifest produces a clean error up front
 * instead of crashing later in the validator/CLI.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseYaml } from "./yaml.js";
import { serviceFile, schemaDir } from "./paths.js";
import type { ServiceManifest } from "./types/federation.js";

// ajv is a CJS package — use createRequire for ESM interop. Matches
// the pattern used in validator.ts and tests.
const require = createRequire(import.meta.url);
const Ajv = require("ajv").default as typeof import("ajv").default;
const addFormats = require("ajv-formats").default as typeof import("ajv-formats").default;

/** Cached Ajv instance with all DKK schemas loaded. */
let cachedAjv: InstanceType<typeof Ajv> | null = null;

function getAjv(): InstanceType<typeof Ajv> {
  if (cachedAjv) return cachedAjv;
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  // Load all schemas so cross-refs ($ref) resolve.
  const dir = schemaDir();
  const fs = require("node:fs") as typeof import("node:fs");
  for (const f of fs.readdirSync(dir).filter((n: string) => n.endsWith(".schema.json"))) {
    const schema = JSON.parse(fs.readFileSync(join(dir, f), "utf-8"));
    ajv.addSchema(schema, schema.$id);
  }
  cachedAjv = ajv;
  return ajv;
}

/**
 * Load `.dkk/service.yml` from the given root (or auto-detected root).
 * Returns the parsed manifest, or `null` if the file does not exist.
 *
 * Throws when the file exists but does not conform to
 * `service.schema.json` — the message includes Ajv's error list so
 * the user can fix the manifest directly.
 */
export function loadServiceId(root?: string): ServiceManifest | null {
  const path = serviceFile(root);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf-8");
  const parsed = parseYaml<ServiceManifest>(text);

  const ajv = getAjv();
  const valid = ajv.validate("service.schema.json", parsed);
  if (!valid) {
    const details = (ajv.errors ?? [])
      .map((e) => `  - ${e.instancePath || "/"}: ${e.message ?? "invalid"}`)
      .join("\n");
    throw new Error(
      `Invalid ${path}:\n${details}\n\nExpected shape: { name: kebab-case, exports: string[], description?: string }`,
    );
  }

  return parsed;
}
