/**
 * `dkk add <type> <name> --context <ctx>` command — scaffold individual domain items.
 *
 * Supported types: event, command, aggregate, policy, read_model, glossary, actor
 *
 * For file-based types (event, command, aggregate, policy, read_model):
 *   Creates `.dkk/domain/contexts/<ctx>/<type-plural>/<Name>.yml`
 *
 * For glossary:
 *   Appends entry to `.dkk/domain/contexts/<ctx>/context.yml` glossary array
 *   (glossary entries are stored inline in context.yml, not as separate files).
 *
 * For actor:
 *   Appends entry to `.dkk/domain/actors.yml` (global actors file).
 */
import type { Command as Cmd } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contextsDir, actorsFile } from "../../../shared/paths.js";
import { parseYaml, stringifyYaml } from "../../../shared/yaml.js";
import type { ActorsFile, ContextMetaFile } from "../../../shared/types/domain.js";
import { loadDomainModel } from "../../../shared/loader.js";
import { DomainGraph } from "../../../shared/graph.js";
import { wireNewItem } from "../wiring.js";

// ── Constants ─────────────────────────────────────────────────────────

/** Supported item types and their plural directory names. */
const TYPE_DIR_MAP: Record<string, string> = {
  event: "events",
  command: "commands",
  aggregate: "aggregates",
  policy: "policies",
  read_model: "read-models",
};

/** All supported item types (including glossary and actor which are handled differently). */
const SUPPORTED_TYPES = [...Object.keys(TYPE_DIR_MAP), "glossary", "actor"];

// ── YAML generators ──────────────────────────────────────────────────

export interface AddItemRelations {
  raisedBy?: string;
  handledBy?: string;
  actor?: string;
  triggers?: string[];
  emits?: string[];
  handles?: string[];
  subscribesTo?: string[];
  usedBy?: string[];
  fromObj?: Record<string, unknown>;
}

function eventYaml(name: string, description: string, rel: AddItemRelations): string {
  let out = `name: ${name}\ndescription: "${description}"\n`;
  if (rel.fromObj?.fields) out += `fields:\n${stringifyYaml(rel.fromObj.fields).trimEnd().split('\n').map(l => `  ${l}`).join('\n')}\n`;
  if (rel.raisedBy) out += `raised_by: ${rel.raisedBy}\n`;
  return out;
}

function commandYaml(name: string, description: string, rel: AddItemRelations): string {
  let out = `name: ${name}\ndescription: "${description}"\n`;
  if (rel.fromObj?.fields) out += `fields:\n${stringifyYaml(rel.fromObj.fields).trimEnd().split('\n').map(l => `  ${l}`).join('\n')}\n`;
  if (rel.actor) out += `actor: ${rel.actor}\n`;
  if (rel.handledBy) out += `handled_by: ${rel.handledBy}\n`;
  return out;
}

function aggregateYaml(name: string, description: string, rel: AddItemRelations): string {
  const handles = rel.handles?.length ? rel.handles.map(h => `    - ${h}`).join('\n') : "    []";
  const emits = rel.emits?.length ? rel.emits.map(e => `    - ${e}`).join('\n') : "    []";
  return [
    `name: ${name}`,
    `description: "${description}"`,
    "handles:",
    `  commands:\n${handles === "    []" ? "    []" : handles}`,
    "emits:",
    `  events:\n${emits === "    []" ? "    []" : emits}`,
    "",
  ].join("\n");
}

function policyYaml(name: string, description: string, rel: AddItemRelations): string {
  const triggers = rel.triggers?.length ? rel.triggers.map(t => `    - ${t}`).join('\n') : "    []";
  const emits = rel.emits?.length ? rel.emits.map(e => `    - ${e}`).join('\n') : "    []";
  return [
    `name: ${name}`,
    `description: "${description}"`,
    "when:",
    `  events:\n${triggers === "    []" ? "    []" : triggers}`,
    "then:",
    `  commands:\n${emits === "    []" ? "    []" : emits}`,
    "",
  ].join("\n");
}

function readModelYaml(name: string, description: string, rel: AddItemRelations): string {
  const subs = rel.subscribesTo?.length ? rel.subscribesTo.map(s => `  - ${s}`).join('\n') : "  []";
  const users = rel.usedBy?.length ? rel.usedBy.map(u => `  - ${u}`).join('\n') : "  []";
  return [
    `name: ${name}`,
    `description: "${description}"`,
    `subscribes_to:\n${subs === "  []" ? "  []" : subs}`,
    `used_by:\n${users === "  []" ? "  []" : users}`,
    "",
  ].join("\n");
}

/** Return YAML content for a file-based item type. */
function generateYaml(type: string, name: string, description: string, rel: AddItemRelations): string {
  switch (type) {
    case "event":
      return eventYaml(name, description, rel);
    case "command":
      return commandYaml(name, description, rel);
    case "aggregate":
      return aggregateYaml(name, description, rel);
    case "policy":
      return policyYaml(name, description, rel);
    case "read_model":
      return readModelYaml(name, description, rel);
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

function parseCsv(val: string): string[] {
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

export function registerAddItem(program: Cmd): void {
  program
    .command("add <type> <name>")
    .description("Scaffold a basic domain item")
    .requiredOption("-c, --context <ctx>", "Target bounded context (kebab-case)")
    .option("-d, --description <text>", "Description of the item")
    .option("--raised-by <id>", "Aggregate that raises this event")
    .option("--handled-by <id>", "Aggregate that handles this command")
    .option("--actor <id>", "Actor that initiates this command")
    .option("--triggers <ids>", "Events that trigger this policy (comma-separated)", parseCsv)
    .option("--emits <ids>", "Commands emitted by policy / events emitted by aggregate (comma-separated)", parseCsv)
    .option("--handles <ids>", "Commands handled by aggregate (comma-separated)", parseCsv)
    .option("--subscribes-to <ids>", "Events subscribed to by read_model (comma-separated)", parseCsv)
    .option("--used-by <ids>", "Actors that use this read_model (comma-separated)", parseCsv)
    .option("--from <id>", "Clone structure from existing item ID")
    .option("--actor-type <type>", "Actor type: human, system, external (only for actor)")
    .option("--no-wire", "Skip automatic bidirectional relationship wiring")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .option("-r, --root <path>", "Override repository root")
    .action(
      (
        type: string,
        name: string,
        opts: { 
          context: string; description?: string; root?: string; json?: boolean; minify?: boolean;
          from?: string; raisedBy?: string; handledBy?: string; actor?: string;
          actorType?: string; wire?: boolean;
          triggers?: string[]; emits?: string[]; handles?: string[]; subscribesTo?: string[]; usedBy?: string[];
        },
      ) => {
        // Alias read-model to read_model
        if (type === "read-model") type = "read_model";

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

        // ── Actor type — global actors.yml, no context required ───────────
        if (type === "actor") {
          const actorType = opts.actorType ?? "human";
          const validActorTypes = ["human", "system", "external"];
          if (!validActorTypes.includes(actorType)) {
            console.error(`Error: Invalid actor type "${actorType}". Must be one of: ${validActorTypes.join(", ")}`);
            process.exit(1);
          }

          const actorsPath = actorsFile(opts.root);
          const raw = existsSync(actorsPath) ? readFileSync(actorsPath, "utf-8") : "actors: []\n";
          const actorsObj = parseYaml<ActorsFile>(raw);
          if (!actorsObj.actors) actorsObj.actors = [];

          if (actorsObj.actors.some((a) => a.name === name)) {
            if (opts.json) {
              console.log(JSON.stringify({ error: `Actor "${name}" already exists` }, null, opts.minify ? 0 : 2));
            } else {
              console.error(`Error: Actor "${name}" already exists in actors.yml.`);
            }
            process.exit(1);
          }

          actorsObj.actors.push({
            name,
            type: actorType as "human" | "system" | "external",
            description: opts.description ?? `TODO: describe ${name}`,
          });
          writeFileSync(actorsPath, stringifyYaml(actorsObj), "utf-8");

          if (opts.json) {
            console.log(JSON.stringify({ id: name, path: actorsPath, type: "actor", name }, null, opts.minify ? 0 : 2));
          } else {
            console.log(`Added actor "${name}" (${actorType}) to actors.yml.`);
          }
          return;
        }

        const ctxDir = join(ctxBase, opts.context);
        const contextYmlPath = join(ctxDir, "context.yml");

        // Validate context exists
        if (!existsSync(contextYmlPath)) {
          console.error(
            `Error: Context "${opts.context}" does not exist. No context.yml found at ${contextYmlPath}.`,
          );
          process.exit(1);
        }

        let description = opts.description ?? `TODO: describe ${name}`;

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

        // Handle --from templating
        let fromObj: Record<string, unknown> | undefined = undefined;
        if (opts.from) {
            const model = loadDomainModel({ root: opts.root });
            const graph = DomainGraph.from(model);
            if (!graph.hasNode(opts.from)) {
                console.error(`Error: --from target '${opts.from}' not found.`);
                process.exit(1);
            }
            // For cloning fields, we need the actual Yaml representation
            // We can re-use the load function but doing it manually is tedious.
            // Since we know the context and name, we can just parse the file directly:
            const [fromCtx, fromName] = opts.from.split('.');
            const fromKind = graph.nodes.get(opts.from)?.kind ?? 'event';
            if (TYPE_DIR_MAP[fromKind]) {
               const fromPath = join(ctxBase, fromCtx, TYPE_DIR_MAP[fromKind], `${fromName}.yml`);
               if (existsSync(fromPath)) {
                   fromObj = parseYaml(readFileSync(fromPath, 'utf-8')) as Record<string, unknown>;
                   if (!opts.description && fromObj.description) {
                       description = fromObj.description as string;
                   }
               }
            }
        }

        // File-based types
        const dirName = TYPE_DIR_MAP[type];
        const typeDir = join(ctxDir, dirName);
        const filePath = join(typeDir, `${name}.yml`);

        // Check if item already exists
        if (existsSync(filePath)) {
          if (opts.json) {
              console.log(JSON.stringify({ error: `${type} "${name}" already exists at ${filePath}` }, null, opts.minify ? 0 : 2));
          } else {
              console.error(`Error: ${type} "${name}" already exists at ${filePath}.`);
          }
          process.exit(1);
        }

        // Create type subdirectory if needed
        mkdirSync(typeDir, { recursive: true });

        const rel: AddItemRelations = {
            raisedBy: opts.raisedBy,
            handledBy: opts.handledBy,
            actor: opts.actor,
            triggers: opts.triggers,
            emits: opts.emits,
            handles: opts.handles,
            subscribesTo: opts.subscribesTo,
            usedBy: opts.usedBy,
            fromObj: fromObj
        };

        // Write YAML file
        const yaml = generateYaml(type, name, description, rel);
        writeFileSync(filePath, yaml, "utf-8");

        // Bidirectional wiring (opt-out with --no-wire)
        const wireResult = opts.wire !== false
          ? wireNewItem({
              type,
              name,
              context: opts.context,
              raisedBy: opts.raisedBy,
              handledBy: opts.handledBy,
              handles: opts.handles,
              emits: opts.emits,
              root: opts.root,
            })
          : { wired: [], skipped: [] };

        if (opts.json) {
            console.log(JSON.stringify({
                id: `${opts.context}.${name}`,
                path: filePath,
                type,
                name,
                wired: wireResult.wired,
            }, null, opts.minify ? 0 : 2));
            return;
        }

        console.log(`Created ${type} "${name}" in context "${opts.context}":`);
        console.log(`  ${filePath}`);
        for (const w of wireResult.wired) {
          console.log(`  Wired: ${w}`);
        }
      },
    );
}
