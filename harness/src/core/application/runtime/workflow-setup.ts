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
import { CoreResult } from "./contracts";
import { summarizeLspSetupResult } from "./health-summaries";
import { appendJsonl, fileExists, utcNow, writeJson } from "../../infrastructure/runtime/json-store";
import { renderMarkdownDoc, withGeneratedMarker } from "./markdown-docs";
import { configuredProvider } from "../../infrastructure/runtime/project-config";
import { appendLspReviewArtifacts, humanReviewState, setupReviewArtifacts, setupReviewBundle, setupReviewFiles, setupShouldWriteLsp } from "./review-bundles";
import { configuredCiProvider, lspSetup, setupCiTemplates, setupGitattributes, setupSubmodulePlan } from "./setup-infrastructure";
import { renderStyleGuideMarkdown } from "./spec-docs";
import { trackIndexPayload } from "./status";
import { isCadreProjectRoot } from "../../infrastructure/runtime/system";
import { humanReviewConfirmed, setupStyleGuides, techStackFromArgs, techStackSummary } from "./tech-stack";
import { markdownPayloadError, normalizeProjectDoc, templateJson, templateManifest, workflowResponseMode, workflowSummary } from "./workflow-response";
import { doctor, workspaceHealth } from "./workspace-health";

export function workflowSetup(root: string, args: RuntimeArgs = {}): CoreResult {
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
  const requestedSyncMode = asOptionalString(rawArgs.syncMode || rawArgs.sync_mode || configOverrides.sync_mode);
  const teamSize = Number(rawArgs.teamSize || rawArgs.team_size || 0);
  const syncModeRecommendation = requestedSyncMode || (teamSize >= 2 ? "shared" : "local");
  const reviewFiles = setupReviewFiles(root, args, styleGuides, polyrepoRequested);
  const reviewBundle = setupReviewBundle(root, args, reviewFiles, styleGuides);
  const reviewArtifacts = appendLspReviewArtifacts(setupReviewArtifacts(reviewFiles, styleGuides), args, lspWriteRequested);
  const humanReview = humanReviewState("setup", args, reviewArtifacts, reviewBundle);
  const warnings = [
    ...asStringArray(styleGuides.warnings),
    ...asStringArray(asJsonObject(reviewBundle).warnings),
  ];
  const result: CoreResult = {
    ...summary,
    ok: true,
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
    human_review: humanReview,
    review_artifacts: reviewArtifacts,
    review_bundle: reviewBundle,
    warnings,
    required_payload: args.execute === true
      ? ["product", "techStack"]
        .concat(provider.requires_confirmation === true ? ["providerMode"] : [])
        .concat(polyrepoRequested && !reposPayload ? ["repos"] : [])
      : [],
    next_actions: [
      ...(provider.requires_confirmation === true
        ? ["Choose providerMode: local, github, or gitlab before setup writes cadre/config.json."]
        : []),
      "Review setup artifacts with the user; call setup_scaffold with execute:true and humanConfirmed:true only after explicit approval.",
    ],
    packet_notes: [
      "cadre-setup is packet-only: agents gather user intent, then pass confirmed structured JSON payloads to this packet.",
      "Setup writes are human-in-loop: mutating setup packets require humanConfirmed:true after artifact review.",
      "Project mutation must be performed by MCP packets; clients must not recreate Cadre setup writes themselves.",
      "Provider evidence is direct-MCP only: GitHub/GitLab modes require the matching provider MCP, local mode requires none.",
    ],
  };
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
  if (!humanReviewConfirmed(args)) {
    return {
      ...result,
      ok: false,
      phase_state: "awaiting_human_review",
      stage: "human_review",
      error: "Human confirmation is required before writing setup artifacts",
    };
  }
  const written: string[] = [];
  const skipped: string[] = [];
  const writeText = (relativePath: string, text: string): void => {
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
    writeText(relativePath, withGeneratedMarker(`cadre/${jsonPath}`, `cadre.${kind}.v1`, renderMarkdownDoc(value, title)));
  };

  fs.mkdirSync(path.join(cadreDir, "tracks"), { recursive: true });
  fs.mkdirSync(path.join(cadreDir, "archive"), { recursive: true });
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
  writeProjectDoc(
    "workflow.md",
    "workflow",
    normalizeProjectDoc("workflow", rawArgs.workflowPolicy || rawArgs.workflow_policy, "workflow.json", "Project Workflow", "Project-Specific Workflow Notes"),
    "Project Workflow"
  );
  writeSetupJson("tracks.json", trackIndexPayload(root, []));
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
      `code_styleguides/${guideId}.md`,
      withGeneratedMarker(`cadre/styleguides/${guideId}.json`, "cadre.styleguide.v1", renderStyleGuideMarkdown(guideJson))
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
    "code_styleguides/README.md",
    withGeneratedMarker("cadre/styleguides/index.json", "cadre.styleguide_index.v1", renderJsonCodeblock("Style guide catalog", styleGuideIndex))
  );
  writeSetupJson("setup_state.json", {
    version: 1,
    packet_only: true,
    topology: polyrepoRequested ? "polyrepo" : "monorepo",
    initialized_at: utcNow(),
    updated_at: utcNow(),
  });
  const configPayload = {
    ...templateJson("config.json", { sync_mode: "local", auto_open: false }),
    packet_only: true,
    sync_mode: syncModeRecommendation,
    provider_mode: providerMode || "local",
    provider_mcp_required: providerMode === "github" || providerMode === "gitlab",
    ...(asOptionalString(provider.remote_host) ? { remote_host: asOptionalString(provider.remote_host) } : {}),
    ...(isRecord(rawArgs.integrations) ? { integrations: asJsonObject(rawArgs.integrations) } : {}),
    ...configOverrides,
  };
  writeSetupJson("config.json", configPayload);
  let repos: JsonObject | null = null;
  if (reposPayload) {
    repos = reposPayload;
    writeSetupJson("repos.json", reposPayload);
  }
  const lspSetupResult = lspWriteRequested ? lspSetup(root, { ...args, execute: true }) : lspRecommendations;
  const gitattributesNeeded = polyrepoRequested
    || configPayload.sync_mode === "shared"
    || rawArgs.writeGitattributes === true
    || rawArgs.write_gitattributes === true;
  const gitattributes = gitattributesNeeded ? setupGitattributes(root) : null;
  const ciSetup = setupCiTemplates(
    root,
    configuredCiProvider(root, args) || (providerMode === "github" || providerMode === "gitlab" ? providerMode : null),
    { ...args, topology: polyrepoRequested ? "polyrepo" : "monorepo" }
  );
  const polyrepoSetup = polyrepoRequested && repos
    ? {
      gitattributes,
      ci: ciSetup,
      submodules: setupSubmodulePlan(root, repos, args),
    }
    : null;
  return {
    ...result,
    ok: true,
    scaffolded: true,
    phase_state: "executed",
    topology: polyrepoRequested ? "polyrepo" : "monorepo",
    written,
    skipped,
    styleGuides: {
      ...styleGuides,
      written: written.slice(beforeStyleWritten),
      skipped: skipped.slice(beforeStyleSkipped),
    },
    lsp_setup: lspSetupResult,
    gitattributes,
    ci_setup: ciSetup,
    polyrepo_setup: polyrepoSetup,
    force,
    doctor_after: doctor(root, { hasCadreProject: true }),
  };
}
