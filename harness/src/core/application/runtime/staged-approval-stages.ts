import type { RevisionScope } from "./revision-scope";

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
      inputKeys: [
        "product", "intent.product", "intent.productOther", "intent.productIntent", "intent.productSummary",
        "productOther", "productIntent", "productSummary",
      ],
    },
    {
      id: "product_guidelines",
      title: "Product Guidelines",
      description: "Product principles, user promises, trust boundaries, non-goals, decision rules, and review checklist.",
      documentIds: ["product_guidelines"],
      inputKeys: ["productGuidelines", "product_guidelines"],
    },
    {
      id: "technical",
      title: "Technical Context",
      description: "Tech stack, style guides, repository topology, language servers, and setup infrastructure choices.",
      documentIds: ["tech_stack", "styleguides", ...(polyrepoRequested ? ["repos"] : [])],
      fileMatches: ["cadre/lsp.json"],
      inputKeys: [
        "techStack", "tech_stack",
        "intent.techStack", "intent.techStackOther", "intent.techStackIntent", "intent.techStackSummary",
        "techStackOther", "techStackIntent", "techStackSummary",
        "styleGuideIds", "style_guide_ids", "styleGuides", "style_guides",
        "writeLsp", "write_lsp", "setupLsp", "setup_lsp", "lsp",
        "lspSetupOther",
        "providerMode", "provider_mode", "provider", "providerModeOther",
        "syncMode", "sync_mode", "syncModeOther", "teamSize", "team_size",
        "integrations", "config",
        "topology", "polyrepo", "repos",
        "ciProvider", "ci_provider", "writeCi", "write_ci",
        "writeGitattributes", "write_gitattributes",
        "addSubmodules", "add_submodules", "executeSubmodules", "execute_submodules",
      ],
    },
    {
      id: "workflow",
      title: "Workflow Policy",
      description: "Development, verification, review, commit, and coordination expectations.",
      documentIds: ["workflow"],
      inputKeys: ["workflowPolicy", "workflow_policy"],
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
      inputKeys: [
        "spec", "description",
        "intent.goal", "intent.goalOther", "goal", "goalOther",
        "intent.outcome", "intent.outcomeOther", "outcome", "outcomeOther",
        "intent.acceptanceCriteria", "intent.acceptanceCriteriaOther", "acceptanceCriteria", "acceptanceCriteriaOther",
        "intent.scope", "intent.scopeOther", "scope", "scopeOther",
      ],
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

export function reviseApprovalStages(scope: RevisionScope): ApprovalStage[] {
  return [
    ...(scope === "spec" || scope === "both"
      ? [{
        id: "spec_changes",
        title: "Spec Changes",
        description: "Revised track requirements, acceptance criteria, and scope.",
        documentIds: ["spec"],
        inputKeys: ["spec"],
      }]
      : []),
    ...(scope === "plan" || scope === "both"
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
  const technicalSelected = ["tech-stack", "style-guides", "repository-topology", "lsp"]
    .some((level) => selected.has(level));
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
    ...(technicalSelected ? [{
      id: "technical",
      title: "Technical Context",
      description: "Selected tech stack, style guides, repository topology, and language-server configuration as one atomic review set.",
      documentIds: [
        ...(selected.has("tech-stack") ? ["tech_stack"] : []),
        ...(selected.has("style-guides") ? ["styleguides"] : []),
        ...(selected.has("repository-topology") ? ["repos"] : []),
        ...(selected.has("lsp") ? ["lsp"] : []),
      ],
      inputKeys: [
        "proposedContext.techStack", "proposedContext.tech_stack", "proposed_context.techStack", "proposed_context.tech_stack",
        "proposedContext.styleGuideIds", "proposedContext.style_guide_ids", "proposed_context.styleGuideIds", "proposed_context.style_guide_ids",
        "styleGuideIds", "style_guide_ids",
        "proposedContext.repositoryTopology", "proposedContext.repository_topology", "proposedContext.repos",
        "proposed_context.repositoryTopology", "proposed_context.repository_topology", "proposed_context.repos",
        "writeLsp", "write_lsp", "setupLsp", "setup_lsp", "lsp",
      ],
      fileMatches: selected.has("lsp") ? ["cadre/lsp.json"] : [],
    }] : []),
    ...(selected.has("workflow") ? [{
      id: "workflow",
      title: "Workflow Policy",
      description: "Development, verification, review, commit, and coordination expectations.",
      documentIds: ["workflow"],
      inputKeys: ["proposedContext.workflowPolicy", "proposedContext.workflow_policy", "proposed_context.workflowPolicy", "proposed_context.workflow_policy"],
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
