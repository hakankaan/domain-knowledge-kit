#!/usr/bin/env node
import { Command } from "commander";
import { registerList } from "./commands/list.js";
import { registerShow } from "./commands/show.js";
import { registerSearch } from "./commands/search.js";
import { registerRelated } from "./commands/related.js";
import { registerValidate } from "./commands/validate.js";
import { registerRender } from "./commands/render.js";
import { registerAdrShow } from "./commands/adr-show.js";
import { registerAdrRelated } from "./commands/adr-related.js";

const program = new Command();

program
  .name("domain-knowledge-kit")
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
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
