export interface ApprovalStage {
  id: string;
  title: string;
  description: string;
  fileMatches: string[];
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
      id: "project_state",
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
