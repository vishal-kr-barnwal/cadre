export const CADRE_RUNTIME_VERSION = "3.9.2";
export const COMPATIBLE_RUNTIME_VERSIONS = ["3.9.0", "3.9.1"] as const;

/** Patch upgrades retain the existing project contract without an approved refresh. */
export function isCompatibleRuntimeVersion(version: unknown): boolean {
  return typeof version === "string" && (version === CADRE_RUNTIME_VERSION
    || (COMPATIBLE_RUNTIME_VERSIONS as readonly string[]).includes(version));
}
export const LEGACY_RUNTIME_VERSIONS = ["3.8.0", "3.7.1", "3.7.0", "3.6.0", "3.5.1", "3.5.0", "3.4.0", "3.3.0"] as const;
export const TEMPLATE_SET_VERSION = "v5";
export const LEGACY_TEMPLATE_SET_VERSIONS = ["v1", "v2", "v3", "v4"] as const;
