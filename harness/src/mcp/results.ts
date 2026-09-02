import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { serializeCadreError } from "../domain/errors.js";
import { TEMPLATE_SET_VERSION, type TemplateDescriptor } from "../domain/templates.js";

function jsonContent(value: object): ContentBlock {
  return { type: "text", text: JSON.stringify(value) };
}

/**
 * Return the same JSON object to machine consumers and to agents that only
 * receive MCP content blocks. The final text block is always the exact compact
 * JSON serialization of structuredContent.
 */
export function result<T extends object>(
  value: T,
  summary = "Cadre operation completed.",
  leadingContent: ContentBlock[] = []
): CallToolResult {
  return {
    content: [
      ...(summary ? [{ type: "text" as const, text: summary }] : []),
      ...leadingContent,
      jsonContent(value)
    ],
    structuredContent: value as Record<string, unknown>
  };
}

export function failure(error: unknown): CallToolResult {
  const serialized = serializeCadreError(error);
  const value = { error: serialized };
  return {
    isError: true,
    content: [
      { type: "text", text: serialized.message },
      jsonContent(value)
    ],
    structuredContent: value
  };
}

export function templateResult(
  templates: TemplateDescriptor[],
  contentMode: "embedded_resource" | "text"
): CallToolResult {
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
        resource: {
          uri: template.uri,
          mimeType: template.mimeType,
          text: template.content
        }
      }));
  const value = {
    templateSetVersion: TEMPLATE_SET_VERSION,
    templates: templates.map(({ content: _content, ...descriptor }) => descriptor)
  };
  return result(value, "", leadingContent);
}
