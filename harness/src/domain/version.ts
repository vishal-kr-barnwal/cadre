export const CADRE_RUNTIME_VERSION = "4.0.0";
export const COMPATIBLE_RUNTIME_VERSIONS = ["3.9.0", "3.9.1", "3.9.2"] as const;

/** These releases share the receipt-based project contract; labels need no rewrite. */
export function isCompatibleRuntimeVersion(version: unknown): boolean {
  return typeof version === "string" && (version === CADRE_RUNTIME_VERSION
    || (COMPATIBLE_RUNTIME_VERSIONS as readonly string[]).includes(version));
}
export const TEMPLATE_SET_VERSION = "v6";
export const COMPATIBLE_TEMPLATE_SET_VERSIONS = ["v5", TEMPLATE_SET_VERSION] as const;
export function isCompatibleTemplateSet(version: unknown): boolean {
  return typeof version === "string" && (COMPATIBLE_TEMPLATE_SET_VERSIONS as readonly string[]).includes(version);
}
// Recognized only for read-only diagnostics and historical evidence.
export const LEGACY_RUNTIME_VERSIONS = ["3.8.0", "3.7.1", "3.7.0", "3.6.0", "3.5.1", "3.5.0", "3.4.0", "3.3.0"] as const;
export const LEGACY_TEMPLATE_SET_VERSIONS = ["v1", "v2", "v3", "v4"] as const;
