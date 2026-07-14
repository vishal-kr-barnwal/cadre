export interface ApprovalStage {
  id: string;
  title: string;
  description: string;
  documentIds: string[];
  inputKeys?: string[];
  fileMatches?: string[];
}

export function setupApprovalStages(polyrepoRequested: boolean): ApprovalStage[] {
  return [
    {
      id: "product",
      title: "Product Context",
      description: "Product summary, users, workflows, domain model, invariants, and boundaries.",
      documentIds: ["product"],
      inputKeys: ["product"],
    },
    {
      id: "product_guidelines",
      title: "Product Guidelines",
      description: "Product principles, user promises, trust boundaries, non-goals, decision rules, and review checklist.",
      documentIds: ["product_guidelines"],
      inputKeys: ["productGuidelines", "product_guidelines"],
    },
    {
      id: "tech_stack",
      title: "Tech Stack",
      description: "Structured languages, frameworks, package managers, platforms, and project commands.",
      documentIds: ["tech_stack"],
      inputKeys: ["techStack", "tech_stack"],
    },
    {
      id: "workflow",
      title: "Workflow Policy",
      description: "Development, verification, review, commit, and coordination expectations.",
      documentIds: ["workflow"],
      inputKeys: ["workflowPolicy", "workflow_policy"],
    },
    ...(polyrepoRequested ? [{
      id: "repos",
      title: "Repository Topology",
      description: "Human-readable repository topology and its canonical JSON.",
      documentIds: ["repos"],
      inputKeys: ["repos", "topology"],
    }] : []),
    {
      id: "styleguides",
      title: "Style Guides",
      description: "Generated style-guide selection and projections derived from the tech stack.",
      documentIds: ["styleguides"],
      inputKeys: ["styleGuideIds", "style_guide_ids", "styleGuides", "style_guides"],
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
      inputKeys: ["spec", "description"],
    },
    {
      id: "plan",
      title: "Track Plan",
      description: "Phases, tasks, dependencies, file claims, and manual verification tasks.",
      documentIds: ["plan"],
      inputKeys: ["plan"],
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
        inputKeys: ["spec"],
      }]
      : []),
    ...(hasPlan
      ? [{
        id: "plan_changes",
        title: "Plan Changes",
        description: "Revised phases, tasks, dependencies, and manual verification tasks.",
        documentIds: ["plan"],
        inputKeys: ["plan"],
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
      inputKeys: ["proposedContext.product", "proposed_context.product"],
    }] : []),
    ...(selected.has("product-guidelines") ? [{
      id: "product_guidelines",
      title: "Product Guidelines",
      description: "Evidence-backed product principles, promises, trust boundaries, rules, and review checklist.",
      documentIds: ["product_guidelines"],
      inputKeys: ["proposedContext.productGuidelines", "proposedContext.product_guidelines", "proposed_context.productGuidelines", "proposed_context.product_guidelines"],
    }] : []),
    ...(selected.has("tech-stack") ? [{
      id: "tech_stack",
      title: "Tech Stack",
      description: "Detected languages, frameworks, runtimes, dependencies, platforms, and commands.",
      documentIds: ["tech_stack"],
      inputKeys: ["proposedContext.techStack", "proposedContext.tech_stack", "proposed_context.techStack", "proposed_context.tech_stack"],
    }] : []),
    ...(selected.has("workflow") ? [{
      id: "workflow",
      title: "Workflow Policy",
      description: "Development, verification, review, commit, and coordination expectations.",
      documentIds: ["workflow"],
      inputKeys: ["proposedContext.workflowPolicy", "proposedContext.workflow_policy", "proposed_context.workflowPolicy", "proposed_context.workflow_policy"],
    }] : []),
    ...(selected.has("repository-topology") ? [{
      id: "repos",
      title: "Repository Topology",
      description: "Configured repositories, enabled state, default repository, and polyrepo routing.",
      documentIds: ["repos"],
      inputKeys: [
        "proposedContext.repositoryTopology",
        "proposedContext.repository_topology",
        "proposedContext.repos",
        "proposed_context.repositoryTopology",
        "proposed_context.repository_topology",
        "proposed_context.repos",
      ],
    }] : []),
    ...(selected.has("patterns") ? [{
      id: "patterns",
      title: "Project Patterns",
      description: "Evidence-backed project patterns canonical JSONL and generated projection.",
      documentIds: ["patterns"],
      inputKeys: ["proposedContext.patterns", "proposed_context.patterns"],
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
