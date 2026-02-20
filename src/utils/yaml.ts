/**
 * YAML parse / stringify helpers.
 *
 * Thin wrappers around js-yaml that pin options and give
 * narrower return types than the generic `unknown`.
 */
import yaml from "js-yaml";

/**
 * Parse a YAML string into a typed object.
 *
 * @throws {yaml.YAMLException} on malformed YAML.
 */
export function parseYaml<T = Record<string, unknown>>(text: string): T {
  return yaml.load(text) as T;
}

/**
 * Stringify a value to a YAML string.
 *
 * Uses block-style scalars and 2-space indent for readability.
 */
export function stringifyYaml(value: unknown): string {
  return yaml.dump(value, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}
