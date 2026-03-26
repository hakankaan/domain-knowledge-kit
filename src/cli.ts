#!/usr/bin/env node
import { Command } from "commander";
import { registerList } from "./features/query/commands/list.js";
import { registerShow } from "./features/query/commands/show.js";
import { registerSummary } from "./features/query/commands/summary.js";
import { registerSearch } from "./features/query/commands/search.js";
import { registerRelated } from "./features/query/commands/related.js";
import { registerGraph } from "./features/query/commands/graph.js";
import { registerLocate } from "./features/query/commands/locate.js";
import { registerValidate } from "./features/pipeline/commands/validate.js";
import { registerRender } from "./features/pipeline/commands/render.js";
import { registerInit } from "./features/agent/commands/init.js";
import { registerPrime } from "./features/agent/commands/prime.js";
import { registerNewDomain } from "./features/scaffold/commands/new-domain.js";
import { registerNewContext } from "./features/scaffold/commands/new-context.js";
import { registerNewAdr } from "./features/scaffold/commands/new-adr.js";
import { registerAddItem } from "./features/scaffold/commands/add-item.js";
import { registerRename } from "./features/refactor/commands/rename.js";
import { registerRm } from "./features/refactor/commands/rm.js";
import { registerMove } from "./features/refactor/commands/move.js";
import { registerStats } from "./features/audit/commands/stats.js";
import { formatCliError } from "./shared/errors.js";

/** Whether to show full stack traces (set DEBUG=1 in env). */
const DEBUG = Boolean(process.env.DEBUG);

// ── CLI setup ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name("dkk")
  .description("Domain Knowledge Kit CLI")
  .version("0.1.0")
  .configureHelp({ helpWidth: 100 })
  .addHelpText(
    "after",
    `
Domain Types:
  aggregate, command, event, policy, read_model, actor, glossary, rule, context, adr, flow

ID Formats:
  PascalCase   (domain items: OrderPlaced, PlaceOrder, etc.)
  kebab-case   (contexts, adrs: sales, adr-0001, etc.)
`
  );

// Top-level commands
registerList(program);
registerShow(program);
registerSummary(program);
registerSearch(program);
registerRelated(program);
registerGraph(program);
registerLocate(program);
registerValidate(program);
registerRender(program);
registerInit(program);
registerPrime(program);
registerRename(program);
registerRm(program);
registerMove(program);
registerStats(program);

// "new" sub-command group
const newCmd = program
  .command("new")
  .description("Scaffold new domain structures");

registerNewDomain(newCmd);
registerNewContext(newCmd);
registerNewAdr(newCmd);

// Top-level "add" command for individual domain items
registerAddItem(program);

// ── Agent mode injection ─────────────────────────────────────────────
program.option("--agent", "Enable agent mode (JSON + minify by default)");

// Add --no-json to commands that have --json
function injectAgentModeOpts(cmd: Command) {
  if (cmd.options.some((o) => o.long === "--json")) {
    cmd.option("--no-json", "Disable JSON output");
  }
  if (cmd.options.some((o) => o.long === "--minify")) {
    cmd.option("--no-minify", "Disable minified output");
  }
  cmd.commands.forEach(injectAgentModeOpts);
}
injectAgentModeOpts(program);

program.hook("preAction", (thisCmd, actionCmd) => {
  const isAgent = thisCmd.opts().agent || process.env.DKK_AGENT_MODE === "1";
  if (isAgent) {
    if (
      actionCmd.options.some((o) => o.long === "--json") &&
      actionCmd.getOptionValue("json") === undefined
    ) {
      actionCmd.setOptionValue("json", true);
    }
    if (
      actionCmd.options.some((o) => o.long === "--minify") &&
      actionCmd.getOptionValue("minify") === undefined
    ) {
      actionCmd.setOptionValue("minify", true);
    }
  }
});

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${formatCliError(err)}`);
  if (DEBUG && err instanceof Error && err.stack) {
    console.error(`\nStack trace:\n${err.stack}`);
  }
  process.exit(1);
});
