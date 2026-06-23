import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ApprovalTarget = "codex" | "claude";

export interface ApprovalResult {
  ok: boolean;
  target: ApprovalTarget;
  path: string;
  changed: boolean;
  configured: boolean;
  rules: string[];
  error?: string;
}

export const CADRE_MCP_TOOLS = [
  "cadre_resource",
  "cadre_workflow",
  "cadre_project",
  "cadre_status",
  "cadre_track",
  "cadre_parallel",
  "cadre_mutate",
  "cadre_complete_task",
  "cadre_job",
  "cadre_review",
  "cadre_intel",
  "cadre_artifact",
] as const;

const CLAUDE_CADRE_ALLOW_RULES = [
  "mcp__plugin_cadre_cadre__*",
  "mcp__cadre__*",
];

export function approvalConfigPath(target: ApprovalTarget): string {
  if (target === "codex") {
    return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");
  }
  return path.join(process.env.CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
}

export function bootstrapClientApprovals(target: ApprovalTarget): ApprovalResult {
  return target === "codex" ? bootstrapCodexApprovals() : bootstrapClaudeApprovals();
}

export function checkClientApprovals(target: ApprovalTarget): ApprovalResult {
  return target === "codex" ? checkCodexApprovals() : checkClaudeApprovals();
}

export function approvalSummary(target: ApprovalTarget): string {
  const file = approvalConfigPath(target);
  if (target === "codex") return `Cadre codex MCP tool approvals: ${file}`;
  return `Cadre claude MCP tool approvals: ${file}`;
}

function codexToolSection(tool: string): string {
  return `[plugins."cadre@cadre".mcp_servers.cadre.tools.${tool}]`;
}

function codexApprovalSnippet(tool: string): string {
  return `${codexToolSection(tool)}\napproval_mode = "approve"\n`;
}

function bootstrapCodexApprovals(): ApprovalResult {
  const file = approvalConfigPath("codex");
  let text = "";
  if (fs.existsSync(file)) text = fs.readFileSync(file, "utf8");
  const before = text;
  for (const tool of CADRE_MCP_TOOLS) text = upsertCodexApproval(text, tool);
  if (text !== before) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return { ok: true, target: "codex", path: file, changed: text !== before, configured: true, rules: [...CADRE_MCP_TOOLS] };
}

function checkCodexApprovals(): ApprovalResult {
  const file = approvalConfigPath("codex");
  if (!fs.existsSync(file)) {
    return { ok: false, target: "codex", path: file, changed: false, configured: false, rules: [...CADRE_MCP_TOOLS], error: `missing ${file}` };
  }
  const text = fs.readFileSync(file, "utf8");
  const missing = CADRE_MCP_TOOLS.filter((tool) => !codexToolApproved(text, tool));
  const result: ApprovalResult = {
    ok: missing.length === 0,
    target: "codex",
    path: file,
    changed: false,
    configured: missing.length === 0,
    rules: missing.length === 0 ? [...CADRE_MCP_TOOLS] : missing,
  };
  if (missing.length > 0) result.error = `missing Codex Cadre tool approvals: ${missing.join(", ")}`;
  return result;
}

function upsertCodexApproval(text: string, tool: string): string {
  let next = text.endsWith("\n") || text.length === 0 ? text : `${text}\n`;
  const header = codexToolSection(tool);
  const lines = next.split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    const spacer = next.trim().length > 0 && !next.endsWith("\n\n") ? "\n" : "";
    return `${next}${spacer}${codexApprovalSnippet(tool)}`;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.trim().startsWith("[")) {
      end = index;
      break;
    }
  }
  for (let index = start + 1; index < end; index += 1) {
    if (/^\s*approval_mode\s*=/.test(lines[index] || "")) {
      lines[index] = 'approval_mode = "approve"';
      return lines.join("\n");
    }
  }
  lines.splice(start + 1, 0, 'approval_mode = "approve"');
  return lines.join("\n");
}

function codexToolApproved(text: string, tool: string): boolean {
  const lines = text.split(/\r?\n/);
  const header = codexToolSection(tool);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() || "";
    if (line.startsWith("[")) return false;
    if (line === 'approval_mode = "approve"' || line === "approval_mode = 'approve'") return true;
  }
  return false;
}

function bootstrapClaudeApprovals(): ApprovalResult {
  const file = approvalConfigPath("claude");
  const parsed = readClaudeSettings(file);
  if (!parsed.ok) return parsed.result;
  const settings = parsed.settings;
  const permissions = isRecord(settings.permissions) ? settings.permissions : {};
  const currentAllow = Array.isArray(permissions.allow)
    ? permissions.allow.filter((item): item is string => typeof item === "string")
    : [];
  const nextAllow = [...currentAllow];
  for (const rule of CLAUDE_CADRE_ALLOW_RULES) {
    if (!nextAllow.includes(rule)) nextAllow.push(rule);
  }
  const changed = nextAllow.length !== currentAllow.length || !isRecord(settings.permissions) || !Array.isArray(permissions.allow);
  if (changed) {
    settings.permissions = { ...permissions, allow: nextAllow };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  return { ok: true, target: "claude", path: file, changed, configured: true, rules: [...CLAUDE_CADRE_ALLOW_RULES] };
}

function checkClaudeApprovals(): ApprovalResult {
  const file = approvalConfigPath("claude");
  const parsed = readClaudeSettings(file);
  if (!parsed.ok) return parsed.result;
  const permissions = isRecord(parsed.settings.permissions) ? parsed.settings.permissions : {};
  const allow = Array.isArray(permissions.allow)
    ? permissions.allow.filter((item): item is string => typeof item === "string")
    : [];
  const missing = CLAUDE_CADRE_ALLOW_RULES.filter((rule) => !allow.includes(rule));
  const result: ApprovalResult = {
    ok: missing.length === 0,
    target: "claude",
    path: file,
    changed: false,
    configured: missing.length === 0,
    rules: missing.length === 0 ? [...CLAUDE_CADRE_ALLOW_RULES] : missing,
  };
  if (missing.length > 0) result.error = `missing Claude Cadre tool allow rules: ${missing.join(", ")}`;
  return result;
}

function readClaudeSettings(file: string): { ok: true; settings: Record<string, unknown> } | { ok: false; result: ApprovalResult } {
  if (!fs.existsSync(file)) return { ok: true, settings: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (isRecord(parsed)) return { ok: true, settings: parsed };
    return {
      ok: false,
      result: { ok: false, target: "claude", path: file, changed: false, configured: false, rules: [...CLAUDE_CADRE_ALLOW_RULES], error: `${file} must contain a JSON object` },
    };
  } catch (error) {
    return {
      ok: false,
      result: {
        ok: false,
        target: "claude",
        path: file,
        changed: false,
        configured: false,
        rules: [...CLAUDE_CADRE_ALLOW_RULES],
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
