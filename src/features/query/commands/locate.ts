import type { Command as Cmd } from "commander";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { adrDir, actorsFile, indexFile, contextsDir } from "../../../shared/paths.js";
import { parseYaml } from "../../../shared/yaml.js";

function resolveItemPath(id: string, root?: string): string[] {
  const rootPath = resolve(root || process.cwd());
  
  if (id.startsWith("actor.")) {
    const p = actorsFile(rootPath);
    return existsSync(p) ? [p] : [];
  }
  
  if (id.startsWith("adr-")) {
    const p = join(adrDir(rootPath), `${id}.md`);
    return existsSync(p) ? [p] : [];
  }
  
  if (id.startsWith("flow.")) {
    const p = indexFile(rootPath);
    return existsSync(p) ? [p] : [];
  }
  
  if (id.startsWith("context.")) {
    const name = id.substring("context.".length);
    const p = join(contextsDir(rootPath), name, "context.yml");
    return existsSync(p) ? [p] : [];
  }
  
  const dotIdx = id.indexOf(".");
  if (dotIdx > 0) {
    const ctxName = id.substring(0, dotIdx);
    const itemName = id.substring(dotIdx + 1);
    
    // Scoped items inside context (events, commands, etc)
    const ctxPath = join(contextsDir(rootPath), ctxName);
    if (!existsSync(ctxPath)) return [];
    
    const matches: string[] = [];
    const dirs = ["events", "commands", "policies", "aggregates", "read-models"];
    for (const dir of dirs) {
      const dPath = join(ctxPath, dir);
      if (!existsSync(dPath)) continue;
      
      const files = readdirSync(dPath).filter(f => (f.endsWith(".yml") || f.endsWith(".yaml")) && !f.startsWith("."));
      for (const f of files) {
        const filePath = join(dPath, f);
        try {
          const content = readFileSync(filePath, "utf-8");
          const parsed = parseYaml<{name?: string, term?: string}>(content);
          if (parsed && (parsed.name === itemName || parsed.term === itemName)) {
            matches.push(filePath);
          }
        } catch {
          // ignore parsing errors
        }
      }
    }
    
    // Check context.yml for glossary term
    const ctxFile = join(ctxPath, "context.yml");
    if (existsSync(ctxFile)) {
         try {
             const content = readFileSync(ctxFile, "utf-8");
             const parsed = parseYaml<{glossary?: {term: string}[]}>(content);
             if (parsed && parsed.glossary && parsed.glossary.some(g => g.term === itemName)) {
                 matches.push(ctxFile);
             }
         } catch {}
    }
    
    return matches;
  }
  
  return [];
}

export function registerLocate(program: Cmd): void {
  program
    .command("locate <id>")
    .description("Return the absolute file path(s) where a domain item is defined")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output")
    .option("-r, --root <path>", "Override repository root")
    .action((id: string, opts: { json?: boolean; minify?: boolean; root?: string }) => {
      const resolved = resolveItemPath(id, opts.root);
      
      if (resolved.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ error: `Not found: ${id}` }, null, opts.minify ? 0 : 2));
        } else {
          console.error(`Error: File for "${id}" not found.`);
        }
        process.exit(1);
      }
      
      if (opts.json) {
        console.log(JSON.stringify({ id, paths: resolved }, null, opts.minify ? 0 : 2));
        return;
      }
      
      for (const p of resolved) {
        console.log(p);
      }
    });
}
