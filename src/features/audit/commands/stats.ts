import type { Command as Cmd } from "commander";
import { loadDomainModel } from "../../../shared/loader.js";
import { DomainGraph } from "../../../shared/graph.js";

export function registerStats(program: Cmd): void {
  program
    .command("stats")
    .description("Print domain model statistics and potential orphaned items")
    .option("--json", "Output as JSON")
    .option("--minify", "Minify JSON output (useful for AI agents)")
    .option("-r, --root <path>", "Override repository root")
    .action(
      (
        opts: { json?: boolean; minify?: boolean; root?: string },
      ) => {
        const model = loadDomainModel({ root: opts.root });
        const graph = DomainGraph.from(model);

        const stats = {
            contexts: 0,
            events: 0,
            commands: 0,
            aggregates: 0,
            policies: 0,
            readModels: 0,
            actors: 0,
            adrs: 0,
            flows: 0,
            orphaned: [] as string[]
        };

        for (const [id, node] of graph.nodes) {
            switch (node.kind) {
                case "context": stats.contexts++; break;
                case "event": stats.events++; break;
                case "command": stats.commands++; break;
                case "aggregate": stats.aggregates++; break;
                case "policy": stats.policies++; break;
                case "read_model": stats.readModels++; break;
                case "actor": stats.actors++; break;
                case "adr": stats.adrs++; break;
                case "flow": stats.flows++; break;
            }

            // Check for orphaned items (items with only 1 edge = "contains" from context,
            // meaning they don't participate in handles/emits/triggers/etc with other items)
            if (node.kind !== "context" && node.kind !== "actor" && node.kind !== "adr" && node.kind !== "flow" && node.kind !== "glossary") {
                let connectionCount = 0;
                for (const edge of graph.edges) {
                    if ((edge.from === id || edge.to === id) && edge.label !== "contains") {
                        connectionCount++;
                    }
                }
                if (connectionCount === 0) {
                    stats.orphaned.push(id);
                }
            }
        }

        if (opts.json) {
          const payload = {
            counts: {
              contexts: stats.contexts,
              events: stats.events,
              commands: stats.commands,
              aggregates: stats.aggregates,
              policies: stats.policies,
              readModels: stats.readModels,
              actors: stats.actors,
              flows: stats.flows,
              adrs: stats.adrs,
            },
            health: {
              orphanedCount: stats.orphaned.length,
              orphaned: stats.orphaned,
            },
          };
          console.log(JSON.stringify(payload, null, opts.minify ? 0 : 2));
          return;
        }

        console.log(`\n📊 Domain Model Statistics\n`);
        console.log(`  Contexts:    ${stats.contexts}`);
        console.log(`  Events:      ${stats.events}`);
        console.log(`  Commands:    ${stats.commands}`);
        console.log(`  Aggregates:  ${stats.aggregates}`);
        console.log(`  Policies:    ${stats.policies}`);
        console.log(`  Read Models: ${stats.readModels}`);
        console.log(`  Actors:      ${stats.actors}`);
        console.log(`  Flows:       ${stats.flows}`);
        console.log(`  ADRs:        ${stats.adrs}`);

        console.log(`\n🔍 Health Check`);
        if (stats.orphaned.length > 0) {
            console.log(`  Found ${stats.orphaned.length} potentially orphaned items (no relationships):`);
            for (const orphan of stats.orphaned) {
                console.log(`    - ${orphan}`);
            }
        } else {
            console.log(`  No orphaned items found! All clear.`);
        }
        console.log("");
      },
    );
}
