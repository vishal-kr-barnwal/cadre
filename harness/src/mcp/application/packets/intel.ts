import type { JsonObject, RuntimeArgs } from "../../../types";
import type { RuntimeEnvelope } from "../../domain/protocol-types";
import { envelope } from "../envelope";
import { jobEnvelope, jobTypeForPacket } from "../job-support";
import { warmLspReview } from "../review-support";
import type { RuntimeDependencies } from "../ports";

const SETUP_SAFE_READ_ACTIONS = new Set([
  "repo_map",
  "workspace_diagnostics",
  "dependency_graph",
  "test_impact",
  "lsp_setup",
  "dap_setup",
  "dap_status",
  "mcp_readiness",
]);

function invalidRootError(received: unknown): Error {
  return Object.assign(
    new Error(`This Cadre MCP tool requires { root } pointing at, or inside, a project containing cadre/. Received: ${received || "(missing)"}`),
    { code: -32602 }
  );
}

export async function intelPacket(deps: RuntimeDependencies, args: RuntimeArgs): Promise<RuntimeEnvelope> {
  const action = args.action || "repo_map";
  const rootInfo = deps.rootResolver.rootFromCandidate(args.root || process.cwd());
  const usesCandidateRoot = action.startsWith("lsp_daemon") || SETUP_SAFE_READ_ACTIONS.has(String(action));
  if (!rootInfo && usesCandidateRoot) throw invalidRootError(args.root);
  if (
    rootInfo
    && !rootInfo.has_cadre
    && args.execute === true
    && ["lsp_setup", "dap_setup"].includes(String(action))
  ) {
    throw invalidRootError(args.root);
  }
  const root = usesCandidateRoot
    ? (rootInfo ? rootInfo.root : process.cwd())
    : deps.rootResolver.requireCadreRoot(args);
  if (args.async === true) return jobEnvelope(jobTypeForPacket("cadre_intel", args), root, args, deps);
  if (action === "repo_map") return envelope(deps.core.repoMap(root, args));
  if (action === "lsp_setup") return envelope(deps.core.lspSetup(root, args));
  if (action === "dap_setup") return envelope(deps.core.dapSetup(root, args));
  if (action === "dap_status") return envelope(deps.core.dapStatus(root, args));
  if (action === "dap_snapshot") return envelope(await deps.core.dapSnapshot(root, args));
  if (action === "workspace_diagnostics") return envelope(deps.core.workspaceDiagnostics(root));
  if (action === "test_impact") return envelope(deps.core.testImpact(root, args));
  if (action === "dependency_graph") return envelope(deps.core.dependencyGraph(root));
  if (action === "mcp_readiness") return envelope(deps.core.mcpReadiness(root, args));
  if (action === "lsp_impact") {
    let lspResult: JsonObject | null = null;
    if ((args.base || args.head) && args.includeLsp !== false) {
      lspResult = await warmLspReview(deps, root, args);
    }
    const impactArgs: RuntimeArgs = { ...args };
    if (lspResult) impactArgs.lspResult = lspResult;
    return envelope(deps.core.lspImpact(root, impactArgs));
  }
  if (action === "lsp_review") return envelope(deps.core.lspReview(root, args));
  if (action === "lsp_warm_review") {
    return envelope(await warmLspReview(deps, root, args));
  }
  if (action === "lsp_daemon_status") return envelope(await deps.lspDaemon.request("status", {}, 5000));
  if (action === "lsp_daemon_shutdown") return envelope(await deps.lspDaemon.shutdown());
  return envelope({ ok: false, error: `Unknown cadre_intel action: ${action}` });
}
