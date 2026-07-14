import fs from "node:fs";
import path from "node:path";

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function mcpServerPathCandidates(): string[] {
  const candidates: string[] = [];
  let dir = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(path.join(dir, "cadre-server.js"));
    candidates.push(path.join(dir, "mcp", "cadre-server.js"));
    candidates.push(path.join(dir, "scripts", "mcp", "cadre-server.js"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return unique(candidates);
}

export function currentMcpServerPath(): string | null {
  return mcpServerPathCandidates().find(fileExists) || null;
}

export function mcpRuntimeRoot(serverPath: string): string {
  return path.resolve(path.dirname(serverPath), "..", "..");
}
