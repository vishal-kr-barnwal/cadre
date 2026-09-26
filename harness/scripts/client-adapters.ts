export const CAPABILITY_TIERS = ["full", "managed", "guide-only", "unverified"] as const;
export type CapabilityTier = typeof CAPABILITY_TIERS[number];

export type ClientDiagnosticState =
  | "healthy"
  | "uninstalled"
  | "unconfigured"
  | "malformed"
  | "conflicting"
  | "unavailable";

export type ClientDiagnosticProbe =
  | {
    readonly kind: "native-plugin-list";
    readonly listArguments: readonly ["plugin", "list", "--json"];
  }
  | { readonly kind: "local-configuration" };

export interface ClientAdapter {
  readonly id: string;
  readonly tier: CapabilityTier;
  readonly installTarget: boolean;
  readonly diagnostic: ClientDiagnosticProbe;
}

/**
 * This is the complete current registration set. Tiers remain broader than the
 * set so guide-only and unverified adapters can be modeled without making them
 * selectable installation targets.
 */
export const CLIENT_ADAPTERS = [
  {
    id: "codex",
    tier: "full",
    installTarget: true,
    diagnostic: { kind: "native-plugin-list", listArguments: ["plugin", "list", "--json"] }
  },
  {
    id: "claude",
    tier: "full",
    installTarget: true,
    diagnostic: { kind: "native-plugin-list", listArguments: ["plugin", "list", "--json"] }
  },
  {
    id: "zed",
    tier: "managed",
    installTarget: true,
    diagnostic: { kind: "local-configuration" }
  }
] as const satisfies readonly ClientAdapter[];

export type RegisteredClientAdapter = typeof CLIENT_ADAPTERS[number];
export type InstallTargetAdapter = Extract<RegisteredClientAdapter, { readonly installTarget: true }>;
export type ClientName = InstallTargetAdapter["id"];

function isInstallTarget(adapter: RegisteredClientAdapter): adapter is InstallTargetAdapter {
  return adapter.installTarget;
}

/** Only registered install targets participate in install, uninstall, and auto-detection. */
export const INSTALL_TARGET_ADAPTERS: readonly InstallTargetAdapter[] = CLIENT_ADAPTERS.filter(isInstallTarget);
export const CLIENTS: readonly ClientName[] = INSTALL_TARGET_ADAPTERS.map((adapter) => adapter.id);

export interface ClientDiagnostic {
  readonly id: ClientName;
  readonly tier: CapabilityTier;
  readonly state: ClientDiagnosticState;
  readonly evidence: readonly string[];
  readonly remediation: readonly string[];
}
