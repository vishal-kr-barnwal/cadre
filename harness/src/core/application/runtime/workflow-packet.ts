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

import { artifactPacket } from "./artifact-actions";
import { beadsTaskWrite } from "./beads-task-write";
import { CoreResult } from "./contracts";
import { textHash, utcNow } from "../../infrastructure/runtime/json-store";
import { humanReviewState, packetReviewArtifact } from "./review-bundles";
import { selectedTrackId } from "./status";
import { commandExists } from "../../infrastructure/runtime/system";
import { humanReviewConfirmed } from "./tech-stack";
import { findTrack, trackContext } from "./track-context";
import { metadataPatch, setTrackStatus } from "./track-mutations";
import { workflowArchive, workflowHandoff, workflowImplement, workflowReview, workflowStatus, workflowValidate } from "./workflow-basic";
import { workflowNewTrack } from "./workflow-new-track";
import { workflowRefresh, workflowRevert } from "./workflow-refresh-revert";
import { workflowRelease, workflowRevise } from "./workflow-release-revise";
import { markdownPayloadError, shapeWorkflowResponse, withSharedControlPlaneSync, workflowSummary } from "./workflow-response";
import { workflowSetup } from "./workflow-setup";
import { workflowLand, workflowShip } from "./workflow-ship-land";

export function workflowPacket(root: string, args: RuntimeArgs = {}): CoreResult {
  const workflow = asOptionalString(args.workflow) || asOptionalString(args.action) || "status";
  const markdownError = markdownPayloadError(args);
  if (markdownError) return shapeWorkflowResponse(root, workflow, args, { ...workflowSummary(root, workflow, args), ...markdownError });
  const mutating = args.execute === true && [
    "newtrack",
    "new_track",
    "handoff",
    "release",
    "revise",
    "refresh",
    "flag",
    "revert",
    "artifacts",
    "artifact_sync",
  ].includes(workflow);
  if (mutating && (args as UnknownRecord).skipSync !== true) {
    const result = withSharedControlPlaneSync(root, args, `workflow:${workflow}`, () =>
      workflowPacket(root, { ...args, skipSync: true })
    );
    return shapeWorkflowResponse(root, workflow, args, result);
  }
  const result = (() => {
  switch (workflow) {
    case "setup":
    case "setup_assist":
    case "setup_scaffold":
      return workflowSetup(root, args);
    case "newtrack":
    case "new_track":
      return workflowNewTrack(root, args);
    case "implement":
      return workflowImplement(root, args);
    case "status":
      return workflowStatus(root, args);
    case "review":
      return workflowReview(root, args);
    case "validate":
      return workflowValidate(root, args);
    case "archive":
      return workflowArchive(root, args);
    case "handoff":
      return workflowHandoff(root, args);
    case "ship":
      return workflowShip(root, args);
    case "land":
      return workflowLand(root, args);
    case "release":
      return workflowRelease(root, args);
    case "revise":
      return workflowRevise(root, args);
    case "refresh":
      return workflowRefresh(root, args);
    case "artifacts":
    case "artifact_sync":
      {
        const artifactAction = asOptionalString(args.artifactAction || args.artifact_action) || asOptionalString(args.mode) || "sync";
        return {
          ...workflowSummary(root, workflow, args),
          artifact_action: artifactAction,
          artifact_scope: asOptionalString(args.scope || args.view) || "all",
          ...artifactPacket(root, { ...args, action: artifactAction }),
        };
      }
    case "flag":
      {
        const trackId = selectedTrackId(root, args);
        const summary = workflowSummary(root, "flag", args);
        if (!trackId) return { ...summary, ok: false, error: "trackId is required" };
        const status = asOptionalString(args.status) || "blocked";
        const reason = asOptionalString(args.reason) || asOptionalString(args.note) || null;
        const context = trackContext(root, trackId);
        const reviewArtifacts = [
          packetReviewArtifact("Flag status change", "workflow:flag", {
            track_id: trackId,
            proposed_status: status,
            reason,
          }),
        ];
        const humanReview = humanReviewState("flag", args, reviewArtifacts);
        if (args.execute !== true) {
          return {
            ...summary,
            ok: context.ok !== false,
            dry_run: true,
            track_context: context,
            proposed_status: status,
            reason,
            human_review: humanReview,
            review_artifacts: reviewArtifacts,
          };
        }
        if (!humanReviewConfirmed(args)) {
          return {
            ...summary,
            ok: false,
            dry_run: true,
            phase_state: "awaiting_human_review",
            stage: "human_review",
            track_context: context,
            proposed_status: status,
            reason,
            human_review: humanReview,
            review_artifacts: reviewArtifacts,
            error: "Human confirmation is required before flagging track status",
          };
        }
        const statusResult = setTrackStatus(root, trackId, status);
        if (statusResult.ok === false) return { ...summary, ok: false, track_context: context, status_result: statusResult };
        const patch = metadataPatch(root, {
          trackId,
          patch: {
            last_status_reason: reason,
            last_status_at: utcNow(),
          },
        });
        const latestTrack = findTrack(root, trackId);
        const epic = latestTrack?.metadata.beads_epic;
        const beads = epic && reason
          ? beadsTaskWrite(root, {
            operation: "note",
            id: epic,
            note: `Cadre ${status}: ${reason}`,
            dedupKey: `cadre-flag-${trackId}-${status}-${textHash(reason).slice(0, 12)}`,
          })
          : null;
        return {
          ...summary,
          ok: patch.ok !== false && (!beads || beads.ok !== false),
          dry_run: false,
          track_context: context,
          status_result: statusResult,
          metadata_patch: patch,
          beads,
          human_review: humanReview,
          review_artifacts: reviewArtifacts,
        };
      }
    case "revert":
      return workflowRevert(root, args);
    case "formula":
      return {
        ...workflowSummary(root, "formula", args),
        ok: true,
        formulas: commandExists("bd", root) ? beadsTaskWrite(root, { operation: "formula_list" }) : { ok: false, available: false },
      };
    default:
      return {
        ...workflowSummary(root, workflow, args),
        ok: false,
        error: `Unknown Cadre workflow packet: ${workflow}`,
      };
  }
  })();
  return shapeWorkflowResponse(root, workflow, args, result);
}
