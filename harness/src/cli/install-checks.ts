import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CommandPlan, RuntimePaths, Target, TargetPaths } from "./install-targets";

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
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "cadre_project", arguments: { action: "ping" } },
  };
  const result = spawnSync(runtime.nodePath, [runtime.mcpServer], {
    cwd: runtime.runtimeRoot,
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.status !== 0 && !result.stdout.trim()) return { ok: false, reason: result.stderr || `MCP exited with ${result.status}` };
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.trim());
  if (!line) return { ok: false, reason: "MCP returned no JSON-RPC response" };
  try {
    const parsed = JSON.parse(line) as { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
    if (parsed.error) return { ok: false, reason: parsed.error.message || "MCP returned an error" };
    const text = parsed.result?.content?.[0]?.text;
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

export function checkTarget(target: Target, paths: TargetPaths, runtime: RuntimePaths): string[] {
  const errors: string[] = [];
  for (const skillRoot of paths.skillRoots) {
    const skill = path.join(skillRoot, "SKILL.md");
    if (!fs.existsSync(skill)) errors.push(`missing ${skill}`);
  }
  for (const pluginRoot of paths.pluginRoots) {
    const skill = path.join(pluginRoot, "skills", "cadre", "SKILL.md");
    if (!fs.existsSync(skill)) errors.push(`missing ${skill}`);
    const files = pluginConfigFiles(target, pluginRoot);
    if (!fs.existsSync(files.manifest)) errors.push(`missing ${files.manifest}`);
    if (!fs.existsSync(files.mcp)) errors.push(`missing ${files.mcp}`);
    errors.push(...forbiddenThinPayload(pluginRoot).map((entry) => `thin plugin contains forbidden payload ${entry}`));
    if (fs.existsSync(files.mcp)) errors.push(...checkMcpConfig(target, files.mcp, runtime));
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
