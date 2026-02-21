#!/usr/bin/env node
import { Command } from "commander";
import { registerList } from "./features/query/commands/list.js";
import { registerShow } from "./features/query/commands/show.js";
import { registerSearch } from "./features/query/commands/search.js";
import { registerRelated } from "./features/query/commands/related.js";
import { registerValidate } from "./features/pipeline/commands/validate.js";
import { registerRender } from "./features/pipeline/commands/render.js";
import { registerAdrShow } from "./features/adr/commands/adr-show.js";
import { registerAdrRelated } from "./features/adr/commands/adr-related.js";
import { formatCliError } from "./shared/errors.js";

/** Whether to show full stack traces (set DEBUG=1 in env). */
const DEBUG = Boolean(process.env.DEBUG);

// ── CLI setup ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name("dkk")
  .description("Domain Knowledge Pack CLI")
  .version("0.1.0");

// Top-level commands
registerList(program);
registerShow(program);
registerSearch(program);
registerRelated(program);
registerValidate(program);
registerRender(program);

// ADR sub-command group
const adrCmd = program
  .command("adr")
  .description("ADR-related commands");

registerAdrShow(adrCmd);
registerAdrRelated(adrCmd);

program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${formatCliError(err)}`);
  if (DEBUG && err instanceof Error && err.stack) {
    console.error(`\nStack trace:\n${err.stack}`);
  }
  process.exit(1);
});
