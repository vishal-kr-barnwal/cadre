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

/**
 * Static facts about how Cadre integrates with one host. Each value mirrors a
 * packaged source of truth; it is not evidence about a running session.
 */
export interface ClientCapabilityProfile {
  /** Release maturity of the integration. */
  readonly status: "stable" | "beta";
  /** How the host discovers the ten workflow skills. */
  readonly skills: "native-plugin" | "global-skill-links";
  /** The host's workflow command form. */
  readonly invocation: "$cadre:<workflow>" | "/cadre:<workflow>" | "/cadre-<workflow>";
  /** How the host launches the packaged stdio MCP runtime. */
  readonly mcpLaunch: "plugin-manifest-stdio" | "settings-context-server-stdio";
  /** Tool result representation selected by clientResultFormat in src/mcp/results.ts. */
  readonly results: "structured" | "structured-from-2.0.21" | "text";
  /** The template_get_many contentMode requested by the host's skills. */
  readonly templateContentMode: "embedded_resource" | "text";
  /** How workflow_elicit decisions reach the human. */
  readonly decisions: "form-elicitation-with-chat-fallback" | "chat-fallback";
  /** Delegated worker support; direct execution in the main agent is always available. */
  readonly workers: "host-subagents" | "packaged-worker-agents" | "host-dependent";
  /** The narrow Cadre MCP approval applied by the default installer. */
  readonly approvals: "plugin-default-tool-approval" | "server-enable-and-tool-allowlist" | "exact-tool-allow-entries";
}

/** Stable field order for rendering a capability profile. */
export const CAPABILITY_PROFILE_FIELDS = [
  "status", "skills", "invocation", "mcpLaunch", "results",
  "templateContentMode", "decisions", "workers", "approvals"
] as const satisfies readonly (keyof ClientCapabilityProfile)[];

export interface ClientAdapter {
  readonly id: string;
  readonly tier: CapabilityTier;
  readonly installTarget: boolean;
  readonly diagnostic: ClientDiagnosticProbe;
  readonly capabilities: ClientCapabilityProfile;
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
    diagnostic: { kind: "native-plugin-list", listArguments: ["plugin", "list", "--json"] },
    capabilities: {
      status: "stable",
      skills: "native-plugin",
      invocation: "$cadre:<workflow>",
      mcpLaunch: "plugin-manifest-stdio",
      results: "structured",
      templateContentMode: "embedded_resource",
      decisions: "form-elicitation-with-chat-fallback",
      workers: "host-subagents",
      approvals: "plugin-default-tool-approval"
    }
  },
  {
    id: "claude",
    tier: "full",
    installTarget: true,
    diagnostic: { kind: "native-plugin-list", listArguments: ["plugin", "list", "--json"] },
    capabilities: {
      status: "stable",
      skills: "native-plugin",
      invocation: "/cadre:<workflow>",
      mcpLaunch: "plugin-manifest-stdio",
      results: "structured-from-2.0.21",
      templateContentMode: "embedded_resource",
      decisions: "form-elicitation-with-chat-fallback",
      workers: "packaged-worker-agents",
      approvals: "server-enable-and-tool-allowlist"
    }
  },
  {
    id: "zed",
    tier: "managed",
    installTarget: true,
    diagnostic: { kind: "local-configuration" },
    capabilities: {
      status: "beta",
      skills: "global-skill-links",
      invocation: "/cadre-<workflow>",
      mcpLaunch: "settings-context-server-stdio",
      results: "text",
      templateContentMode: "text",
      decisions: "chat-fallback",
      // Zed receives no worker definitions, so delegation depends on the host.
      workers: "host-dependent",
      approvals: "exact-tool-allow-entries"
    }
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
  readonly capabilities: ClientCapabilityProfile;
  readonly state: ClientDiagnosticState;
  readonly evidence: readonly string[];
  readonly remediation: readonly string[];
}
