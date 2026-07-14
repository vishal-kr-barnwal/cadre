import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { asJsonObject, asOptionalString } from "../guards";
import { PROTOCOL_VERSION } from "../mcp/domain/tool-catalog";
import { CommandPlan, RuntimePaths, Target, TargetPaths } from "./install-targets";
import { WorkflowCommandPlatform, WorkflowCommandSkills, WorkflowCommandSkillSets } from "./workflow-command-skills";

interface MpcServerConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  type?: string;
  tools?: string[];
}

export function runCommand(plan: CommandPlan): { ok: boolean; status: number | null; stderr: string } {
  const result = spawnSync(plan.command, plan.args, { encoding: "utf8" });
  return { ok: result.status === 0, status: result.status, stderr: result.stderr || "" };
}

export function pingMcp(runtime: RuntimePaths): { ok: boolean; reason?: string } {
  if (!fs.existsSync(runtime.mcpServer)) return { ok: false, reason: `missing MCP server: ${runtime.mcpServer}` };
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "cadre-installer", version: "1" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "cadre_action", arguments: { action: "project.ping" } },
    },
  ];
  const result = spawnSync(runtime.nodePath, [runtime.mcpServer], {
    cwd: runtime.runtimeRoot,
    input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.status !== 0 && !result.stdout.trim()) return { ok: false, reason: result.stderr || `MCP exited with ${result.status}` };
  try {
    const responses = result.stdout
      .split(/\r?\n/)
      .filter((entry) => entry.trim())
      .map((entry) => asJsonObject(JSON.parse(entry)));
    const initialize = responses.find((response) => response.id === 1);
    const ping = responses.find((response) => response.id === 2);
    if (!initialize) return { ok: false, reason: "MCP returned no initialize response" };
    const initializeError = asJsonObject(initialize.error);
    if (Object.keys(initializeError).length > 0) return { ok: false, reason: asOptionalString(initializeError.message) || "MCP initialize returned an error" };
    const initializeResult = asJsonObject(initialize.result);
    if (initializeResult.protocolVersion !== PROTOCOL_VERSION) {
      return { ok: false, reason: `MCP negotiated ${initializeResult.protocolVersion || "no protocol version"}; expected ${PROTOCOL_VERSION}` };
    }
    if (!ping) return { ok: false, reason: "MCP returned no ping response after initialization" };
    const pingError = asJsonObject(ping.error);
    if (Object.keys(pingError).length > 0) return { ok: false, reason: asOptionalString(pingError.message) || "MCP ping returned an error" };
    const pingResult = asJsonObject(ping.result);
    const content = Array.isArray(pingResult.content) ? pingResult.content : [];
    const text = asOptionalString(asJsonObject(content[0]).text);
    const body = text ? JSON.parse(text) as { data?: { ok?: boolean } } : null;
    return body?.data?.ok === true ? { ok: true } : { ok: false, reason: "MCP ping did not return ok:true" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function forbiddenThinPayload(root: string): string[] {
  return ["assets", "agents", "scripts", "references", "templates"]
    .filter((name) => fs.existsSync(path.join(root, name)))
    .map((name) => `${root}/${name}`);
}

function pluginConfigFiles(target: Target, pluginRoot: string): { manifest: string; mcp: string } {
  if (target === "codex") {
    return { manifest: path.join(pluginRoot, ".codex-plugin", "plugin.json"), mcp: path.join(pluginRoot, ".mcp.json") };
  }
  if (target === "claude") {
    return { manifest: path.join(pluginRoot, ".claude-plugin", "plugin.json"), mcp: path.join(pluginRoot, "mcp-config.json") };
  }
  if (target === "copilot") {
    return { manifest: path.join(pluginRoot, "plugin.json"), mcp: path.join(pluginRoot, ".mcp.json") };
  }
  return { manifest: path.join(pluginRoot, "plugin.json"), mcp: path.join(pluginRoot, "mcp_config.json") };
}

function checkMcpConfig(target: Target, file: string, runtime: RuntimePaths): string[] {
  const errors: string[] = [];
  const config = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpServers?: { cadre?: MpcServerConfig } };
  const server = config.mcpServers?.cadre;
  if (server?.command !== runtime.nodePath) errors.push(`${file} does not point at the current Node runtime`);
  if (server?.args?.[0] !== runtime.mcpServer) errors.push(`${file} does not point at ${runtime.mcpServer}`);
  if (server?.cwd !== runtime.runtimeRoot) errors.push(`${file} has wrong cwd`);
  if (target === "copilot") {
    if (server?.type !== "local") errors.push(`${file} must declare Copilot local MCP type`);
    if (!server?.tools?.includes("*")) errors.push(`${file} must allow Copilot MCP tools`);
  }
  return errors;
}

function checkCommandSkills(
  platform: WorkflowCommandPlatform,
  pluginRoot: string,
  commandSkills: WorkflowCommandSkills,
): string[] {
  const errors: string[] = [];
  if (Object.keys(commandSkills).length === 0) return [`Cadre ${platform} workflow commands are missing`];
  for (const [command, files] of Object.entries(commandSkills)) {
    const commandRoot = path.join(pluginRoot, "skills", command);
    if (fs.existsSync(commandRoot) && !fs.lstatSync(commandRoot).isDirectory()) {
      errors.push(`invalid Cadre command skill directory ${commandRoot}`);
      continue;
    }
    const expectedFiles = new Set(Object.keys(files).map((relative) => relative.replace(/\\/g, "/")));
    const expectedDirectories = new Set<string>();
    for (const relative of expectedFiles) {
      const parts = relative.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        expectedDirectories.add(parts.slice(0, index).join("/"));
      }
    }
    for (const [relative, expected] of Object.entries(files)) {
      const file = path.join(pluginRoot, "skills", command, ...relative.replace(/\\/g, "/").split("/"));
      if (!fs.existsSync(file)) {
        errors.push(`missing ${file}`);
        continue;
      }
      if (!fs.lstatSync(file).isFile()) {
        errors.push(`invalid Cadre command skill file ${file}`);
        continue;
      }
      const actual = fs.readFileSync(file, "utf8");
      const normalizedExpected = expected.endsWith("\n") ? expected : `${expected}\n`;
      if (actual !== normalizedExpected) errors.push(`stale Cadre command skill ${file}`);
    }
    if (fs.existsSync(commandRoot)) {
      const visit = (directory: string, relativeRoot = ""): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const relative = path.posix.join(relativeRoot, entry.name);
          if (entry.isDirectory()) {
            if (expectedDirectories.has(relative)) visit(path.join(directory, entry.name), relative);
            else errors.push(`unexpected Cadre command skill directory ${path.join(commandRoot, ...relative.split("/"))}`);
          } else if (!expectedFiles.has(relative)) {
            errors.push(`unexpected Cadre command skill file ${path.join(commandRoot, ...relative.split("/"))}`);
          }
        }
      };
      visit(commandRoot);
    }
  }
  const skillsRoot = path.join(pluginRoot, "skills");
  const expectedCommands = new Set(Object.keys(commandSkills));
  if (fs.existsSync(skillsRoot)) {
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !expectedCommands.has(entry.name)) {
        errors.push(`unexpected Cadre command skill ${path.join(skillsRoot, entry.name)}`);
      }
    }
  }
  return errors;
}

export function checkTarget(
  target: Target,
  paths: TargetPaths,
  runtime: RuntimePaths,
  commandSkillSets: WorkflowCommandSkillSets,
): string[] {
  const errors: string[] = [];
  for (const skillRoot of paths.skillRoots) {
    const skill = path.join(skillRoot, "SKILL.md");
    if (!fs.existsSync(skill)) errors.push(`missing ${skill}`);
  }
  for (const pluginRoot of paths.pluginRoots) {
    if (target !== "codex" && target !== "claude") {
      const skill = path.join(pluginRoot, "skills", "cadre", "SKILL.md");
      if (!fs.existsSync(skill)) errors.push(`missing ${skill}`);
    }
    const files = pluginConfigFiles(target, pluginRoot);
    if (!fs.existsSync(files.manifest)) errors.push(`missing ${files.manifest}`);
    if (!fs.existsSync(files.mcp)) errors.push(`missing ${files.mcp}`);
    errors.push(...forbiddenThinPayload(pluginRoot).map((entry) => `thin plugin contains forbidden payload ${entry}`));
    if (fs.existsSync(files.mcp)) errors.push(...checkMcpConfig(target, files.mcp, runtime));
    if (target === "codex" || target === "claude") {
      errors.push(...checkCommandSkills(target, pluginRoot, commandSkillSets[target]));
    }
  }
  if (paths.marketplaceFile && !fs.existsSync(paths.marketplaceFile)) errors.push(`missing ${paths.marketplaceFile}`);
  return errors;
}

export function printPlan(target: Target, paths: TargetPaths, commands: CommandPlan[]): void {
  if (paths.pluginRoots.length > 0) process.stdout.write(`Cadre ${target} plugin: ${paths.pluginRoots.join(", ")}\n`);
  if (paths.skillRoots.length > 0) process.stdout.write(`Cadre ${target} skill: ${paths.skillRoots.join(", ")}\n`);
  if (paths.marketplaceRoot) process.stdout.write(`Cadre ${target} marketplace: ${paths.marketplaceRoot}\n`);
  for (const command of commands) process.stdout.write(`Would run: ${command.command} ${command.args.join(" ")}\n`);
}
