export type ProviderMode = "local" | "github" | "gitlab";

export const PROVIDER_MODES = new Set<ProviderMode>(["local", "github", "gitlab"]);

export function isProviderMode(value: unknown): value is ProviderMode {
  return typeof value === "string" && PROVIDER_MODES.has(value as ProviderMode);
}
