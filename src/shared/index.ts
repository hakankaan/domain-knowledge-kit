/**
 * Barrel export for all shared / cross-cutting modules.
 *
 * Consumers can import from `../shared/index.js` (or just `../shared/`)
 * instead of reaching into individual files.
 */

// ── Types ─────────────────────────────────────────────────────────────
export * from "./types/domain.js";
export * from "./types/index.js";
export * from "./types/federation.js";

// ── Item visitor ──────────────────────────────────────────────────────
export {
  type ItemType,
  type AnyDomainItem,
  ITEM_TYPES,
  itemName,
  itemDescription,
  itemAdrRefs,
  forEachItem,
  mapItems,
} from "./item-visitor.js";

// ── Loader ────────────────────────────────────────────────────────────
export { loadDomainModel, type LoaderOptions } from "./loader.js";

// ── Graph ─────────────────────────────────────────────────────────────
export { DomainGraph, type NodeKind, type GraphNode, type GraphEdge } from "./graph.js";

// ── Path helpers ──────────────────────────────────────────────────────
export {
  repoRoot,
  findDkkRoot,
  packageRoot,
  domainDir,
  contextsDir,
  actorsFile,
  indexFile,
  adrDir,
  docsDir,
  templatesDir,
  schemaDir,
  repoRelative,
  feedbackFile,
  serviceFile,
  federationFile,
  federationLockFile,
  importsDir,
  importedServiceDir,
} from "./paths.js";

// ── Refs ──────────────────────────────────────────────────────────────
export {
  parseRef,
  formatRef,
  qualifyItemRef,
  qualifyActorRef,
  type ParsedRef,
  type QualifiedRef,
} from "./refs.js";

// ── Service identity ──────────────────────────────────────────────────
export { loadServiceId } from "./service-id.js";

// ── YAML helpers ──────────────────────────────────────────────────────
export { parseYaml, stringifyYaml } from "./yaml.js";

// ── ADR parser ────────────────────────────────────────────────────────
export { parseAdrFrontmatter, parseAdrFile } from "./adr-parser.js";

// ── Error formatting ──────────────────────────────────────────────────
export { formatCliError, isYAMLException, isNodeSystemError } from "./errors.js";
