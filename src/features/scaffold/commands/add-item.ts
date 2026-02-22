/**
 * `dkk add <type> <name> --context <ctx>` command — scaffold individual domain items.
 *
 * Supported types: event, command, aggregate, policy, read-model, glossary
 *
 * For file-based types (event, command, aggregate, policy, read-model):
 *   Creates `.dkk/domain/contexts/<ctx>/<type-plural>/<Name>.yml`
 *
 * For glossary:
 *   Appends entry to `.dkk/domain/contexts/<ctx>/context.yml` glossary array
 *   (glossary entries are stored inline in context.yml, not as separate files).
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contextsDir } from "../../../shared/paths.js";
import { parseYaml, stringifyYaml } from "../../../shared/yaml.js";
import type { ContextMetaFile } from "../../../shared/types/domain.js";

// ── Constants ─────────────────────────────────────────────────────────

/** Supported item types and their plural directory names. */
const TYPE_DIR_MAP: Record<string, string> = {
  event: "events",
  command: "commands",
  aggregate: "aggregates",
  policy: "policies",
  "read-model": "read-models",
};

/** All supported item types (including glossary which is handled differently). */
const SUPPORTED_TYPES = [...Object.keys(TYPE_DIR_MAP), "glossary"];

// ── YAML generators ──────────────────────────────────────────────────

function eventYaml(name: string, description: string): string {
  return `name: ${name}\ndescription: ${description}\n`;
}

function commandYaml(name: string, description: string): string {
  return `name: ${name}\ndescription: ${description}\n`;
}

function aggregateYaml(name: string, description: string): string {
  return [
    `name: ${name}`,
    `description: ${description}`,
    "handles:",
    "  commands: []",
    "emits:",
    "  events: []",
    "",
  ].join("\n");
}

function policyYaml(name: string, description: string): string {
  return `name: ${name}\ndescription: ${description}\n`;
}

function readModelYaml(name: string, description: string): string {
  return `name: ${name}\ndescription: ${description}\n`;
}

/** Return YAML content for a file-based item type. */
function generateYaml(type: string, name: string, description: string): string {
  switch (type) {
    case "event":
      return eventYaml(name, description);
    case "command":
      return commandYaml(name, description);
    case "aggregate":
      return aggregateYaml(name, description);
    case "policy":
      return policyYaml(name, description);
    case "read-model":
      return readModelYaml(name, description);
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}

// ── Validation ────────────────────────────────────────────────────────

/** Validate item name is PascalCase per schema: ^[A-Za-z][A-Za-z0-9]*$ */
function isValidItemName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name);
}

// ── Registration ──────────────────────────────────────────────────────

export function registerAddItem(program: Cmd): void {
  program
    .command("add <type> <name>")
    .description(
      `Scaffold a domain item. Types: ${SUPPORTED_TYPES.join(", ")}`,
    )
    .requiredOption("-c, --context <ctx>", "Target bounded context (kebab-case)")
    .option("-d, --description <text>", "Description of the item")
    .option("-r, --root <path>", "Override repository root")
    .action(
      (
        type: string,
        name: string,
        opts: { context: string; description?: string; root?: string },
      ) => {
        // Validate type
        if (!SUPPORTED_TYPES.includes(type)) {
          console.error(
            `Error: Unknown item type "${type}". Supported types: ${SUPPORTED_TYPES.join(", ")}`,
          );
          process.exit(1);
        }

        // Validate name
        if (!isValidItemName(name)) {
          console.error(
            `Error: Item name "${name}" is invalid. Use PascalCase (e.g. "OrderPlaced").`,
          );
          process.exit(1);
        }

        const ctxBase = contextsDir(opts.root);
        const ctxDir = join(ctxBase, opts.context);
        const contextYmlPath = join(ctxDir, "context.yml");

        // Validate context exists
        if (!existsSync(contextYmlPath)) {
          console.error(
            `Error: Context "${opts.context}" does not exist. No context.yml found at ${contextYmlPath}.`,
          );
          process.exit(1);
        }

        const description = opts.description ?? `TODO: describe ${name}`;

        // Handle glossary separately — append to context.yml
        if (type === "glossary") {
          const raw = readFileSync(contextYmlPath, "utf-8");
          const meta = parseYaml<ContextMetaFile>(raw);

          // Check for duplicate
          if (meta.glossary?.some((g) => g.term === name)) {
            console.error(
              `Error: Glossary entry "${name}" already exists in context "${opts.context}".`,
            );
            process.exit(1);
          }

          if (!meta.glossary) {
            meta.glossary = [];
          }
          meta.glossary.push({ term: name, definition: description });
          writeFileSync(contextYmlPath, stringifyYaml(meta), "utf-8");

          console.log(
            `Added glossary entry "${name}" to context "${opts.context}" in context.yml.`,
          );
          return;
        }

        // File-based types
        const dirName = TYPE_DIR_MAP[type];
        const typeDir = join(ctxDir, dirName);
        const filePath = join(typeDir, `${name}.yml`);

        // Check if item already exists
        if (existsSync(filePath)) {
          console.error(
            `Error: ${type} "${name}" already exists at ${filePath}.`,
          );
          process.exit(1);
        }

        // Create type subdirectory if needed
        mkdirSync(typeDir, { recursive: true });

        // Write YAML file
        const yaml = generateYaml(type, name, description);
        writeFileSync(filePath, yaml, "utf-8");

        console.log(
          `Created ${type} "${name}" in context "${opts.context}":`,
        );
        console.log(`  contexts/${opts.context}/${dirName}/${name}.yml`);
      },
    );
}
