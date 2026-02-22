/**
 * `dkk new context <name>` command — scaffold a new bounded context.
 *
 * Creates:
 *   .dkk/domain/contexts/<name>/context.yml
 *   .dkk/domain/contexts/<name>/events/
 *   .dkk/domain/contexts/<name>/commands/
 *   .dkk/domain/contexts/<name>/aggregates/
 *   .dkk/domain/contexts/<name>/policies/
 *   .dkk/domain/contexts/<name>/read-models/
 *
 * Registers the context in `.dkk/domain/index.yml`.
 * Errors if the context already exists.
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contextsDir, indexFile } from "../../../shared/paths.js";
import { parseYaml, stringifyYaml } from "../../../shared/yaml.js";
import type { DomainIndex } from "../../../shared/types/domain.js";

/** Validate context name is kebab-case per schema: ^[a-z][a-z0-9-]*$ */
function isValidContextName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

export function registerNewContext(program: Cmd): void {
  program
    .command("context <name>")
    .description("Scaffold a new bounded context directory and register it in index.yml")
    .option("-r, --root <path>", "Override repository root")
    .option("-d, --description <text>", "Description of the bounded context")
    .action((name: string, opts: { root?: string; description?: string }) => {
      // Validate name
      if (!isValidContextName(name)) {
        console.error(
          `Error: Context name "${name}" is invalid. Use kebab-case (e.g. "order-management").`,
        );
        process.exit(1);
      }

      const ctxDir = join(contextsDir(opts.root), name);

      // Guard: refuse if context directory already exists
      if (existsSync(ctxDir)) {
        console.error(
          `Error: Context "${name}" already exists at ${ctxDir}.`,
        );
        process.exit(1);
      }

      const description = opts.description ?? `The ${name} bounded context`;

      // Create directory structure
      const subDirs = ["events", "commands", "aggregates", "policies", "read-models"];
      for (const sub of subDirs) {
        mkdirSync(join(ctxDir, sub), { recursive: true });
      }

      // Write context.yml
      const contextYaml = `# Bounded context metadata and glossary.
name: ${name}
description: ${description}
`;
      writeFileSync(join(ctxDir, "context.yml"), contextYaml, "utf-8");

      // Register in index.yml
      const idxPath = indexFile(opts.root);
      let index: DomainIndex;
      if (existsSync(idxPath)) {
        const raw = readFileSync(idxPath, "utf-8");
        index = parseYaml<DomainIndex>(raw);
      } else {
        // Create index.yml if it doesn't exist
        mkdirSync(join(idxPath, ".."), { recursive: true });
        index = { contexts: [], flows: [] };
      }

      // Check if already registered
      const alreadyRegistered = index.contexts.some((c) => c.name === name);
      if (!alreadyRegistered) {
        index.contexts.push({ name, description });
        writeFileSync(idxPath, stringifyYaml(index), "utf-8");
      }

      console.log(`Created context "${name}":`);
      console.log(`  contexts/${name}/context.yml`);
      for (const sub of subDirs) {
        console.log(`  contexts/${name}/${sub}/`);
      }
      if (!alreadyRegistered) {
        console.log(`\nRegistered "${name}" in index.yml.`);
      }
    });
}
