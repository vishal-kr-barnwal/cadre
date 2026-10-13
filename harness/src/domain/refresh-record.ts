import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PromotionFile } from "./promotion-evidence.js";

/** Every new refresh owns a fresh durable record; recovery uses its original before-hash. */
export function requireRefreshRecord(root: string, files: PromotionFile[]): string {
  const records = files.filter((file) => /^\.cadre\/refreshes\/[a-z0-9-]+\.md$/.test(file.path)).sort((a, b) => a.path.localeCompare(b.path));
  if (!records.length || records.some((record) => !record.content?.trim())) throw new Error("Refresh requires a nonempty fresh refresh record");
  for (const record of records) {
    if (record.before === undefined ? existsSync(join(root, record.path)) : record.before !== null) {
      throw new Error("Preserve existing refresh records; use a fresh refresh record for the new approval");
    }
  }
  const project = files.find((file) => file.path === ".cadre/project.json");
  const preferred = project?.content ? (JSON.parse(project.content) as {lastRefresh?: {refreshPath?: string}}).lastRefresh?.refreshPath : undefined;
  return records.find((record) => record.path === `.cadre/${preferred}`)?.path.slice(".cadre/".length)
    ?? records[0]!.path.slice(".cadre/".length);
}
