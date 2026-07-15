import fs from "node:fs";
import path from "node:path";
import { asBoolean, asJsonObject, asOptionalString, asStringArray, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { appendJsonl, fileExists, writeJson } from "../../infrastructure/runtime/json-store";
import { configuredProvider } from "../../infrastructure/runtime/project-config";
import { isCadreProjectRoot } from "../../infrastructure/runtime/system";
import { scopedApprovalReviewFiles } from "./approval-stage-cursor";
import { closeApprovalSessionFromArgs, recordApprovalCompletionFromArgs } from "./approval-session-store";
import { renderJsonCodeblock } from "./artifact-actions";
import { beginTrace, commitTrace } from "./commit-trace";
import type { CoreResult } from "./contracts";
import { setupGenerationWarnings } from "./generation-quality";
import { summarizeLspSetupResult } from "./health-summaries";
import { renderMarkdownDoc, withGeneratedMarker } from "./markdown-docs";
import { appendCadreEvent, ensureNativeState } from "./native-state";
import { setupShouldWriteLsp } from "./review-bundles";
import { setupMissingEvidence } from "./setup-evidence";
import { lspSetup, setupCiTemplates, setupGitattributes, setupSubmodulePlan } from "./setup-infrastructure";
import { approvedSetupLspAdded, approvedSetupLspRemoved, hasApprovedSetupLspSnapshot, lspPreviewPayload, machineReviewFile, setupFinalReviewPlan } from "./setup-review-plan";
import { setupStageReviewFiles } from "./setup-review-files";
import { setupStageCollection } from "./setup-stage-lifecycle";
import { renderStyleGuideMarkdown } from "./spec-docs";
import { applyStagedApprovalSessionPayload, setupApprovalStages, stagedApprovalError, stagedApprovalReady, stagedApprovalState, validateApprovedTargetReviewFiles } from "./staged-approval";
import { setupStyleGuides, techStackFromArgs, techStackSummary } from "./tech-stack";
import { markdownPayloadError, normalizeProjectDoc, templateJson, templateManifest, workflowResponseMode, workflowSummary } from "./workflow-response";
import { doctor, workspaceHealth } from "./workspace-health";

export function workflowSetup(root: string, args: RuntimeArgs = {}): CoreResult {
  args = applyStagedApprovalSessionPayload(root, args, "setup");
  const summary = workflowSummary(root, "setup", args);
  const markdownError = markdownPayloadError(args);
  if (markdownError) return { ...summary, ...markdownError };
  const rawArgs = args as UnknownRecord;
  const requestedTopology = asOptionalString(rawArgs.topology)?.toLowerCase();
  const reposPayload = isRecord(rawArgs.repos) ? asJsonObject(rawArgs.repos) : null;
  const polyrepoRequested = Boolean(reposPayload && reposPayload.mode === "polyrepo")
    || requestedTopology === "polyrepo"
    || rawArgs.polyrepo === true;
  const styleGuides = setupStyleGuides(root, args);
  const provider = configuredProvider(root, args);
  const providerMode = asOptionalString(provider.provider_mode);
  const lspRecommendations = lspSetup(root, { ...args, execute: false });
  const lspWriteRequested = setupShouldWriteLsp(args, lspRecommendations);
  const detailMode = workflowResponseMode(args) === "detail";
  const workspaceHealthResult = workspaceHealth(root, { ...args, responseMode: detailMode ? "detail" : "compact" });
  const configOverrides = asJsonObject(rawArgs.config);
  const integrationObject = asJsonObject(rawArgs.integrations);
  const selectedIntegrationIds = Array.isArray(rawArgs.integrations)
    ? asStringArray(rawArgs.integrations)
    : asStringArray(integrationObject.optional_mcps);
  const selectedIntegrations = Object.fromEntries(selectedIntegrationIds.map((id) => [id, { selected: true }]));
  const integrationEntries = Object.fromEntries(Object.entries(integrationObject).filter(([key]) => key !== "optional_mcps"));
  const integrationsPayload = isRecord(rawArgs.integrations) || Array.isArray(rawArgs.integrations)
    ? { ...selectedIntegrations, ...integrationEntries }
    : null;
  const requestedSyncMode = asOptionalString(rawArgs.syncMode || rawArgs.sync_mode || configOverrides.sync_mode);
  const teamSize = Number(rawArgs.teamSize || rawArgs.team_size || 0);
  const syncModeRecommendation = requestedSyncMode || (teamSize >= 2 ? "shared" : "local");
  const stages = setupApprovalStages(polyrepoRequested);
  const promptContext = {
    provider: asJsonObject(provider),
    syncMode: syncModeRecommendation,
    styleGuides: asJsonObject(styleGuides),
    lspSetup: asJsonObject(lspRecommendations),
    integrations: workspaceHealthResult.integrations,
  };
  const plannedCollection = setupStageCollection(root, args, stages, polyrepoRequested, promptContext);
  const technicalReady = plannedCollection.cursor.activeStage === "technical" && plannedCollection.activeReady;
  const previewLspPayload = technicalReady && lspWriteRequested
    ? lspPreviewPayload(root, lspRecommendations, reposPayload)
    : null;
  const technicalMachineFiles = technicalReady && lspWriteRequested && previewLspPayload
    ? [machineReviewFile("cadre/lsp.json", "LSP configuration", "setup:lsp", `${JSON.stringify(previewLspPayload, null, 2)}\n`)]
    : [];
  const currentReviewFiles = plannedCollection.activeReady
    ? setupStageReviewFiles(root, args, styleGuides, polyrepoRequested, plannedCollection.cursor.activeStage, technicalMachineFiles)
    : [];
  const hasFrozenFinalFiles = (plannedCollection.cursor.session?.final_snapshot_files?.length || 0) > 0;
  const finalPlan = plannedCollection.cursor.activeStage === "workflow"
    && plannedCollection.activeReady
    && !hasFrozenFinalFiles
    ? setupFinalReviewPlan({
      root,
      args,
      polyrepoRequested,
      providerMode: providerMode || null,
      providerRemoteHost: asOptionalString(provider.remote_host) || null,
      integrationsPayload,
      syncMode: syncModeRecommendation,
    })
    : null;
  const reviewFiles = scopedApprovalReviewFiles(plannedCollection.cursor, currentReviewFiles, finalPlan?.reviewFiles || []);
  const requestedSession = asOptionalString(rawArgs.approvalSessionId || rawArgs.approval_session_id);
  const approvalStarted = Boolean(plannedCollection.cursor.session || requestedSession || plannedCollection.activeReady);
  const approval = approvalStarted
    ? stagedApprovalState(root, "setup", args, stages, reviewFiles, {
      final_only_files: ["cadre/events.jsonl"],
    }, { allowEmptyActiveStage: true })
    : {
      required: true,
      valid_for_execute: false,
      current_stage: "product",
      approved_stages: [],
      pending_stages: stages.map((stage) => stage.id),
      deferred_for_clarification: true,
      session_id: null,
    };
  const cancelled = asJsonObject(approval).cancelled === true;
  const collection = cancelled
    ? { ...plannedCollection, missingEvidence: [], intentPrompts: [], nativePrompts: [], pending: false }
    : setupStageCollection(root, args, stages, polyrepoRequested, promptContext);
  const { missingEvidence, intentPrompts, nativePrompts } = collection;
  const stageReviewBundle = asJsonObject(approval).current_review_bundle;
  const stageReviewArtifacts = asJsonObject(approval).current_review_artifacts;
  const approvalError = stagedApprovalError(approval);
  const promptCollectionPending = collection.pending && !approvalError;
  const visibleMissingEvidence = approvalError ? [] : missingEvidence;
  const visibleIntentPrompts = approvalError ? [] : intentPrompts;
  const visibleNativePrompts = approvalError ? [] : nativePrompts;
  const qualityWarnings = setupGenerationWarnings(args as JsonObject);
  const warnings = [
    ...asStringArray(styleGuides.warnings),
    ...asStringArray(asJsonObject(stageReviewBundle).warnings),
    ...qualityWarnings,
  ];
  const result: CoreResult = {
    ...summary,
    ok: true,
    phase_state: promptCollectionPending ? "awaiting_clarification" : summary.phase_state,
    ...(promptCollectionPending ? { stage: "intent_clarification" } : {}),
    doctor: doctor(root, { hasCadreProject: isCadreProjectRoot(root) }),
    workspace_health: workspaceHealthResult,
    workspace: workspaceHealthResult.workspace,
    dependency_graph: workspaceHealthResult.dependency_graph,
    lsp: workspaceHealthResult.lsp,
    lsp_setup: detailMode ? lspRecommendations : summarizeLspSetupResult(lspRecommendations),
    integrations: workspaceHealthResult.integrations,
    detail_resources: workspaceHealthResult.detail_resources,
    provider,
    sync_mode: syncModeRecommendation,
    sync_recommendation: teamSize >= 2 && syncModeRecommendation !== "shared"
      ? "Team setup detected; use syncMode/shared sync for 10-20 person coordination."
      : null,
    styleGuides,
    templates: templateManifest(),
    techStackSummary: techStackSummary(root, args),
    ...(visibleIntentPrompts.length > 0 ? { intent_prompts: visibleIntentPrompts } : {}),
    ...(visibleNativePrompts.length > 0 ? { native_prompts: visibleNativePrompts } : {}),
    ...(visibleMissingEvidence.length > 0 ? { missing_payload: visibleMissingEvidence } : {}),
    approval,
    review_artifacts: stageReviewArtifacts || [],
    review_bundle: stageReviewBundle,
    warnings: approvalError ? [...warnings, approvalError] : warnings,
    required_payload: args.execute === true
      ? ["product", "productGuidelines", "techStack", "workflowPolicy"]
        .concat(provider.requires_confirmation === true ? ["providerMode"] : [])
        .concat(polyrepoRequested && !reposPayload ? ["repos"] : [])
      : [],
    next_actions: [
      ...(visibleIntentPrompts.length > 0 || visibleNativePrompts.length > 0
        ? ["Answer returned intent_prompts/native_prompts with the client native selector, then call setup again with structured arguments."]
        : []),
      ...(visibleMissingEvidence.length > 0 && visibleIntentPrompts.length === 0
        ? [`Inspect the repository using the selected setup intent, then call setup again with structured evidence for: ${visibleMissingEvidence.join(", ")}.`]
        : []),
      ...(collection.cursor.activeStage === "technical" && provider.requires_confirmation === true
        ? ["Choose providerMode: local, github, or gitlab before setup writes cadre/config.json."]
        : []),
      ...(!cancelled && !approvalError && !promptCollectionPending && collection.cursor.activeStage
        ? ["Approve setup one stage at a time with approvedStages; after every stage is approved, call setup with execute:true and approvalComplete:true."]
        : []),
    ],
    packet_notes: [
      "cadre-setup is packet-only: agents gather user intent, then pass confirmed structured JSON payloads to this packet.",
      "Setup writes are human-in-loop: mutating setup packets require approvalComplete:true after staged artifact review.",
      "Project mutation must be performed by MCP packets; clients must not recreate Cadre setup writes themselves.",
      "Provider evidence is direct-MCP only: GitHub/GitLab modes require the matching provider MCP, local mode requires none.",
    ],
  };
  if (cancelled) return { ...result, phase_state: "cancelled" };
  if (promptCollectionPending && !approvalError) return result;
  if (args.execute !== true && approvalError) {
    return {
      ...result,
      ok: false,
      phase_state: asJsonObject(approval).approval_recovery_required === true
        ? "recovery_required"
        : "awaiting_staged_approval",
      stage: "staged_approval",
      error: approvalError,
    };
  }
  if (args.execute !== true) return result;

  const cadreDir = path.join(root, "cadre");
  const force = asBoolean(rawArgs.force, false);
  const missingPayload = [
    ...setupMissingEvidence(args),
    ...(provider.requires_confirmation === true || !providerMode ? ["providerMode"] : []),
    ...(polyrepoRequested && !reposPayload ? ["repos"] : []),
  ];
  if (missingPayload.length > 0) {
    return {
      ...result,
      ok: false,
      error: `Missing setup payload: ${missingPayload.join(", ")}`,
      missing_payload: missingPayload,
    };
  }
  if (!stagedApprovalReady(approval)) {
    return {
      ...result,
      ok: false,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      error: approvalError || "Staged approval is required before writing setup artifacts",
    };
  }
  const executionPlan = setupFinalReviewPlan({
    root,
    args,
    polyrepoRequested,
    providerMode: providerMode || null,
    providerRemoteHost: asOptionalString(provider.remote_host) || null,
    integrationsPayload,
    syncMode: syncModeRecommendation,
  });
  const {
    configPayload,
    setupStatePayload,
    trackIndex,
    gitattributesNeeded,
    ciProvider,
    generatedAt,
  } = executionPlan;
  const reviewValidation = validateApprovedTargetReviewFiles(root, args);
  if (reviewValidation.ok === false) {
    return {
      ...result,
      ok: false,
      dry_run: true,
      phase_state: "awaiting_staged_approval",
      stage: "staged_review_drift",
      review_validation: reviewValidation,
      error: asOptionalString(reviewValidation.error) || "Approved review files changed after staged approval",
    };
  }
  const reusedReviewFiles = new Set(asStringArray(reviewValidation.files));
  const traceBefore = beginTrace(root);
  const written: string[] = [];
  const skipped: string[] = [];
  const writeText = (relativePath: string, text: string): void => {
    const reviewPath = `cadre/${relativePath}`;
    if (reusedReviewFiles.has(reviewPath)) {
      written.push(reviewPath);
      return;
    }
    const file = path.join(cadreDir, relativePath);
    if (fileExists(file) && !force) {
      skipped.push(path.relative(root, file));
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    written.push(path.relative(root, file));
  };
  const writeSetupJson = (relativePath: string, value: JsonObject): void => {
    const reviewPath = `cadre/${relativePath}`;
    if (reusedReviewFiles.has(reviewPath)) {
      written.push(reviewPath);
      return;
    }
    const file = path.join(cadreDir, relativePath);
    if (fileExists(file) && !force) {
      skipped.push(path.relative(root, file));
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJson(file, value);
    written.push(path.relative(root, file));
  };
  const writeSetupJsonlEntry = (relativePath: string, value: JsonObject): void => {
    const reviewPath = `cadre/${relativePath}`;
    if (reusedReviewFiles.has(reviewPath)) {
      written.push(reviewPath);
      return;
    }
    const file = path.join(cadreDir, relativePath);
    if (fileExists(file) && !force) {
      skipped.push(path.relative(root, file));
      return;
    }
    appendJsonl(file, value);
    written.push(path.relative(root, file));
  };
  const writeProjectDoc = (relativePath: string, kind: string, value: JsonObject, title: string): void => {
    const jsonPath = relativePath.replace(/\.md$/, ".json");
    writeSetupJson(jsonPath, value);
    writeText(relativePath, withGeneratedMarker(`cadre/${jsonPath}`, `cadre.${kind}.v1`, renderMarkdownDoc(value, title, `cadre/${jsonPath}`)));
  };

  fs.mkdirSync(path.join(cadreDir, "tracks"), { recursive: true });
  fs.mkdirSync(path.join(cadreDir, "archive"), { recursive: true });
  const nativeState = ensureNativeState(root);
  const nativeIgnorePath = asOptionalString(nativeState.ignore_path);
  if (nativeIgnorePath) written.push(nativeIgnorePath);
  writeProjectDoc(
    "product.md",
    "product",
    normalizeProjectDoc("product", rawArgs.product, "product.json", "Product Context", "Project-Specific Product Notes"),
    "Product Context"
  );
  writeProjectDoc(
    "product_guidelines.md",
    "product_guidelines",
    normalizeProjectDoc(
      "product_guidelines",
      rawArgs.productGuidelines || rawArgs.product_guidelines,
      "product_guidelines.json",
      "Product Guidelines",
      "Project-Specific Product Guideline Notes"
    ),
    "Product Guidelines"
  );
  writeSetupJson("tech-stack.json", techStackFromArgs(args) || {});
  writeText(
    "tech-stack.md",
    withGeneratedMarker("cadre/tech-stack.json", "cadre.tech_stack.v1", renderJsonCodeblock("Tech stack", techStackFromArgs(args) || {}), {
      canonicalContent: `${JSON.stringify(techStackFromArgs(args) || {}, null, 2)}\n`,
      projection: "cadre/tech-stack.md",
    })
  );
  writeProjectDoc(
    "workflow.md",
    "workflow",
    normalizeProjectDoc("workflow", rawArgs.workflowPolicy || rawArgs.workflow_policy, "workflow.json", "Project Workflow", "Project-Specific Workflow Notes"),
    "Project Workflow"
  );
  writeSetupJson("tracks.json", trackIndex);
  const patternsSeed = templateJson("patterns_seed.json", { id: "initial", kind: "patterns_seed", text: "# Codebase Patterns\n\nLast refreshed: YYYY-MM-DD\n" });
  const patternsText = asOptionalString(patternsSeed.text) || "# Codebase Patterns\n\nLast refreshed: YYYY-MM-DD\n";
  writeSetupJsonlEntry("patterns.jsonl", {
    ...patternsSeed,
    id: "initial",
    kind: "patterns_seed",
    recorded_at: generatedAt,
    text: patternsText,
  });
  writeText("patterns.md", withGeneratedMarker("cadre/patterns.jsonl", "cadre.patterns.v1", patternsText));
  const beforeStyleWritten = written.length;
  const beforeStyleSkipped = skipped.length;
  for (const guideId of asStringArray(styleGuides.selected)) {
    const guideJson = templateJson(`styleguides/${guideId}.json`, {
      version: 1,
      schema: "cadre.styleguide.v1",
      id: guideId,
      title: guideId,
      source: "bundled_template",
      rules: [],
    });
    writeSetupJson(`styleguides/${guideId}.json`, guideJson);
    writeText(
      `styleguides/${guideId}.md`,
      withGeneratedMarker(`cadre/styleguides/${guideId}.json`, "cadre.styleguide.v1", renderStyleGuideMarkdown(guideJson), {
        canonicalContent: `${JSON.stringify(guideJson, null, 2)}\n`,
        projection: `cadre/styleguides/${guideId}.md`,
      })
    );
  }
  const styleGuideIndex: JsonObject = {
    version: 1,
    schema: "cadre.styleguide_index.v1",
    selected: asStringArray(styleGuides.selected),
  };
  writeSetupJson("styleguides/index.json", styleGuideIndex);
  writeText(
    "styleguides/README.md",
    withGeneratedMarker("cadre/styleguides/index.json", "cadre.styleguide_index.v1", renderJsonCodeblock("Style guide catalog", styleGuideIndex), {
      canonicalContent: `${JSON.stringify(styleGuideIndex, null, 2)}\n`,
      projection: "cadre/styleguides/README.md",
    })
  );
  writeSetupJson("setup_state.json", setupStatePayload);
  writeSetupJson("config.json", configPayload);
  let repos: JsonObject | null = null;
  if (reposPayload) {
    repos = reposPayload;
    writeSetupJson("repos.json", reposPayload);
    writeText(
      "repos.md",
      withGeneratedMarker("cadre/repos.json", "cadre.repos.v1", renderJsonCodeblock("Repository topology", reposPayload), {
        canonicalContent: `${JSON.stringify(reposPayload, null, 2)}\n`,
        projection: "cadre/repos.md",
      })
    );
  }
  const approvedLspAdded = approvedSetupLspAdded(plannedCollection.cursor.session);
  const approvedLspRemoved = approvedSetupLspRemoved(plannedCollection.cursor.session);
  const approvedLspReviewed = hasApprovedSetupLspSnapshot(plannedCollection.cursor.session);
  const lspSetupResult = approvedLspReviewed
    ? {
      ...lspRecommendations,
      ok: true,
      written: true,
      added: approvedLspAdded,
      removed: approvedLspRemoved,
      missingFromConfig: [],
      reviewed_snapshot: true,
      applied: true,
      preview_materialized: true,
      execution_source: "approved_snapshot",
    }
    : {
      ...lspRecommendations,
      written: false,
      added: [],
      removed: [],
      reviewed_snapshot: false,
      applied: false,
      preview_materialized: false,
      execution_source: "no_approved_snapshot",
    };
  const gitattributes = gitattributesNeeded ? setupGitattributes(root) : null;
  const ciSetup = setupCiTemplates(
    root,
    ciProvider,
    { ...args, topology: polyrepoRequested ? "polyrepo" : "monorepo" }
  );
  const polyrepoSetup = polyrepoRequested && repos
    ? {
      gitattributes,
      ci: ciSetup,
      submodules: setupSubmodulePlan(root, repos, args),
    }
    : null;
  const setupEvent = appendCadreEvent(root, {
    kind: "setup_completed",
    workflow: "setup",
    topology: polyrepoRequested ? "polyrepo" : "monorepo",
    sync_mode: syncModeRecommendation,
    provider_mode: providerMode || "local",
    written_count: written.length,
    skipped_count: skipped.length,
  });
  const approvalAudit = recordApprovalCompletionFromArgs(root, args);
  const controlCommit = commitTrace(root, args, {
    kind: "control",
    workflow: "setup",
    subject: "initialize control plane",
    before: traceBefore,
    forceEnabled: true,
    allowDirty: true,
    includeDirtyFiles: Array.from(new Set([...written, ...asStringArray(reviewValidation.files), "cadre/.gitignore"])),
    note: {
      event_id: asOptionalString(asJsonObject(setupEvent.event).id) || null,
      topology: polyrepoRequested ? "polyrepo" : "monorepo",
      sync_mode: syncModeRecommendation,
      provider_mode: providerMode || "local",
    },
  });
  const approvalSessionClose = controlCommit.ok !== false ? closeApprovalSessionFromArgs(root, args) : null;
  return {
    ...result,
    ok: controlCommit.ok !== false,
    scaffolded: true,
    phase_state: controlCommit.ok === false ? "recovery_required" : "executed",
    topology: polyrepoRequested ? "polyrepo" : "monorepo",
    written,
    skipped,
    styleGuides: {
      ...styleGuides,
      written: written.slice(beforeStyleWritten),
      skipped: skipped.slice(beforeStyleSkipped),
    },
    lsp_setup: lspSetupResult,
    native_state: nativeState,
    event: setupEvent,
    approval_audit: approvalAudit,
    approval_session_close: approvalSessionClose,
    control_commit: controlCommit,
    review_validation: reviewValidation,
    reused_review_files: asStringArray(reviewValidation.files),
    gitattributes,
    ci_setup: ciSetup,
    polyrepo_setup: polyrepoSetup,
    force,
    doctor_after: doctor(root, { hasCadreProject: true }),
  };
}
