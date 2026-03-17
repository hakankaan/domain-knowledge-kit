import type { Command as Cmd } from "commander";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDomainModel } from "../../../shared/loader.js";
import { DomainGraph } from "../../../shared/graph.js";

function escapeMermaidId(id: string): string {
    return id.replace(/[\.\-]/g, "_");
}

export function registerGraph(program: Cmd): void {
  program
    .command("graph")
    .description("Generate a Mermaid.js flowchart of the domain model")
    .option("-o, --output <file>", "Output file path (default: .dkk/docs/graph.md)")
    .option("-d, --depth <n>", "Maximum traversal depth for large graphs", parseInt, 3)
    .option("-r, --root <path>", "Override repository root")
    .action(
      (
        opts: { root?: string; output?: string; depth: number },
      ) => {
        const model = loadDomainModel({ root: opts.root });
        const graph = DomainGraph.from(model);

        const outPath = opts.output || (opts.root ? join(opts.root, ".dkk", "docs", "graph.md") : join(process.cwd(), ".dkk", "docs", "graph.md"));

        const lines: string[] = ["```mermaid", "flowchart TD"];

        // Write nodes
        const writtenNodes = new Set<string>();
        
        for (const [id, node] of graph.nodes) {
            const mId = escapeMermaidId(id);
            writtenNodes.add(mId);

            const label = node.name;
            let shape = `[${label}]`;

            switch (node.kind) {
                case "event": shape = `> ${label} ]`; break;
                case "command": shape = `([${label}])`; break;
                case "aggregate": shape = `[[${label}]]`; break;
                case "policy": shape = `{{${label}}}`; break;
                case "read_model": shape = `[(${label})]`; break;
                case "actor": shape = `(( ${label} ))`; break;
                case "flow": shape = `[[${label}]]`; break;
                case "adr": shape = `[\\${label}\\]`; break;
            }

            lines.push(`    ${mId}${shape}`);
        }

        lines.push("\n    %% Relationships");

        // Write edges
        for (const edge of graph.edges) {
            // Filter out internal structural edges
            if (edge.label === "contains" || edge.label === "flow_next" || edge.label === "adr_ref") {
                continue; 
            }

            const from = escapeMermaidId(edge.from);
            const to = escapeMermaidId(edge.to);
            let link = `-->`;
            
            if (edge.label === "subscribes_to" || edge.label === "used_by") {
               link = `-.->`
            } else if (edge.label === "handles") {
               link = `==>`
            }

            lines.push(`    ${from} ${link}|${edge.label}| ${to}`);
        }

        lines.push("```\n");
        const content = lines.join("\n");

        try {
            writeFileSync(outPath, content, "utf-8");
            console.log(`Generated Mermaid graph at ${outPath}`);
        } catch (err: unknown) {
             const msg = err instanceof Error ? err.message : String(err);
             console.error(`Failed to write graph to ${outPath}:`, msg);
             process.exit(1);
        }
      },
    );
}
