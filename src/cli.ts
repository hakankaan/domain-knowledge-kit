#!/usr/bin/env node
import { Command } from "commander";
import { pkgVersion } from "./version.js";
import { registerList } from "./features/query/commands/list.js";
import { registerShow } from "./features/query/commands/show.js";
import { registerSummary } from "./features/query/commands/summary.js";
import { registerSearch } from "./features/query/commands/search.js";
import { registerRelated } from "./features/query/commands/related.js";
import { registerGraph } from "./features/query/commands/graph.js";
import { registerLocate } from "./features/query/commands/locate.js";
import { registerStory } from "./features/query/commands/story.js";
import { registerValidate } from "./features/pipeline/commands/validate.js";
import { registerRender } from "./features/pipeline/commands/render.js";
import { registerInit } from "./features/agent/commands/init.js";
import { registerUpdate } from "./features/agent/commands/update.js";
import { registerArtifacts } from "./features/agent/commands/artifacts.js";
import { registerPrime } from "./features/agent/commands/prime.js";
import { registerAdrStatus } from "./features/adr/commands/adr-status.js";
import { registerAdrLink } from "./features/adr/commands/adr-link.js";
import { registerAdrAudit } from "./features/adr/commands/adr-audit.js";
import { registerAdrDecisions } from "./features/adr/commands/adr-decisions.js";
import { registerNewDomain } from "./features/scaffold/commands/new-domain.js";
import { registerNewContext } from "./features/scaffold/commands/new-context.js";
import { registerNewAdr } from "./features/scaffold/commands/new-adr.js";
import { registerAddItem } from "./features/scaffold/commands/add-item.js";
import { registerServiceInit } from "./features/scaffold/commands/service-init.js";
import { registerPeersAdd } from "./features/federation/commands/peers-add.js";
import { registerPeersList } from "./features/federation/commands/peers-list.js";
import { registerPeersStatus } from "./features/federation/commands/peers-status.js";
import { registerPull } from "./features/federation/commands/pull.js";
import { registerConsumers } from "./features/federation/commands/consumers.js";
import { registerRename } from "./features/refactor/commands/rename.js";
import { registerRm } from "./features/refactor/commands/rm.js";
import { registerMove } from "./features/refactor/commands/move.js";
import { registerStats } from "./features/audit/commands/stats.js";
import { registerDrift } from "./features/audit/commands/drift.js";
import { registerFeedback } from "./features/feedback/commands/feedback.js";
import { registerMcp } from "./features/mcp/commands/serve.js";
import { formatCliError } from "./shared/errors.js";

/** Whether to show full stack traces (set DEBUG=1 in env). */
const DEBUG = Boolean(process.env.DEBUG);

// ── CLI setup ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name("dkk")
  .description("Domain Knowledge Kit CLI")
  .version(pkgVersion)
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
registerStory(program);
registerValidate(program);
registerRender(program);
registerInit(program);
registerUpdate(program);
registerArtifacts(program);
registerPrime(program);
registerRename(program);
registerRm(program);
registerMove(program);
registerStats(program);
registerDrift(program);
registerFeedback(program);
registerMcp(program);

// "adr" sub-command group — decision lifecycle, after the file exists
const adrCmd = program
  .command("adr")
  .description("Architecture Decision Record lifecycle (status, linking, audit)");

registerAdrStatus(adrCmd);
registerAdrLink(adrCmd);
registerAdrDecisions(adrCmd);
registerAdrAudit(adrCmd);

// "new" sub-command group
const newCmd = program
  .command("new")
  .description("Scaffold new domain structures");

registerNewDomain(newCmd);
registerNewContext(newCmd);
registerNewAdr(newCmd);

// Top-level "add" command for individual domain items
registerAddItem(program);

// Federation: service identity
registerServiceInit(program);

// Federation: peer management
const peersCmd = program
  .command("peers")
  .description("Federation peer management");
registerPeersAdd(peersCmd);
registerPeersList(peersCmd);
registerPeersStatus(peersCmd);

// Federation: dkk pull + dkk consumers
registerPull(program);
registerConsumers(program);

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
