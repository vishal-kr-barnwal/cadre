import { asJsonObject, asOptionalString, asStringArray } from "../../guards";
import type { JsonObject } from "../../types";
import type { RuntimeEnvelope } from "../domain/protocol-types";
import type { ProjectSourceReaderPort } from "../domain/resource-types";

const SOURCE_RESOURCE = "cadre://project-skill-source";

function sourcePath(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (`${parsed.protocol}//${parsed.host}` !== SOURCE_RESOURCE || parsed.hash) return null;
    return parsed.searchParams.get("path");
  } catch {
    return null;
  }
}

function authorizeUri(
  reader: ProjectSourceReaderPort,
  root: string,
  uri: string,
): { uri: string | null; warning: string | null } {
  if (!uri.startsWith(SOURCE_RESOURCE)) return { uri, warning: null };
  const relativePath = sourcePath(uri);
  if (!relativePath) {
    return { uri: null, warning: "Cadre omitted an invalid project-skill source resource." };
  }
  const capability = reader.issue(root, relativePath);
  if (!capability.ok) {
    return { uri: null, warning: `Cadre could not authorize project-skill source '${relativePath}': ${capability.error}` };
  }
  const parsed = new URL(uri);
  parsed.searchParams.set("root", root);
  parsed.searchParams.set("token", capability.token);
  return { uri: parsed.toString(), warning: null };
}

export function authorizeProjectSourceResources(
  reader: ProjectSourceReaderPort,
  root: string,
  packet: RuntimeEnvelope,
): RuntimeEnvelope {
  const resources = asStringArray(packet.resources);
  const authorizedByUri = new Map<string, string | null>();
  const addedWarnings: string[] = [];
  const authorize = (uri: string): string | null => {
    if (authorizedByUri.has(uri)) return authorizedByUri.get(uri) || null;
    const result = authorizeUri(reader, root, uri);
    authorizedByUri.set(uri, result.uri);
    if (result.warning) addedWarnings.push(result.warning);
    return result.uri;
  };
  const authorizedResources = resources.map(authorize).filter((uri): uri is string => uri !== null);

  let next = packet.next || null;
  if (next) {
    const nextPacket = asJsonObject(next);
    const nextArguments = asJsonObject(nextPacket.arguments);
    const nextUri = asOptionalString(nextArguments.uri);
    if (nextPacket.tool === "cadre_read" && nextUri?.startsWith(SOURCE_RESOURCE)) {
      const authorizedUri = authorize(nextUri);
      next = authorizedUri
        ? { ...nextPacket, arguments: { ...nextArguments, uri: authorizedUri } as JsonObject }
        : null;
    }
  }

  return {
    ...packet,
    resources: authorizedResources,
    next,
    warnings: [...asStringArray(packet.warnings), ...addedWarnings],
  };
}
