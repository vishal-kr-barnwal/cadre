import type { JsonObject } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";

import { CoreResult } from "./contracts";

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function compactTemplateManifest(value: unknown): JsonObject {
  const manifest = asJsonObject(value);
  const templates = Array.isArray(manifest.templates) ? manifest.templates.map(asJsonObject) : [];
  return {
    ...manifest,
    templates: templates.map((template) => ({
      id: asOptionalString(template.id) || null,
      path: asOptionalString(template.path) || null,
      scope: asOptionalString(template.scope) || null,
      kind: asOptionalString(template.kind) || null,
    })),
    template_count: templates.length,
    content_in_response: false,
    resource_uri: "cadre://template-inventory",
    detail_bytes: jsonByteLength(value),
  };
}

function compactStyleGuides(value: unknown): JsonObject {
  const guides = asJsonObject(value);
  return {
    ok: guides.ok !== false,
    valid: guides.valid !== false,
    source: asOptionalString(guides.source) || null,
    detected: asStringArray(guides.detected),
    requested: asStringArray(guides.requested),
    selected: asStringArray(guides.selected),
    missing: asStringArray(guides.missing),
    warnings: asStringArray(guides.warnings),
    written: asStringArray(guides.written),
    skipped: asStringArray(guides.skipped),
    selected_count: asStringArray(guides.selected).length,
    content_in_response: false,
    detail_bytes: jsonByteLength(value),
    resource_uri: "cadre://styleguide-selection",
  };
}

function compactReviewArtifacts(value: unknown): JsonObject {
  const artifacts = Array.isArray(value) ? value.map(asJsonObject) : [];
  return {
    count: artifacts.length,
    total_bytes: artifacts.reduce((sum, artifact) => sum + Number(artifact.bytes || 0), 0),
    files: artifacts.slice(0, 30).map((artifact) => ({
      path: asOptionalString(artifact.path) || null,
      title: asOptionalString(artifact.title) || null,
      kind: asOptionalString(artifact.kind) || null,
    })),
    truncated: artifacts.length > 30,
    content_in_response: false,
  };
}

function compactReviewBundle(value: unknown): JsonObject | null {
  if (!value || !isRecord(value)) return null;
  const bundle = asJsonObject(value);
  const files = Array.isArray(bundle.files) ? bundle.files.map(asJsonObject) : [];
  return {
    directory: asOptionalString(bundle.directory) || null,
    manifest_path: asOptionalString(bundle.manifest_path) || null,
    content_in_response: false,
    warnings: asStringArray(bundle.warnings),
    file_count: files.length,
    total_bytes: files.reduce((sum, file) => sum + Number(file.bytes || 0), 0),
    files: files.slice(0, 30).map((file) => ({
      path: asOptionalString(file.path) || null,
      review_path: asOptionalString(file.review_path) || null,
      title: asOptionalString(file.title) || null,
      kind: asOptionalString(file.kind) || null,
    })),
    truncated: files.length > 30,
  };
}

function compactProvider(value: unknown): JsonObject | null {
  if (!value || !isRecord(value)) return null;
  const provider = asJsonObject(value);
  return {
    ok: provider.ok !== false,
    provider_mode: asOptionalString(provider.provider_mode) || asOptionalString(provider.provider) || "local",
    available: typeof provider.available === "boolean" ? provider.available : null,
    required_provider_mcp: provider.required_provider_mcp || null,
    required_evidence: provider.required_evidence || null,
    missing_evidence_fields: provider.missing_evidence_fields || null,
    source: asOptionalString(provider.source) || null,
    remote_host: asOptionalString(provider.remote_host) || null,
    detected: isRecord(provider.detected)
      ? {
        source: asOptionalString(asJsonObject(provider.detected).source) || null,
        remote_host: asOptionalString(asJsonObject(provider.detected).remote_host) || null,
        remote_hosts: Array.isArray(asJsonObject(provider.detected).remote_hosts) ? asJsonObject(provider.detected).remote_hosts : [],
        ambiguous: asJsonObject(provider.detected).ambiguous === true,
      }
      : null,
    requires_confirmation: provider.requires_confirmation === true,
    reason: asOptionalString(provider.reason) || null,
  };
}

function compactWorkspaceHealth(value: unknown): JsonObject | null {
  if (!value || !isRecord(value)) return null;
  const health = asJsonObject(value);
  const workspace = asJsonObject(health.workspace);
  const dependencyGraph = asJsonObject(health.dependency_graph);
  const lsp = asJsonObject(health.lsp);
  const integrations = asJsonObject(health.integrations);
  return {
    ok: health.ok !== false,
    response_mode: asOptionalString(health.response_mode) || "compact",
    detail_available: health.detail_available !== false,
    topology: health.topology,
    workspace: {
      repo_count: workspace.repo_count ?? null,
      adapters_count: Array.isArray(workspace.adapters) ? workspace.adapters.length : Number(workspace.adapters_count || 0),
      commands_count: Array.isArray(workspace.commands) ? workspace.commands.length : Number(workspace.commands_count || 0),
    },
    dependency_graph: {
      manifests_count: Array.isArray(dependencyGraph.manifests) ? dependencyGraph.manifests.length : Number(dependencyGraph.manifests_count || 0),
      edges_count: Array.isArray(dependencyGraph.edges) ? dependencyGraph.edges.length : Number(dependencyGraph.edges_count || 0),
    },
    parallel: health.parallel,
    languages: health.languages,
    lsp: {
      coverage: lsp.coverage ?? null,
      configured_count: lsp.configured_count ?? null,
      recommended_count: lsp.recommended_count ?? null,
      missing_count: lsp.missing_count ?? null,
    },
    integrations: isRecord(health.integrations)
      ? {
        summary: integrations.summary || null,
        provider: integrations.provider || null,
      }
      : null,
  };
}

function compactDetailResources(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const keep = ["workspace-diagnostics", "dependency-graph", "mcp-readiness", "repo-map", "integrations", "template-inventory"];
  return value
    .filter((entry) => typeof entry === "string" && keep.some((needle) => entry.includes(needle)))
    .slice(0, 6);
}

function compactLspSetup(value: unknown): JsonObject | null {
  if (!value || !isRecord(value)) return null;
  const setup = asJsonObject(value);
  return {
    ok: setup.ok !== false,
    available: setup.available !== false,
    execute: setup.execute === true,
    dry_run: setup.dry_run !== false,
    written: setup.written === true,
    added: asStringArray(setup.added),
    added_count: Array.isArray(setup.added) ? setup.added.length : Number(setup.added_count || 0),
    missing_from_config_count: Array.isArray(setup.missingFromConfig) ? setup.missingFromConfig.length : Number(setup.missing_from_config_count || 0),
    missing_commands_count: Array.isArray(setup.missingCommands) ? setup.missingCommands.length : Number(setup.missing_commands_count || 0),
    recommended_count: Array.isArray(setup.recommended) ? setup.recommended.length : Number(setup.recommended_count || 0),
  };
}

function compactSetupIntegrations(value: unknown): JsonObject | null {
  if (!value || !isRecord(value)) return null;
  const integrations = asJsonObject(value);
  const optionalMcps = integrations.optional_mcps;
  return {
    summary: integrations.summary || null,
    provider: integrations.provider || null,
    optional_mcp_count: Array.isArray(optionalMcps) ? optionalMcps.length : 0,
  };
}

function compactNativePrompts(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const prompt = asJsonObject(entry);
    const target = asJsonObject(prompt.responseTarget);
    const choices = Array.isArray(prompt.choices) ? prompt.choices.map(asJsonObject) : [];
    return {
      id: asOptionalString(prompt.id) || null,
      title: asOptionalString(prompt.title) || null,
      question: asOptionalString(prompt.question) || null,
      selectionMode: asOptionalString(prompt.selectionMode) || "single",
      allowCustom: prompt.allowCustom === true,
      argument: asOptionalString(target.argument) || null,
      customArgument: asOptionalString(prompt.customArgument) || asOptionalString(target.customArgument) || null,
      choices: choices.map((choice) => ({
        id: asOptionalString(choice.id) || null,
        label: asOptionalString(choice.label) || asOptionalString(choice.id) || null,
        recommended: choice.recommended === true,
      })),
    };
  });
}

function compactSetupResponse(result: CoreResult): CoreResult {
  const styleGuides = compactStyleGuides(result.styleGuides);
  const reviewBundle = compactReviewBundle(result.review_bundle);
  const reviewArtifacts = compactReviewArtifacts(result.review_artifacts);
  const reviewBundleSummary = reviewBundle
    ? {
      directory: reviewBundle.directory,
      manifest_path: reviewBundle.manifest_path,
      content_in_response: false,
      warnings: reviewBundle.warnings,
      file_count: reviewBundle.file_count,
      total_bytes: reviewBundle.total_bytes,
      truncated: reviewBundle.truncated,
    }
    : null;
  const humanReview = isRecord(result.human_review)
    ? {
      required: asJsonObject(result.human_review).required !== false,
      confirmed: asJsonObject(result.human_review).confirmed === true,
      workflow: asOptionalString(asJsonObject(result.human_review).workflow) || null,
      confirm_argument: asOptionalString(asJsonObject(result.human_review).confirm_argument) || "humanConfirmed",
      artifact_count: reviewArtifacts.count,
      review_bundle_path: reviewBundleSummary?.manifest_path || null,
    }
    : null;
  return {
    ok: result.ok,
    root: result.root,
    workflow: result.workflow,
    packet_only: result.packet_only,
    execute: result.execute,
    dry_run: result.dry_run,
    phase_state: result.phase_state,
    stage: result.stage,
    error: result.error,
    response_mode: result.response_mode,
    detail_available: true,
    identity: result.identity,
    generated_at: result.generated_at,
    provider: compactProvider(result.provider),
    required_payload: Array.isArray(result.required_payload) ? result.required_payload : [],
    missing_payload: Array.isArray(result.missing_payload) ? result.missing_payload : undefined,
    sync_mode: result.sync_mode,
    sync_recommendation: result.sync_recommendation,
    topology: result.topology,
    workspace_health: compactWorkspaceHealth(result.workspace_health),
    workspace: result.workspace,
    dependency_graph: result.dependency_graph,
    lsp: result.lsp,
    lsp_setup: compactLspSetup(result.lsp_setup),
    integrations: compactSetupIntegrations(result.integrations),
    styleGuides,
    styleguide_ids: asStringArray(styleGuides.selected),
    templates: compactTemplateManifest(result.templates),
    techStackSummary: isRecord(result.techStackSummary)
      ? {
        ok: asJsonObject(result.techStackSummary).ok !== false,
        path: asJsonObject(result.techStackSummary).path,
        styleGuideIds: asJsonObject(result.techStackSummary).styleGuideIds,
        summary: asJsonObject(result.techStackSummary).summary,
      }
      : result.techStackSummary,
    human_review: humanReview,
    intent_prompts: compactNativePrompts(result.intent_prompts),
    native_prompts: compactNativePrompts(result.native_prompts),
    review_artifacts: reviewArtifacts.files,
    review_bundle: reviewBundleSummary,
    review_bundle_path: reviewBundleSummary?.manifest_path || null,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    next_actions: Array.isArray(result.next_actions) ? result.next_actions : [],
    packet_notes_count: Array.isArray(result.packet_notes) ? result.packet_notes.length : 0,
    detail_resources: compactDetailResources(result.detail_resources),
    resource_uris: Array.isArray(result.resource_uris) ? result.resource_uris : [],
    scaffolded: result.scaffolded,
    written: Array.isArray(result.written) ? result.written : undefined,
    skipped: Array.isArray(result.skipped) ? result.skipped : undefined,
    gitattributes: result.gitattributes,
    ci_setup: result.ci_setup,
    polyrepo_setup: result.polyrepo_setup,
    force: result.force,
    doctor_summary: isRecord(result.doctor)
      ? {
        ok: asJsonObject(result.doctor).ok !== false,
        warnings: Array.isArray(asJsonObject(result.doctor).warnings) ? asJsonObject(result.doctor).warnings : [],
      }
      : null,
    doctor_after_summary: isRecord(result.doctor_after)
      ? {
        ok: asJsonObject(result.doctor_after).ok !== false,
        warnings: Array.isArray(asJsonObject(result.doctor_after).warnings) ? asJsonObject(result.doctor_after).warnings : [],
      }
      : null,
  };
}

function planSummary(value: unknown): JsonObject | null {
  if (!value || !isRecord(value)) return null;
  const plan = asJsonObject(value);
  return {
    ok: plan.ok !== false,
    phases: Array.isArray(plan.phases) ? plan.phases.length : Number(plan.phases || 0),
    tasks: Array.isArray(plan.tasks) ? plan.tasks.length : Number(plan.tasks || 0),
    warnings: Array.isArray(plan.warnings) ? plan.warnings.length : Number(plan.warnings || 0),
    errors: Array.isArray(plan.errors) ? plan.errors.length : Number(plan.errors || 0),
  };
}

function compactTrackContext(value: unknown): JsonObject | null {
  if (!value || !isRecord(value)) return null;
  const context = asJsonObject(value);
  const track = asJsonObject(context.track);
  return {
    ok: context.ok !== false,
    track: {
      track_id: asOptionalString(track.track_id) || asOptionalString(context.track_id) || null,
      status: asOptionalString(track.status) || null,
      owner: asOptionalString(track.owner) || null,
      reviewer: asOptionalString(track.reviewer) || null,
      git_branch: asOptionalString(track.git_branch) || null,
    },
    task_counts: context.task_counts || null,
    topology: context.topology || null,
    plan: planSummary(context.plan),
    resource_uri: context.track_id ? `cadre://track-context?trackId=${encodeURIComponent(String(context.track_id))}` : null,
  };
}

function compactReviewAssist(value: unknown): JsonObject | null {
  if (!value || !isRecord(value)) return null;
  const assist = asJsonObject(value);
  const repoDiffs = Array.isArray(assist.repo_diffs) ? assist.repo_diffs.map(asJsonObject) : [];
  const todos = Array.isArray(assist.todos) ? assist.todos.map(asJsonObject) : [];
  const incomplete = Array.isArray(assist.incomplete_tasks) ? assist.incomplete_tasks.map(asJsonObject) : [];
  const lsp = asJsonObject(assist.lsp);
  const machine = asJsonObject(assist.machine_gate);
  const diff = asJsonObject(assist.diff);
  const diffFiles = Array.isArray(diff.files) ? diff.files : [];
  return {
    ok: assist.ok !== false,
    root: assist.root,
    track_id: assist.track_id,
    base: assist.base,
    head: assist.head,
    diff: isRecord(assist.diff)
      ? {
        repo: diff.repo || ".",
        file_count: diffFiles.length,
        stat: asOptionalString(diff.stat) || "",
      }
      : null,
    repo_diffs: repoDiffs.slice(0, 20).map((entry) => ({
      repo: entry.repo || ".",
      path: entry.path || ".",
      files: Array.isArray(entry.files) ? entry.files.slice(0, 50) : [],
      file_count: Array.isArray(entry.files) ? entry.files.length : 0,
      stat: asOptionalString(entry.stat) || "",
      ok: entry.ok !== false,
    })),
    repo_diffs_count: repoDiffs.length,
    task_counts: assist.task_counts,
    incomplete_tasks: incomplete.slice(0, 20),
    incomplete_tasks_count: incomplete.length,
    coverage: assist.coverage,
    todos: todos.slice(0, 20),
    todos_count: todos.length,
    lsp: assist.lsp
      ? {
        available: lsp.available !== false,
        degraded: lsp.degraded === true || lsp.fallback === "text_scan",
        findings_count: Array.isArray(lsp.findings) ? lsp.findings.length : 0,
        server_count: Array.isArray(lsp.servers) ? lsp.servers.length : 0,
        polyrepo: lsp.polyrepo === true,
      }
      : null,
    machine_gate: assist.machine_gate
      ? {
        ok: machine.ok !== false,
        available: machine.available !== false,
        blocking_count: Number(machine.blocking_count || 0),
        result_count: Array.isArray(machine.results) ? machine.results.length : 0,
      }
      : null,
    suggested_verdict: assist.suggested_verdict,
    blocking_reasons: Array.isArray(assist.blocking_reasons) ? assist.blocking_reasons : [],
    detail_resources: assist.track_id ? [
      `cadre://quality-gate?trackId=${encodeURIComponent(String(assist.track_id))}`,
      `cadre://review-evidence?trackId=${encodeURIComponent(String(assist.track_id))}`,
    ] : [],
  };
}

function compactReviewResponse(result: CoreResult): CoreResult {
  return {
    ok: result.ok,
    root: result.root,
    workflow: result.workflow,
    packet_only: result.packet_only,
    execute: result.execute,
    phase_state: result.phase_state,
    response_mode: result.response_mode,
    detail_available: true,
    identity: result.identity,
    generated_at: result.generated_at,
    track_context: compactTrackContext(result.track_context),
    review_assist: compactReviewAssist(result.review_assist),
    gate: result.gate,
    provider: compactProvider(result.provider),
    required_provider_mcp: result.required_provider_mcp,
    required_evidence: result.required_evidence,
    unsupported_reason: result.unsupported_reason,
    next_actions: Array.isArray(result.next_actions) ? result.next_actions : [],
    resource_uris: Array.isArray(result.resource_uris) ? result.resource_uris : [],
  };
}

export function compactWorkflowResponse(workflow: string, result: CoreResult): CoreResult | null {
  if (workflow === "setup" || workflow === "setup_assist" || workflow === "setup_scaffold") {
    return compactSetupResponse(result);
  }
  if (workflow === "review") return compactReviewResponse(result);
  return null;
}
