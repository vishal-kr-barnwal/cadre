import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  CAPABILITY_PROFILE_FIELDS,
  INSTALL_TARGET_ADAPTERS,
  type ClientCapabilityProfile,
  type ClientDiagnostic,
  type ClientDiagnosticState,
  type ClientName
} from "./client-adapters.js";
import { defaultMarketplaceRoot, marketplaceFromHome } from "./cli-options.js";
import { GUIDE_ONLY_POINTER, type GuideOnlyPointer } from "./guide.js";
import { commandExists, runJson } from "./native-clients.js";
import {
  inspectClaudeMcpApproval,
  inspectCodexMcpApproval,
  inspectZedCadreConfiguration,
  type PermissionInspection
} from "./permission-inspection.js";
import { CADRE_WORKFLOWS, zedAdapterRoot, zedSettingsPath, zedSkillsRoot } from "./zed.js";
import { TEMPLATE_IDS, assertCompleteTemplatePayloads, templateCatalog } from "../src/domain/templates.js";
import { CADRE_RUNTIME_VERSION } from "../src/domain/version.js";

const pluginId = "cadre@cadre";
const requiredAssets = [
  "dist/cadre-cli.mjs",
  "dist/cadre-mcp.mjs",
  ".codex-plugin/plugin.json",
  ".claude-plugin/plugin.json",
  "skills",
  "templates"
] as const;

const clientLabels: Record<ClientName, string> = {
  codex: "Codex",
  claude: "Claude",
  zed: "Zed"
};

const statePriority: Record<ClientDiagnosticState, number> = {
  healthy: 0,
  unconfigured: 1,
  uninstalled: 2,
  unavailable: 3,
  malformed: 4,
  conflicting: 5
};

interface DiagnosticCheck {
  state: ClientDiagnosticState;
  evidence: readonly string[];
  remediation: readonly string[];
}

interface FileRead {
  content: string | null;
  error: string | null;
}

export interface DoctorPackageHealth {
  identity: string;
  root: string;
  state: "healthy" | "corrupt";
  missingAssets: readonly string[];
  templates: { found: number; required: number } | null;
  error: string | null;
}

export interface DoctorReport {
  package: DoctorPackageHealth;
  clients: readonly ClientDiagnostic[];
  /** Other agents receive only the read-only guide; it never implies stateful support. */
  guideOnly: GuideOnlyPointer;
}

type RegisteredAdapter = typeof INSTALL_TARGET_ADAPTERS[number];

export interface DoctorOptions {
  json: boolean;
  marketplaceRoot: string;
}

function doctorOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseDoctorOptions(args: readonly string[]): DoctorOptions {
  const options: DoctorOptions = { json: false, marketplaceRoot: defaultMarketplaceRoot() };
  let rootOption: "--home" | "--marketplace-root" | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") {
      if (options.json) throw new Error("--json may be provided only once");
      options.json = true;
      continue;
    }
    if (arg === "--home" || arg === "--marketplace-root") {
      if (rootOption) throw new Error("doctor accepts only one of --home or --marketplace-root");
      const value = doctorOptionValue(args, index, arg);
      options.marketplaceRoot = arg === "--home" ? marketplaceFromHome(value) : resolve(value);
      rootOption = arg;
      index += 1;
      continue;
    }
    throw new Error(`Unknown doctor option: ${arg}`);
  }
  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(
  state: ClientDiagnosticState,
  evidence: readonly string[],
  remediation: readonly string[]
): DiagnosticCheck {
  return { state, evidence, remediation };
}

function readOptionalFile(path: string): FileRead {
  try {
    if (!existsSync(path)) return { content: null, error: null };
    return { content: readFileSync(path, "utf8"), error: null };
  } catch {
    return { content: null, error: "could not be read" };
  }
}

function configurationCheck(path: string, inspection: PermissionInspection): DiagnosticCheck {
  return diagnostic(
    inspection.state,
    inspection.evidence.map((item) => `${path}: ${item}`),
    inspection.remediation
  );
}

function unavailableConfiguration(path: string): DiagnosticCheck {
  return diagnostic(
    "unavailable",
    [`${path}: Cadre configuration could not be read.`],
    ["Review the local configuration file permissions, then rerun cadre-ai doctor."]
  );
}

function codexNativeListing(listing: unknown): DiagnosticCheck {
  if (!isRecord(listing) || !Array.isArray(listing.installed)) {
    return diagnostic(
      "unavailable",
      ["Codex returned a plugin listing with an unexpected shape."],
      ["Run Codex's plugin listing directly, then rerun cadre-ai doctor."]
    );
  }
  const entry = listing.installed.find((candidate) => (
    isRecord(candidate) && candidate.pluginId === pluginId
  ));
  if (!isRecord(entry) || entry.installed !== true) {
    return diagnostic(
      "uninstalled",
      [`${pluginId} is not installed in Codex.`],
      ["Run cadre-ai install --target codex to register the existing Codex adapter."]
    );
  }
  if (entry.enabled !== true) {
    return diagnostic(
      "unconfigured",
      [`${pluginId} is installed in Codex but is not enabled.`],
      ["Enable the Cadre plugin in Codex, then rerun cadre-ai doctor."]
    );
  }
  return diagnostic("healthy", [`${pluginId} is installed and enabled in Codex.`], []);
}

function claudeNativeListing(listing: unknown): DiagnosticCheck {
  if (!Array.isArray(listing)) {
    return diagnostic(
      "unavailable",
      ["Claude returned a plugin listing with an unexpected shape."],
      ["Run Claude's plugin listing directly, then rerun cadre-ai doctor."]
    );
  }
  const entry = listing.find((candidate) => (
    isRecord(candidate) && candidate.id === pluginId && candidate.scope === "user"
  ));
  if (!isRecord(entry)) {
    return diagnostic(
      "uninstalled",
      [`${pluginId} is not installed at user scope in Claude.`],
      ["Run cadre-ai install --target claude to register the existing Claude adapter."]
    );
  }
  if (entry.enabled !== true) {
    return diagnostic(
      "unconfigured",
      [`${pluginId} is installed at user scope in Claude but is not enabled.`],
      ["Enable the Cadre plugin in Claude, then rerun cadre-ai doctor."]
    );
  }
  return diagnostic("healthy", [`${pluginId} is installed and enabled at user scope in Claude.`], []);
}

function nativePluginCheck(adapter: RegisteredAdapter): DiagnosticCheck {
  if (adapter.diagnostic.kind !== "native-plugin-list") {
    return diagnostic("unavailable", ["This adapter has no native plugin probe."], []);
  }
  if (!commandExists(adapter.id)) {
    return diagnostic(
      "uninstalled",
      [`${clientLabels[adapter.id]} is not available on PATH.`],
      [`Install or expose ${clientLabels[adapter.id]} on PATH, then run its Cadre installation command.`]
    );
  }
  try {
    const listing = runJson<unknown>(adapter.id, adapter.diagnostic.listArguments);
    return adapter.id === "codex" ? codexNativeListing(listing) : claudeNativeListing(listing);
  } catch {
    return diagnostic(
      "unavailable",
      [`${clientLabels[adapter.id]} could not provide its fixed Cadre plugin listing.`],
      [`Run ${clientLabels[adapter.id]}'s plugin listing directly, then rerun cadre-ai doctor.`]
    );
  }
}

function zedSkillLinks(marketplaceRoot: string): DiagnosticCheck {
  const missing: string[] = [];
  const conflicting: string[] = [];
  const broken: string[] = [];

  for (const workflow of CADRE_WORKFLOWS) {
    const destination = join(zedSkillsRoot(), `cadre-${workflow}`);
    const expected = join(zedAdapterRoot(marketplaceRoot), `cadre-${workflow}`);
    try {
      const entry = lstatSync(destination);
      if (!entry.isSymbolicLink()) {
        conflicting.push(workflow);
        continue;
      }
      const target = resolve(dirname(destination), readlinkSync(destination));
      if (target !== expected) {
        conflicting.push(workflow);
        continue;
      }
      if (!existsSync(expected)) broken.push(workflow);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") missing.push(workflow);
      else {
        return diagnostic(
          "unavailable",
          ["Zed workflow skill links could not be inspected."],
          ["Review the local Zed skill directory permissions, then rerun cadre-ai doctor."]
        );
      }
    }
  }

  if (conflicting.length) {
    return diagnostic(
      "conflicting",
      [`${conflicting.length} Zed workflow skill link(s) are not Cadre-owned.`],
      ["Review those local skill paths before rerunning cadre-ai install --target zed."]
    );
  }
  if (broken.length) {
    return diagnostic(
      "unconfigured",
      [`${broken.length} Cadre-owned Zed workflow skill link(s) point to missing local adapters.`],
      ["Rerun cadre-ai install --target zed to restore the managed local adapter payload."]
    );
  }
  if (missing.length) {
    const state: ClientDiagnosticState = missing.length === CADRE_WORKFLOWS.length ? "uninstalled" : "unconfigured";
    return diagnostic(
      state,
      [`${CADRE_WORKFLOWS.length - missing.length}/${CADRE_WORKFLOWS.length} Cadre Zed workflow skill links are present.`],
      ["Run cadre-ai install --target zed to create the managed Zed skill links."]
    );
  }
  return diagnostic(
    "healthy",
    [`${CADRE_WORKFLOWS.length}/${CADRE_WORKFLOWS.length} Cadre Zed workflow skill links point to the local marketplace.`],
    []
  );
}

function zedRuntime(mcpPath: string): DiagnosticCheck {
  if (existsSync(mcpPath)) {
    return diagnostic("healthy", ["The managed Zed MCP runtime is present in the local marketplace."], []);
  }
  return diagnostic(
    "unconfigured",
    ["The managed Zed MCP runtime is missing from the expected local marketplace."],
    ["Run cadre-ai install --target zed to prepare the local Zed payload."]
  );
}

function aggregate(adapter: RegisteredAdapter, checks: readonly DiagnosticCheck[]): ClientDiagnostic {
  const state = checks.reduce<ClientDiagnosticState>((current, next) => (
    statePriority[next.state] > statePriority[current] ? next.state : current
  ), "healthy");
  return {
    id: adapter.id,
    tier: adapter.tier,
    capabilities: { ...adapter.capabilities },
    state,
    evidence: [...new Set(checks.flatMap((check) => check.evidence))],
    remediation: [...new Set(checks.flatMap((check) => check.remediation))]
  };
}

function inspectCodex(adapter: RegisteredAdapter): ClientDiagnostic {
  const configPath = join(process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), ".codex"), "config.toml");
  const file = readOptionalFile(configPath);
  const configuration = file.error
    ? unavailableConfiguration(configPath)
    : configurationCheck(configPath, inspectCodexMcpApproval(file.content));
  return aggregate(adapter, [nativePluginCheck(adapter), configuration]);
}

function inspectClaude(adapter: RegisteredAdapter): ClientDiagnostic {
  const root = process.env.CLAUDE_HOME ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const configPath = join(resolve(root), "settings.json");
  const file = readOptionalFile(configPath);
  const configuration = file.error
    ? unavailableConfiguration(configPath)
    : configurationCheck(configPath, inspectClaudeMcpApproval(file.content));
  return aggregate(adapter, [nativePluginCheck(adapter), configuration]);
}

function inspectZed(adapter: RegisteredAdapter, marketplaceRoot: string): ClientDiagnostic {
  const mcpPath = join(marketplaceRoot, "plugins", "cadre", "dist", "cadre-mcp.mjs");
  const settingsPath = zedSettingsPath();
  const file = readOptionalFile(settingsPath);
  const configuration = file.error
    ? unavailableConfiguration(settingsPath)
    : configurationCheck(
      settingsPath,
      inspectZedCadreConfiguration(file.content, resolve(process.execPath), mcpPath)
    );
  return aggregate(adapter, [configuration, zedSkillLinks(marketplaceRoot), zedRuntime(mcpPath)]);
}

export function collectClientDiagnostics(marketplaceRoot = defaultMarketplaceRoot()): ClientDiagnostic[] {
  return INSTALL_TARGET_ADAPTERS.map((adapter) => {
    try {
      if (adapter.id === "codex") return inspectCodex(adapter);
      if (adapter.id === "claude") return inspectClaude(adapter);
      return inspectZed(adapter, marketplaceRoot);
    } catch {
      return {
        id: adapter.id,
        tier: adapter.tier,
        capabilities: { ...adapter.capabilities },
        state: "unavailable",
        evidence: ["Local Cadre setup evidence could not be inspected."],
        remediation: ["Review the local client configuration, then rerun cadre-ai doctor."]
      };
    }
  });
}

export function inspectPackageHealth(root: string): DoctorPackageHealth {
  let identity = `cadre-ai@${CADRE_RUNTIME_VERSION}`;
  const packageJson = join(root, "package.json");
  if (existsSync(packageJson)) {
    try {
      const metadata = JSON.parse(readFileSync(packageJson, "utf8")) as unknown;
      if (isRecord(metadata)) {
        const name = typeof metadata.name === "string" ? metadata.name : "cadre-ai";
        const version = typeof metadata.version === "string" ? metadata.version : CADRE_RUNTIME_VERSION;
        identity = `${name}@${version}`;
      }
    } catch (error) {
      return {
        identity,
        root,
        state: "corrupt",
        missingAssets: [],
        templates: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const missingAssets = requiredAssets.filter((entry) => !existsSync(join(root, entry)));
  if (missingAssets.length) {
    return {
      identity,
      root,
      state: "corrupt",
      missingAssets,
      templates: null,
      error: `Missing packaged runtime assets: ${missingAssets.join(", ")}`
    };
  }

  try {
    assertCompleteTemplatePayloads(join(root, "templates"));
    const templates = templateCatalog();
    return {
      identity,
      root,
      state: "healthy",
      missingAssets: [],
      templates: { found: templates.length, required: TEMPLATE_IDS.length },
      error: null
    };
  } catch (error) {
    return {
      identity,
      root,
      state: "corrupt",
      missingAssets: [],
      templates: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function doctorReport(root: string, marketplaceRoot = defaultMarketplaceRoot()): DoctorReport {
  const packageHealth = inspectPackageHealth(root);
  return {
    package: packageHealth,
    clients: packageHealth.state === "healthy" ? collectClientDiagnostics(marketplaceRoot) : [],
    guideOnly: { ...GUIDE_ONLY_POINTER }
  };
}

function profileSummary(profile: ClientCapabilityProfile): string {
  return CAPABILITY_PROFILE_FIELDS.map((field) => `${field}=${profile[field]}`).join(" ");
}

function writeHumanReport(report: DoctorReport): void {
  process.stdout.write(`${report.package.identity}\npackage root: ${report.package.root}\n`);
  if (report.package.state === "corrupt") {
    process.stderr.write(`${report.package.error ?? "Cadre package health is corrupt."}\n`);
    return;
  }

  const templates = report.package.templates!;
  process.stdout.write(`template catalog: ${templates.found}/${templates.required} required templates\n`);
  process.stdout.write("self-contained runtime: ok\n");
  process.stdout.write("capability report:\n");
  for (const client of report.clients) {
    process.stdout.write(`  ${client.id} [${client.tier}]: ${client.state}\n`);
    process.stdout.write(`    profile: ${profileSummary(client.capabilities)}\n`);
    for (const evidence of client.evidence) process.stdout.write(`    evidence: ${evidence}\n`);
    for (const remediation of client.remediation) process.stdout.write(`    remediation: ${remediation}\n`);
  }
  process.stdout.write(
    `guide-only for other agents: ${report.guideOnly.command} (read-only, no stateful Cadre support)\n`
  );
}

export function runDoctor(args: readonly string[], root: string): number {
  const options = parseDoctorOptions(args);
  const report = doctorReport(root, options.marketplaceRoot);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else writeHumanReport(report);
  return report.package.state === "healthy" ? 0 : 1;
}
