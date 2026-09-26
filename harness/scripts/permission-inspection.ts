import {
  parse as parseJsonc,
  type ParseError
} from "jsonc-parser/lib/esm/main.js";
import { parse as parseToml } from "smol-toml";
import {
  CLAUDE_APPROVAL,
  CLAUDE_SERVER_APPROVAL,
  ZED_MCP_PERMISSION_KEYS
} from "./permissions.js";

export type PermissionInspectionState = "healthy" | "unconfigured" | "malformed" | "conflicting";

export interface PermissionInspection {
  state: PermissionInspectionState;
  evidence: readonly string[];
  remediation: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function permissionInspection(
  state: PermissionInspectionState,
  evidence: readonly string[],
  remediation: readonly string[]
): PermissionInspection {
  return { state, evidence, remediation };
}

function cadreCodexPolicy(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const plugins = value.plugins;
  if (!isRecord(plugins)) return undefined;
  const plugin = plugins["cadre@cadre"];
  if (!isRecord(plugin) || !isRecord(plugin.mcp_servers)) return undefined;
  const server = plugin.mcp_servers.cadre;
  return isRecord(server) ? server : undefined;
}

function codexPolicyLayoutConflicts(value: unknown): boolean {
  if (!isRecord(value)) return true;
  const plugins = value.plugins;
  if (plugins === undefined) return false;
  if (!isRecord(plugins)) return true;
  const plugin = plugins["cadre@cadre"];
  if (plugin === undefined) return false;
  if (!isRecord(plugin)) return true;
  const servers = plugin.mcp_servers;
  if (servers === undefined) return false;
  if (!isRecord(servers)) return true;
  const server = servers.cadre;
  return server !== undefined && !isRecord(server);
}

function inspectedStringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
  return value as string[];
}

function deniesCadre(rule: string): boolean {
  return rule === "mcp__*" || rule === "mcp__cadre" || rule.startsWith("mcp__cadre__");
}

function zedServerMatches(server: unknown, nodePath: string, mcpPath: string): boolean {
  if (!isRecord(server) || server.command !== nodePath || !Array.isArray(server.args)) return false;
  return server.args.length === 1 && server.args[0] === mcpPath;
}

function zedServerTargetsMcp(server: unknown, mcpPath: string): boolean {
  return isRecord(server)
    && Array.isArray(server.args)
    && server.args.length === 1
    && server.args[0] === mcpPath;
}

function hasBlockingZedRule(rule: Record<string, unknown>, field: "always_deny" | "always_confirm"): boolean {
  const value = rule[field];
  return value !== undefined && (!Array.isArray(value) || value.length > 0);
}

/** Pure inspection for doctor; it never reads or writes a file. */
export function inspectCodexMcpApproval(content: string | null): PermissionInspection {
  if (content === null) {
    return permissionInspection(
      "unconfigured",
      ["Cadre's narrow MCP approval is not configured."],
      ["Run cadre-ai install --target codex to apply the narrow Cadre approval."]
    );
  }
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch {
    return permissionInspection(
      "malformed",
      ["The Codex configuration is not valid TOML."],
      ["Repair the Codex configuration before rerunning cadre-ai install --target codex."]
    );
  }
  if (codexPolicyLayoutConflicts(parsed)) {
    return permissionInspection(
      "conflicting",
      ["Cadre's Codex MCP policy uses a conflicting configuration layout."],
      ["Resolve the Cadre policy layout before rerunning cadre-ai install --target codex."]
    );
  }
  if (cadreCodexPolicy(parsed)?.default_tools_approval_mode === "approve") {
    return permissionInspection("healthy", ["Cadre's narrow MCP approval is configured."], []);
  }
  return permissionInspection(
    "unconfigured",
    ["Cadre's narrow MCP approval is missing or not set to approve."],
    ["Run cadre-ai install --target codex to apply the narrow Cadre approval."]
  );
}

/** Pure inspection for doctor; it preserves the same Claude deny-rule semantics as configuration. */
export function inspectClaudeMcpApproval(content: string | null): PermissionInspection {
  if (content === null) {
    return permissionInspection(
      "unconfigured",
      ["The Cadre MCP server and tool approval are not configured."],
      ["Run cadre-ai install --target claude to configure both Cadre approval conditions."]
    );
  }
  const errors: ParseError[] = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true }) as unknown;
  if (errors.length || !isRecord(parsed)) {
    return permissionInspection(
      "malformed",
      ["The Claude settings are not a valid JSONC object."],
      ["Repair the Claude settings before rerunning cadre-ai install --target claude."]
    );
  }
  if (parsed.permissions !== undefined && !isRecord(parsed.permissions)) {
    return permissionInspection(
      "malformed",
      ["Claude permissions is not an object."],
      ["Repair the Claude settings before rerunning cadre-ai install --target claude."]
    );
  }
  const permissions = isRecord(parsed.permissions) ? parsed.permissions : {};
  const allow = inspectedStringArray(permissions.allow);
  const deny = inspectedStringArray(permissions.deny);
  const enabledServers = inspectedStringArray(parsed.enabledMcpjsonServers);
  if (allow === null || deny === null || enabledServers === null) {
    return permissionInspection(
      "malformed",
      ["Claude Cadre permission fields must be arrays of strings."],
      ["Repair the Claude settings before rerunning cadre-ai install --target claude."]
    );
  }
  if (deny.some(deniesCadre)) {
    return permissionInspection(
      "conflicting",
      ["A Claude deny rule blocks Cadre MCP tools."],
      ["Remove the conflicting Cadre deny rule before rerunning cadre-ai install --target claude."]
    );
  }
  const missing: string[] = [];
  if (!enabledServers.includes(CLAUDE_SERVER_APPROVAL)) missing.push("the Cadre MCP server enablement");
  if (!allow.includes(CLAUDE_APPROVAL)) missing.push("the narrow Cadre tool approval");
  if (!missing.length) {
    return permissionInspection(
      "healthy",
      ["The Cadre MCP server and narrow tool approval are configured."],
      []
    );
  }
  return permissionInspection(
    "unconfigured",
    [`Missing ${missing.join(" and ")}.`],
    ["Run cadre-ai install --target claude to configure both Cadre approval conditions."]
  );
}

/** Pure inspection for doctor; it checks the managed Zed server and exact Cadre approvals without mutation. */
export function inspectZedCadreConfiguration(
  content: string | null,
  nodePath: string,
  mcpPath: string
): PermissionInspection {
  if (content === null) {
    return permissionInspection(
      "unconfigured",
      ["The managed Cadre Zed server and exact tool approvals are not configured."],
      ["Run cadre-ai install --target zed to configure the managed local integration."]
    );
  }
  const errors: ParseError[] = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true }) as unknown;
  if (errors.length || !isRecord(parsed)) {
    return permissionInspection(
      "malformed",
      ["The Zed settings are not a valid JSONC object."],
      ["Repair the Zed settings before rerunning cadre-ai install --target zed."]
    );
  }
  const contextServers = parsed.context_servers === undefined ? {} : parsed.context_servers;
  const agent = parsed.agent === undefined ? {} : parsed.agent;
  if (!isRecord(contextServers) || !isRecord(agent)) {
    return permissionInspection(
      "malformed",
      ["Zed context server or agent settings are not objects."],
      ["Repair the Zed settings before rerunning cadre-ai install --target zed."]
    );
  }
  const toolPermissions = agent.tool_permissions === undefined ? {} : agent.tool_permissions;
  if (!isRecord(toolPermissions)) {
    return permissionInspection(
      "malformed",
      ["Zed agent tool permissions are not an object."],
      ["Repair the Zed settings before rerunning cadre-ai install --target zed."]
    );
  }
  const tools = toolPermissions.tools === undefined ? {} : toolPermissions.tools;
  if (!isRecord(tools)) {
    return permissionInspection(
      "malformed",
      ["Zed Cadre tool permissions are not an object."],
      ["Repair the Zed settings before rerunning cadre-ai install --target zed."]
    );
  }
  const malformedTool = ZED_MCP_PERMISSION_KEYS.find((key) => tools[key] !== undefined && !isRecord(tools[key]));
  if (malformedTool) {
    return permissionInspection(
      "malformed",
      ["A Zed Cadre tool permission is not an object."],
      ["Repair the Zed settings before rerunning cadre-ai install --target zed."]
    );
  }
  const currentServer = contextServers.cadre;
  if (currentServer !== undefined && !zedServerTargetsMcp(currentServer, mcpPath)) {
    return permissionInspection(
      "conflicting",
      ["context_servers.cadre does not target the managed Cadre MCP runtime."],
      ["Resolve the Cadre context-server conflict before rerunning cadre-ai install --target zed."]
    );
  }
  if (isRecord(currentServer) && currentServer.enabled === false) {
    return permissionInspection(
      "conflicting",
      ["The managed Cadre Zed context server is disabled."],
      ["Enable or resolve the Cadre context-server configuration before rerunning cadre-ai install --target zed."]
    );
  }
  const blockingPermission = ZED_MCP_PERMISSION_KEYS.find((key) => {
    const rule = tools[key];
    return isRecord(rule) && (hasBlockingZedRule(rule, "always_deny") || hasBlockingZedRule(rule, "always_confirm"));
  });
  if (blockingPermission) {
    return permissionInspection(
      "conflicting",
      ["A Zed Cadre tool has a higher-precedence deny or confirm rule."],
      ["Resolve the conflicting Cadre tool permission before rerunning cadre-ai install --target zed."]
    );
  }
  if (currentServer === undefined) {
    return permissionInspection(
      "unconfigured",
      ["The managed Cadre Zed context server is missing."],
      ["Run cadre-ai install --target zed to configure the managed local integration."]
    );
  }
  if (!zedServerMatches(currentServer, nodePath, mcpPath)) {
    return permissionInspection(
      "unconfigured",
      ["The Cadre Zed context server does not match the expected local runtime command."],
      ["Run cadre-ai install --target zed to refresh the managed local integration."]
    );
  }
  const missingApprovals = ZED_MCP_PERMISSION_KEYS.filter((key) => {
    const rule = tools[key];
    return !isRecord(rule) || rule.default !== "allow";
  });
  if (missingApprovals.length) {
    return permissionInspection(
      "unconfigured",
      [`${missingApprovals.length} exact Cadre Zed tool approval(s) are missing.`],
      ["Run cadre-ai install --target zed to apply the narrow Cadre tool approvals."]
    );
  }
  return permissionInspection(
    "healthy",
    ["The managed Cadre Zed server and every exact Cadre tool approval are configured."],
    []
  );
}
