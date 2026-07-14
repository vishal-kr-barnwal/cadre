export interface ApprovalStage {
  id: string;
  title: string;
  description: string;
  documentIds: string[];
  fileMatches?: string[];
}

export function setupApprovalStages(polyrepoRequested: boolean): ApprovalStage[] {
  return [
    {
      id: "product",
      title: "Product Context",
      description: "Product summary, users, workflows, domain model, invariants, and boundaries.",
      documentIds: ["product"],
    },
    {
      id: "product_guidelines",
      title: "Product Guidelines",
      description: "Product principles, user promises, trust boundaries, non-goals, decision rules, and review checklist.",
      documentIds: ["product_guidelines"],
    },
    {
      id: "tech_stack",
      title: "Tech Stack",
      description: "Structured languages, frameworks, package managers, platforms, and project commands.",
      documentIds: ["tech_stack"],
    },
    {
      id: "workflow",
      title: "Workflow Policy",
      description: "Development, verification, review, commit, and coordination expectations.",
      documentIds: ["workflow"],
    },
    ...(polyrepoRequested ? [{
      id: "repos",
      title: "Repository Topology",
      description: "Human-readable repository topology and its canonical JSON.",
      documentIds: ["repos"],
    }] : []),
    {
      id: "styleguides",
      title: "Style Guides",
      description: "Generated style-guide selection and projections derived from the tech stack.",
      documentIds: ["styleguides"],
    },
  ];
}

export function newTrackApprovalStages(): ApprovalStage[] {
  return [
    {
      id: "spec",
      title: "Track Spec",
      description: "Goal, requirements, acceptance criteria, and out-of-scope guardrails.",
      documentIds: ["spec"],
    },
    {
      id: "plan",
      title: "Track Plan",
      description: "Phases, tasks, dependencies, file claims, and manual verification tasks.",
      documentIds: ["plan"],
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
        documentIds: ["spec"],
      }]
      : []),
    ...(hasPlan
      ? [{
        id: "plan_changes",
        title: "Plan Changes",
        description: "Revised phases, tasks, dependencies, and manual verification tasks.",
        documentIds: ["plan"],
      }]
      : []),
  ];
}

export function refreshApprovalStages(levels: string[]): ApprovalStage[] {
  const selected = new Set(levels);
  return [
    ...(selected.has("product") ? [{
      id: "product",
      title: "Product Context",
      description: "Evidence-backed product summary, users, workflows, domain model, invariants, and boundaries.",
      documentIds: ["product"],
    }] : []),
    ...(selected.has("product-guidelines") ? [{
      id: "product_guidelines",
      title: "Product Guidelines",
      description: "Evidence-backed product principles, promises, trust boundaries, rules, and review checklist.",
      documentIds: ["product_guidelines"],
    }] : []),
    ...(selected.has("tech-stack") ? [{
      id: "tech_stack",
      title: "Tech Stack",
      description: "Detected languages, frameworks, runtimes, dependencies, platforms, and commands.",
      documentIds: ["tech_stack"],
    }] : []),
    ...(selected.has("workflow") ? [{
      id: "workflow",
      title: "Workflow Policy",
      description: "Development, verification, review, commit, and coordination expectations.",
      documentIds: ["workflow"],
    }] : []),
    ...(selected.has("repository-topology") ? [{
      id: "repos",
      title: "Repository Topology",
      description: "Configured repositories, enabled state, default repository, and polyrepo routing.",
      documentIds: ["repos"],
    }] : []),
    ...(selected.has("patterns") ? [{
      id: "patterns",
      title: "Project Patterns",
      description: "Evidence-backed project patterns canonical JSONL and generated projection.",
      documentIds: ["patterns"],
    }] : []),
  ];
}

export function artifactApprovalStages(): ApprovalStage[] {
  return [];
}

export function releaseApprovalStages(_hasGitActions: boolean): ApprovalStage[] {
  return [
    {
      id: "release_notes",
      title: "Release Notes",
      description: "Human-facing release notes for the selected completed tracks.",
      documentIds: ["release_notes"],
    },
  ];
}

export function handoffApprovalStages(): ApprovalStage[] {
  return [
    {
      id: "handoff",
      title: "Handoff",
      description: "Generated handoff document and its structured canonical context.",
      documentIds: ["handoff"],
    },
  ];
}
