import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";
import { asJsonObject, asOptionalString, asStringArray } from "../../../guards";

import type { ReviewFile } from "./contracts";
import { reviewArtifactsFromFiles, workflowReviewBundle } from "./review-bundles";

export interface ApprovalStage {
  id: string;
  title: string;
  description: string;
  fileMatches: string[];
}

function rawArgs(args: RuntimeArgs): UnknownRecord {
  return args as UnknownRecord;
}

export function approvalComplete(args: RuntimeArgs = {}): boolean {
  const raw = rawArgs(args);
  return raw.approvalComplete === true || raw.approval_complete === true;
}

export function approvedStageIds(args: RuntimeArgs = {}): string[] {
  const raw = rawArgs(args);
  return Array.from(new Set(asStringArray(raw.approvedStages || raw.approved_stages))).sort();
}

export function requestedApprovalStage(args: RuntimeArgs = {}): string | null {
  const raw = rawArgs(args);
  return asOptionalString(raw.approvalStage || raw.approval_stage) || null;
}

function filesForStage(files: ReviewFile[], stage: ApprovalStage): ReviewFile[] {
  if (stage.fileMatches.includes("*")) return files;
  return files.filter((file) => stage.fileMatches.some((needle) => file.path.includes(needle) || file.source.includes(needle)));
}

export function stagedApprovalState(
  root: string,
  workflow: string,
  args: RuntimeArgs,
  stages: ApprovalStage[],
  reviewFiles: ReviewFile[],
  extras: JsonObject = {}
): JsonObject {
  const approved = new Set(approvedStageIds(args));
  const pending = stages.filter((stage) => !approved.has(stage.id));
  const requested = requestedApprovalStage(args);
  const active = stages.find((stage) => stage.id === requested)
    || pending[0]
    || stages[stages.length - 1]
    || null;
  const activeFiles = active ? filesForStage(reviewFiles, active) : [];
  const stageBundle = active
    ? workflowReviewBundle(root, `${workflow}-${active.id}`, args, activeFiles, {
      ...extras,
      approval_stage: active.id,
      approved_stages: Array.from(approved),
      pending_stages: pending.map((stage) => stage.id),
    })
    : null;
  const complete = approvalComplete(args);
  return {
    version: 1,
    kind: "cadre.staged_approval.v1",
    workflow,
    required: true,
    approval_argument: "approvalComplete",
    approval_complete: complete,
    current_stage: active?.id || null,
    current_stage_title: active?.title || null,
    approved_stages: Array.from(approved),
    pending_stages: pending.map((stage) => stage.id),
    stages: stages.map((stage) => {
      const stageFiles = filesForStage(reviewFiles, stage);
      return {
        id: stage.id,
        title: stage.title,
        description: stage.description,
        approved: approved.has(stage.id),
        file_count: stageFiles.length,
      };
    }),
    current_review_artifacts: reviewArtifactsFromFiles(activeFiles),
    current_review_bundle: stageBundle,
    next_actions: complete
      ? [`Call ${workflow} with execute:true and approvalComplete:true to apply the approved staged payload.`]
      : active
        ? [
          `Review and approve the ${active.id} stage.`,
          `Call ${workflow} again with approvedStages including ${active.id} to advance to the next stage.`,
          "After all stages are approved, call the mutating packet with execute:true and approvalComplete:true.",
        ]
        : [],
  };
}

export function setupApprovalStages(polyrepoRequested: boolean): ApprovalStage[] {
  return [
    {
      id: "product",
      title: "Product Context",
      description: "Product summary, users, workflows, domain model, invariants, and boundaries.",
      fileMatches: ["product.json", "product.md"],
    },
    {
      id: "product_guidelines",
      title: "Product Guidelines",
      description: "Product principles, user promises, trust boundaries, non-goals, decision rules, and review checklist.",
      fileMatches: ["product_guidelines"],
    },
    {
      id: "tech_stack",
      title: "Tech Stack",
      description: "Structured languages, frameworks, package managers, platforms, and project commands.",
      fileMatches: ["tech-stack.json", "techStack"],
    },
    {
      id: "workflow",
      title: "Workflow Policy",
      description: "Development, verification, review, commit, and coordination expectations.",
      fileMatches: ["workflow.json", "workflow.md", "workflowPolicy"],
    },
    {
      id: "styleguides",
      title: "Style Guides",
      description: "Generated style-guide selection and projections derived from the tech stack.",
      fileMatches: ["styleguides", "code_styleguides"],
    },
    {
      id: polyrepoRequested ? "project_state" : "project_state",
      title: polyrepoRequested ? "Project State And Repos" : "Project State",
      description: "Initial indexes, patterns, optional repository topology, and setup support artifacts.",
      fileMatches: ["patterns", "tracks.json", "repos.json", "lsp.json"],
    },
  ];
}

export function newTrackApprovalStages(): ApprovalStage[] {
  return [
    {
      id: "spec",
      title: "Track Spec",
      description: "Goal, requirements, acceptance criteria, and out-of-scope guardrails.",
      fileMatches: ["spec.json", "spec.md"],
    },
    {
      id: "plan",
      title: "Track Plan",
      description: "Phases, tasks, dependencies, file claims, and manual verification tasks.",
      fileMatches: ["plan.json", "plan.md"],
    },
    {
      id: "metadata",
      title: "Track Metadata",
      description: "Track identity, ownership, status, priority, branch, and worktree routing.",
      fileMatches: ["metadata.json", "metadata"],
    },
    {
      id: "learnings",
      title: "Track Learnings",
      description: "Initial learnings journal and human projection for future implementation notes.",
      fileMatches: ["learnings"],
    },
  ];
}

export function reviseApprovalStages(hasSpec: boolean, hasPlan: boolean): ApprovalStage[] {
  return [
    ...(hasSpec
      ? [{
        id: "spec_changes",
        title: "Spec Changes",
        description: "Revised track requirements, acceptance criteria, and scope.",
        fileMatches: ["spec.json", "spec.md", "spec"],
      }]
      : []),
    ...(hasPlan
      ? [{
        id: "plan_changes",
        title: "Plan Changes",
        description: "Revised phases, tasks, dependencies, and manual verification tasks.",
        fileMatches: ["plan.json", "plan.md", "plan"],
      }]
      : []),
  ];
}

export function refreshApprovalStages(includePatterns = true, includeLsp = false): ApprovalStage[] {
  return [
    ...(includePatterns ? [{
      id: "patterns",
      title: "Project Patterns",
      description: "Refreshed project patterns canonical JSONL and generated projection.",
      fileMatches: ["patterns"],
    }] : []),
    ...(includeLsp ? [{
      id: "lsp_config",
      title: "LSP Configuration",
      description: "Language server setup changes requested by the refresh scope.",
      fileMatches: ["lsp"],
    }] : []),
  ];
}

export function artifactApprovalStages(): ApprovalStage[] {
  return [
    {
      id: "projections",
      title: "Generated Projections",
      description: "Generated human projections derived from canonical JSON/JSONL artifacts.",
      fileMatches: ["*"],
    },
  ];
}

export function releaseApprovalStages(hasGitActions: boolean): ApprovalStage[] {
  return [
    {
      id: "release_notes",
      title: "Release Notes",
      description: "Human-facing release notes for the selected completed tracks.",
      fileMatches: [".md", "releaseNotes"],
    },
    {
      id: "release_metadata",
      title: "Release Metadata",
      description: "Canonical release metadata for completed tracks and review state.",
      fileMatches: [".json", "releaseMetadata"],
    },
    ...(hasGitActions
      ? [{
        id: "git_actions",
        title: "Git Actions",
        description: "Optional local git actions such as release tag creation.",
        fileMatches: [],
      }]
      : []),
  ];
}

export function handoffApprovalStages(): ApprovalStage[] {
  return [
    {
      id: "handoff_json",
      title: "Handoff Canonical",
      description: "Structured handoff context for the target track.",
      fileMatches: ["handoff.json", "handoffText"],
    },
    {
      id: "handoff_projection",
      title: "Handoff Projection",
      description: "Generated handoff document for another session or teammate.",
      fileMatches: ["HANDOFF.md", "handoff.md"],
    },
  ];
}
