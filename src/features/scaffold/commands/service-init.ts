/**
 * `dkk service init` command — declare this repo as a federated service.
 *
 * Writes `.dkk/service.yml` with the given name and exported contexts.
 * This is the foundation for cross-repo references: peer repos can
 * now address items in this service as `<name>:<context>.<Item>`.
 *
 * Errors if `.dkk/service.yml` already exists (use `--force` to replace).
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { serviceFile } from "../../../shared/paths.js";
import { stringifyYaml } from "../../../shared/yaml.js";
import type { ServiceManifest } from "../../../shared/types/federation.js";

/** Validate name is kebab-case per schema: ^[a-z][a-z0-9-]*$ */
function isValidKebab(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

export function registerServiceInit(program: Cmd): void {
  const service = program
    .command("service")
    .description("Service identity and federation commands");

  service
    .command("init")
    .description("Declare this repo as a federated service (writes .dkk/service.yml)")
    .requiredOption("--name <name>", "Kebab-case service name (e.g. ordering)")
    .option("--export <context...>", "Bounded-context names to export for federation (repeat or comma-separate)")
    .option("--description <text>", "Optional human-readable description")
    .option("-r, --root <path>", "Override repository root")
    .option("--force", "Overwrite an existing service.yml")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .action((opts: {
      name: string;
      export?: string[];
      description?: string;
      root?: string;
      force?: boolean;
      json?: boolean;
      minify?: boolean;
    }) => {
      // Validate name
      if (!isValidKebab(opts.name)) {
        console.error(
          `Error: Service name "${opts.name}" is invalid. Use kebab-case (e.g. "ordering" or "order-management").`,
        );
        process.exit(1);
      }

      // Normalize --export: commander gives an array, but each entry may
      // also be a comma-separated list (user-friendly: --export a,b,c).
      const rawExports = opts.export ?? [];
      const exports: string[] = [];
      for (const entry of rawExports) {
        for (const ctx of entry.split(",")) {
          const trimmed = ctx.trim();
          if (trimmed.length === 0) continue;
          if (!isValidKebab(trimmed)) {
            console.error(`Error: Export "${trimmed}" is not kebab-case.`);
            process.exit(1);
          }
          if (!exports.includes(trimmed)) exports.push(trimmed);
        }
      }

      const path = serviceFile(opts.root);
      if (existsSync(path) && !opts.force) {
        console.error(`Error: ${path} already exists. Use --force to overwrite.`);
        process.exit(1);
      }

      const manifest: ServiceManifest = {
        name: opts.name,
        exports,
      };
      if (opts.description) manifest.description = opts.description;

      mkdirSync(dirname(path), { recursive: true });
      const header = "# Service identity for federation. See `dkk service --help`.\n";
      writeFileSync(path, header + stringifyYaml(manifest), "utf-8");

      if (opts.json) {
        console.log(
          JSON.stringify(
            { path, name: opts.name, exports },
            null,
            opts.minify ? 0 : 2,
          ),
        );
        return;
      }

      console.log(`Created ${path}`);
      console.log(`  name: ${opts.name}`);
      console.log(`  exports: [${exports.join(", ")}]`);
    });
}
