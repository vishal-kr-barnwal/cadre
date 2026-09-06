import type { CallToolResult, ContentBlock, Implementation } from "@modelcontextprotocol/sdk/types.js";
import { serializeCadreError } from "../domain/errors.js";
import { TEMPLATE_SET_VERSION, type TemplateDescriptor } from "../domain/templates.js";

export type ResultFormat = "structured" | "text";

/** MCP has no structured-result client capability; unknown identities use text. */
export function clientResultFormat(client: Implementation | undefined): ResultFormat {
  if (!client) return "text";
  const name = client.name.toLowerCase();
  if (["codex", "codex_cli_rs", "codex-mcp-client", "codex_desktop"].includes(name)) return "structured";
  // Claude Code began preferring structured results in 2.0.21.
  const version = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(client.version);
  if (name === "claude-code" && version) {
    const [, major, minor, patch] = version.map(Number);
    if (major! > 2 || (major === 2 && (minor! > 0 || patch! >= 21))) return "structured";
  }
  return "text";
}

/** The resolver is scoped to one server and evaluated after initialization. */
export function createResultFormatter(format: () => ResultFormat) {
  function result<T extends object>(value: T, _summary?: string, leadingContent: ContentBlock[] = []): CallToolResult {
    return format() === "structured"
      ? { content: leadingContent, structuredContent: value as Record<string, unknown> }
      : { content: [...leadingContent, { type: "text", text: JSON.stringify(value) }] };
  }

  function failure(error: unknown): CallToolResult {
    // Native Claude ignores structuredContent on isError results. One text
    // representation preserves diagnostics for every client without duplication.
    return { content: [{ type: "text", text: JSON.stringify({ error: serializeCadreError(error) }) }], isError: true };
  }

  function templateResult(templates: TemplateDescriptor[], contentMode: "embedded_resource" | "text"): CallToolResult {
    if (format() === "structured") {
      return result({ templateSetVersion: TEMPLATE_SET_VERSION, templates });
    }
    const leadingContent: ContentBlock[] = contentMode === "text"
      ? templates.map((template) => ({
          type: "text" as const,
          text: [
            `<cadre-template id=${JSON.stringify(template.id)} uri=${JSON.stringify(template.uri)} mimeType=${JSON.stringify(template.mimeType)}>`,
            template.content,
            "</cadre-template>"
          ].join("\n")
        }))
      : templates.map((template) => ({
          type: "resource" as const,
          resource: { uri: template.uri, mimeType: template.mimeType, text: template.content }
        }));
    return result({
      templateSetVersion: TEMPLATE_SET_VERSION,
      templates: templates.map(({ content: _content, ...descriptor }) => descriptor)
    }, undefined, leadingContent);
  }

  return { result, failure, templateResult };
}
