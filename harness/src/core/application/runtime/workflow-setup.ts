import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CadreLock, CadreTrack, CommandResult, JsonObject, LockInfo, ParsedPlan, PlanPhase, PlanTask, RuntimeArgs, Topology, TrackMetadata, UnknownRecord } from "../../../types";
import { asBoolean, asJsonObject, asNumber, asOptionalNumber, asOptionalString, asString, asStringArray, errorCode, errorMessage, getBoolean, getNumber, getOptionalString, getString, isRecord } from "../../../guards";
import { LOCK_STALE_MS, STALE_LEASE_MS } from "../../domain/lease-policy";
import { PROVIDER_MODES } from "../../domain/provider-policy";
import { STATUS_MARKERS, VALID_STATUSES } from "../../domain/track-status";
import { languageForFile, listWorkspaceFiles } from "../../../lsp/language-registry";

import { renderJsonCodeblock } from "./artifact-actions";
import { CoreResult, ReviewFile } from "./contracts";
import { summarizeLspSetupResult } from "./health-summaries";
import { appendJsonl, fileExists, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { renderMarkdownDoc, withGeneratedMarker } from "./markdown-docs";
import { appendCadreEvent, ensureNativeState } from "./native-state";
import { setupIntentPrompts } from "./intent-prompts";
import { setupNativePrompts } from "./native-prompts";
import { configuredProvider } from "../../infrastructure/runtime/project-config";
import { appendLspReviewArtifacts, setupReviewArtifacts, setupReviewFiles, setupShouldWriteLsp } from "./review-bundles";
import { configuredCiProvider, lspSetup, setupCiTemplates, setupGitattributes, setupSubmodulePlan } from "./setup-infrastructure";
import { renderStyleGuideMarkdown } from "./spec-docs";
import { trackIndexPayload } from "./status";
import { isCadreProjectRoot } from "../../infrastructure/runtime/system";
import { setupStyleGuides, techStackFromArgs, techStackSummary } from "./tech-stack";
import { beginTrace, commitTrace } from "./commit-trace";
import { markdownPayloadError, normalizeProjectDoc, templateJson, templateManifest, templateText, workflowResponseMode, workflowSummary } from "./workflow-response";
import { doctor, workspaceHealth } from "./workspace-health";
import { applyStagedApprovalSessionPayload, setupApprovalStages, stagedApprovalError, stagedApprovalReady, stagedApprovalState, validateApprovedTargetReviewFiles } from "./staged-approval";
import { setupGenerationWarnings } from "./generation-quality";
import { closeApprovalSessionFromArgs, recordApprovalCompletionFromArgs } from "./approval-session-store";
import { appendRequiredLine, lspPreviewPayload, machineReviewFile } from "./setup-review-plan";

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
  const hasPreviewLspAdded = Object.prototype.hasOwnProperty.call(rawArgs, "setupPreviewLspAdded")
    || Object.prototype.hasOwnProperty.call(rawArgs, "setup_preview_lsp_added");
  const previewLspAdded = hasPreviewLspAdded
    ? asStringArray(rawArgs.setupPreviewLspAdded || rawArgs.setup_preview_lsp_added)
    : asStringArray(lspRecommendations.missingFromConfig);
  const previewStyleGuides = isRecord(rawArgs.setupPreviewStyleGuides || rawArgs.setup_preview_style_guides)
    ? asJsonObject(rawArgs.setupPreviewStyleGuides || rawArgs.setup_preview_style_guides)
    : {
      selected: asStringArray(styleGuides.selected),
      missing: asStringArray(styleGuides.missing),
      warnings: asStringArray(styleGuides.warnings),
    };
  const approvalArgs = { ...args, setupPreviewLspAdded: previewLspAdded, setupPreviewStyleGuides: previewStyleGuides } as RuntimeArgs;
  const detailMode = workflowResponseMode(args) === "detail";
  const workspaceHealthResult = workspaceHealth(root, { ...args, responseMode: detailMode ? "detail" : "compact" });
  const configOverrides = asJsonObject(rawArgs.config);
  const requestedSyncMode = asOptionalString(rawArgs.syncMode || rawArgs.sync_mode || configOverrides.sync_mode);
  const teamSize = Number(rawArgs.teamSize || rawArgs.team_size || 0);
  const syncModeRecommendation = requestedSyncMode || (teamSize >= 2 ? "shared" : "local");
  const generatedAt = utcNow();
  const configPayload: JsonObject = {
    ...templateJson("config.json", { sync_mode: "local", auto_open: false }),
    packet_only: true,
    sync_mode: syncModeRecommendation,
    provider_mode: providerMode || "local",
    provider_mcp_required: providerMode === "github" || providerMode === "gitlab",
    ...(asOptionalString(provider.remote_host) ? { remote_host: asOptionalString(provider.remote_host) } : {}),
    ...(isRecord(rawArgs.integrations) ? { integrations: asJsonObject(rawArgs.integrations) } : {}),
    ...configOverrides,
  };
  const setupStatePayload: JsonObject = {
    version: 1,
    packet_only: true,
    topology: polyrepoRequested ? "polyrepo" : "monorepo",
    initialized_at: generatedAt,
    updated_at: generatedAt,
  };
  const trackIndex = trackIndexPayload(root, []);
  const machineFiles: ReviewFile[] = [
    machineReviewFile("cadre/.gitignore", "Cadre local-state ignore", "setup:native-state", appendRequiredLine(fileExists(path.join(root, "cadre", ".gitignore")) ? fs.readFileSync(path.join(root, "cadre", ".gitignore"), "utf8") : "", "/local/")),
    machineReviewFile("cadre/config.json", "Cadre configuration", "setup:config", `${JSON.stringify(configPayload, null, 2)}\n`),
    machineReviewFile("cadre/setup_state.json", "Cadre setup state", "setup:state", `${JSON.stringify(setupStatePayload, null, 2)}\n`),
    machineReviewFile("cadre/tracks.json", "Initial track index", "setup:track-index", `${JSON.stringify(trackIndex, null, 2)}\n`),
  ];
  if (lspWriteRequested) {
    machineFiles.push(machineReviewFile("cadre/lsp.json", "LSP configuration", "setup:lsp", `${JSON.stringify(lspPreviewPayload(root, lspRecommendations), null, 2)}\n`));
  }
  const gitattributesNeeded = polyrepoRequested
    || configPayload.sync_mode === "shared"
    || rawArgs.writeGitattributes === true
    || rawArgs.write_gitattributes === true;
  if (gitattributesNeeded) {
    const attributesPath = path.join(root, ".gitattributes");
    machineFiles.push(machineReviewFile(".gitattributes", "Cadre merge attributes", "setup:gitattributes", appendRequiredLine(fileExists(attributesPath) ? fs.readFileSync(attributesPath, "utf8") : "", "cadre/tracks/**/parallel_state.json merge=ours")));
  }
  const ciProvider = configuredCiProvider(root, args) || (providerMode === "github" || providerMode === "gitlab" ? providerMode : null);
  if (ciProvider && rawArgs.writeCi !== false && rawArgs.write_ci !== false) {
    const ciTemplate = polyrepoRequested
      ? (ciProvider === "github" ? "ci/cadre-merge-train.github.yml" : "ci/cadre-merge-train.gitlab.yml")
      : (ciProvider === "github" ? "ci/cadre-monorepo-check.github.yml" : "ci/cadre-monorepo-check.gitlab.yml");
    const ciPath = ciProvider === "github"
      ? `.github/workflows/${polyrepoRequested ? "cadre-merge-train.yml" : "cadre-monorepo-check.yml"}`
      : ".gitlab-ci.yml";
    if (!fileExists(path.join(root, ciPath)) || rawArgs.force === true) {
      machineFiles.push(machineReviewFile(ciPath, "Cadre CI workflow", `template:${ciTemplate}`, templateText(ciTemplate, "")));
    }
  }
  const providerNeedsConfirmation = provider.requires_confirmation === true && !asOptionalString(rawArgs.providerMode || rawArgs.provider_mode || rawArgs.provider);
  const reviewFiles = providerNeedsConfirmation ? [] : setupReviewFiles(root, args, styleGuides, polyrepoRequested, machineFiles);
  const reviewArtifacts = appendLspReviewArtifacts(setupReviewArtifacts(reviewFiles, styleGuides), args, lspWriteRequested);
  const approval = providerNeedsConfirmation
    ? { required: false, valid_for_execute: false, current_stage: null, pending_stages: [] }
    : stagedApprovalState(root, "setup", approvalArgs, setupApprovalStages(polyrepoRequested), reviewFiles, {
      styleGuides: previewStyleGuides,
      final_only_files: ["cadre/events.jsonl"],
    });
  const stageReviewBundle = asJsonObject(approval).current_review_bundle;
  const stageReviewArtifacts = asJsonObject(approval).current_review_artifacts;
  const approvalError = providerNeedsConfirmation ? null : stagedApprovalError(approval);
  const qualityWarnings = setupGenerationWarnings(args as JsonObject);
  const intentPrompts = args.execute === true ? [] : setupIntentPrompts(args);
  const nativePrompts = args.execute === true ? [] : setupNativePrompts({
    provider: asJsonObject(provider),
    syncMode: syncModeRecommendation,
    styleGuides: asJsonObject(styleGuides),
    lspSetup: asJsonObject(lspRecommendations),
    integrations: workspaceHealthResult.integrations,
    runtimeArgs: args,
  });
  const warnings = [
    ...asStringArray(styleGuides.warnings),
    ...asStringArray(asJsonObject(stageReviewBundle).warnings),
    ...qualityWarnings,
  ];
  const result: CoreResult = {
    ...summary,
    ok: true,
    phase_state: args.execute !== true && intentPrompts.length > 0 ? "awaiting_clarification" : summary.phase_state,
    ...(args.execute !== true && intentPrompts.length > 0 ? { stage: "intent_clarification" } : {}),
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
    ...(intentPrompts.length > 0 ? { intent_prompts: intentPrompts } : {}),
    ...(nativePrompts.length > 0 ? { native_prompts: nativePrompts } : {}),
    approval,
    review_artifacts: stageReviewArtifacts || reviewArtifacts,
    review_bundle: stageReviewBundle,
    warnings: approvalError ? [...warnings, approvalError] : warnings,
    required_payload: args.execute === true
      ? ["product", "techStack"]
        .concat(provider.requires_confirmation === true ? ["providerMode"] : [])
        .concat(polyrepoRequested && !reposPayload ? ["repos"] : [])
      : [],
    next_actions: [
      ...(intentPrompts.length > 0 || nativePrompts.length > 0
        ? ["Answer returned intent_prompts/native_prompts with the client native selector, then call setup again with structured arguments."]
        : []),
      ...(provider.requires_confirmation === true
        ? ["Choose providerMode: local, github, or gitlab before setup writes cadre/config.json."]
        : []),
      "Approve setup one stage at a time with approvedStages; after every stage is approved, call setup with execute:true and approvalComplete:true.",
    ],
    packet_notes: [
      "cadre-setup is packet-only: agents gather user intent, then pass confirmed structured JSON payloads to this packet.",
      "Setup writes are human-in-loop: mutating setup packets require approvalComplete:true after staged artifact review.",
      "Project mutation must be performed by MCP packets; clients must not recreate Cadre setup writes themselves.",
      "Provider evidence is direct-MCP only: GitHub/GitLab modes require the matching provider MCP, local mode requires none.",
    ],
  };
  if (args.execute !== true && approvalError) {
    return {
      ...result,
      ok: false,
      phase_state: "awaiting_staged_approval",
      stage: "staged_approval",
      error: approvalError,
    };
  }
  if (args.execute !== true) return result;

  const cadreDir = path.join(root, "cadre");
  const force = asBoolean(rawArgs.force, false);
  const missingPayload = [
    ...(!isRecord(rawArgs.product) ? ["product"] : []),
    ...(!techStackFromArgs(args) ? ["techStack"] : []),
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
    recorded_at: utcNow(),
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
    generated_at: utcNow(),
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
  const lspSetupExecution = lspWriteRequested ? lspSetup(root, { ...args, execute: true }) : lspRecommendations;
  const lspSetupResult = lspWriteRequested
    ? {
      ...lspSetupExecution,
      written: lspSetupExecution.ok !== false,
      added: Array.from(new Set([
        ...previewLspAdded,
        ...asStringArray(lspSetupExecution.added),
      ])),
      preview_materialized: true,
    }
    : lspSetupExecution;
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
    includeDirtyFiles: [...asStringArray(reviewValidation.files), "cadre/.gitignore"],
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
