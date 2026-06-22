export function compactLines(value: unknown, limit = 1200): string {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, limit);
}
