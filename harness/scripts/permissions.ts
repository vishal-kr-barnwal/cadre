import {
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError
} from "jsonc-parser/lib/esm/main.js";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  readFileSync
} from "node:fs";
import { basename, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";

export interface PermissionUpdate {
  path: string;
  changed: boolean;
  rule: string;
}

const CODEX_SECTION = "[plugins.\"cadre@cadre\".mcp_servers.cadre]";
const CODEX_APPROVAL = "default_tools_approval_mode = \"approve\"";
export const CLAUDE_APPROVAL = "mcp__cadre__*";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atomicWrite(path: string, content: string): void {
  const effectivePath = existsSync(path) && lstatSync(path).isSymbolicLink() ? realpathSync(path) : path;
  const directory = dirname(effectivePath);
  mkdirSync(directory, { recursive: true });
  const temporary = `${directory}/.${basename(effectivePath)}.cadre-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    if (existsSync(effectivePath)) chmodSync(temporary, statSync(effectivePath).mode);
    renameSync(temporary, effectivePath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
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

export function configureCodexMcpApproval(configPath: string): PermissionUpdate {
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  let parsed: unknown;
  try {
    parsed = parseToml(existing);
  } catch (error) {
    throw new Error(`Cannot update invalid Codex config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const currentPolicy = cadreCodexPolicy(parsed);
  if (currentPolicy?.default_tools_approval_mode === "approve") {
    return { path: configPath, changed: false, rule: CODEX_APPROVAL };
  }

  const headerPattern = /^[ \t]*\[plugins\."cadre@cadre"\.mcp_servers\.cadre\][ \t]*(?:#.*)?$/gm;
  const headers = [...existing.matchAll(headerPattern)];
  let proposed: string;
  if (currentPolicy) {
    if (headers.length !== 1) {
      throw new Error(
        `Cadre MCP policy already exists in ${configPath} using an unsupported TOML layout; `
        + `set ${CODEX_APPROVAL} under ${CODEX_SECTION}`
      );
    }
    const header = headers[0]!;
    const sectionStart = header.index! + header[0].length;
    const following = existing.slice(sectionStart);
    const nextSection = following.search(/^[ \t]*\[\[?.+$/m);
    const sectionEnd = nextSection === -1 ? existing.length : sectionStart + nextSection;
    const section = existing.slice(sectionStart, sectionEnd);
    const propertyPattern = /^[ \t]*default_tools_approval_mode[ \t]*=.*$/gm;
    const properties = [...section.matchAll(propertyPattern)];
    if (properties.length > 1) throw new Error(`${configPath}: duplicate Cadre MCP approval settings`);
    if (properties.length === 1) {
      const property = properties[0]!;
      const start = sectionStart + property.index!;
      proposed = `${existing.slice(0, start)}${CODEX_APPROVAL}${existing.slice(start + property[0].length)}`;
    } else {
      proposed = `${existing.slice(0, sectionStart)}\n${CODEX_APPROVAL}${existing.slice(sectionStart)}`;
    }
  } else {
    if (headers.length) throw new Error(`${configPath}: Cadre MCP policy could not be parsed safely`);
    const prefix = existing.trimEnd();
    proposed = [
      prefix,
      prefix ? "" : null,
      "# Added by the Cadre plugin installer: pre-approve only Cadre MCP tools.",
      CODEX_SECTION,
      CODEX_APPROVAL
    ].filter((line): line is string => line !== null).join("\n") + "\n";
  }

  let verified: unknown;
  try {
    verified = parseToml(proposed);
  } catch (error) {
    throw new Error(`Generated Codex config is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (cadreCodexPolicy(verified)?.default_tools_approval_mode !== "approve") {
    throw new Error("Generated Codex config did not contain the Cadre MCP approval policy");
  }
  atomicWrite(configPath, proposed);
  return { path: configPath, changed: true, rule: CODEX_APPROVAL };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function assertStringArray(value: unknown, field: string, settingsPath: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${settingsPath}: permissions.${field} must be an array of strings`);
  }
  return value as string[];
}

function deniesCadre(rule: string): boolean {
  return rule === "mcp__*" || rule === "mcp__cadre" || rule.startsWith("mcp__cadre__");
}

export function configureClaudeMcpApproval(settingsPath: string): PermissionUpdate {
  const existing = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : "{}\n";
  const errors: ParseError[] = [];
  const parsed = parseJsonc(existing, errors, { allowTrailingComma: true }) as unknown;
  if (errors.length) {
    const detail = errors.map((error) => `${printParseErrorCode(error.error)} at ${error.offset}`).join(", ");
    throw new Error(`Cannot update invalid Claude settings ${settingsPath}: ${detail}`);
  }
  if (!isRecord(parsed)) throw new Error(`${settingsPath}: Claude settings root must be an object`);
  const root = isRecord(parsed) ? parsed : {};
  const permissions = isRecord(root.permissions) ? root.permissions : {};
  if (root.permissions !== undefined && !isRecord(root.permissions)) {
    throw new Error(`${settingsPath}: permissions must be an object`);
  }
  const deny = assertStringArray(permissions.deny, "deny", settingsPath);
  const conflict = deny.find(deniesCadre);
  if (conflict) {
    throw new Error(`Claude deny rule ${JSON.stringify(conflict)} blocks Cadre MCP tools; remove it before installation`);
  }
  const allow = assertStringArray(permissions.allow, "allow", settingsPath);
  if (allow.includes(CLAUDE_APPROVAL)) {
    return { path: settingsPath, changed: false, rule: CLAUDE_APPROVAL };
  }
  const proposed = applyEdits(existing, modify(
    existing,
    ["permissions", "allow"],
    [...allow, CLAUDE_APPROVAL],
    { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } }
  ));
  const verificationErrors: ParseError[] = [];
  const verified = parseJsonc(proposed, verificationErrors, { allowTrailingComma: true }) as unknown;
  const verifiedPermissions = isRecord(verified) && isRecord(verified.permissions) ? verified.permissions : {};
  if (verificationErrors.length || !stringArray(verifiedPermissions.allow).includes(CLAUDE_APPROVAL)) {
    throw new Error("Generated Claude settings did not contain the Cadre MCP approval rule");
  }
  atomicWrite(settingsPath, proposed.endsWith("\n") ? proposed : `${proposed}\n`);
  return { path: settingsPath, changed: true, rule: CLAUDE_APPROVAL };
}
