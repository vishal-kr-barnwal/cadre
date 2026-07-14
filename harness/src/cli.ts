#!/usr/bin/env node
import { runCli } from "./cli/install";
import { renderWorkflowCommandSkills } from "./cli/workflow-command-skills";

declare const __CADRE_SKILL_SHIM__: string | undefined;
declare const __CADRE_COMMAND_SKILL_TEMPLATE__: string | undefined;
declare const __CADRE_WORKFLOW_COMMANDS__: readonly string[] | undefined;

const commandSkillTemplate = typeof __CADRE_COMMAND_SKILL_TEMPLATE__ === "string"
  ? __CADRE_COMMAND_SKILL_TEMPLATE__
  : "";
const workflowCommands = typeof __CADRE_WORKFLOW_COMMANDS__ !== "undefined"
  && Array.isArray(__CADRE_WORKFLOW_COMMANDS__)
  ? __CADRE_WORKFLOW_COMMANDS__
  : [];

runCli(process.argv.slice(2), {
  skillShim: typeof __CADRE_SKILL_SHIM__ === "string" ? __CADRE_SKILL_SHIM__ : "",
  commandSkills: renderWorkflowCommandSkills(commandSkillTemplate, workflowCommands),
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
