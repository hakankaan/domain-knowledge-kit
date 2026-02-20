#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("domain-knowledge-kit")
  .description("Domain Knowledge Pack CLI")
  .version("0.1.0");

program.parse();
