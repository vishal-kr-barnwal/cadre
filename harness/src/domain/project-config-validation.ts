import { PROJECT_UPGRADE_INSTRUCTIONS, supportsProjectFormat } from "./project-format.js";
import { isCompatibleRuntimeVersion, isCompatibleTemplateSet, LEGACY_RUNTIME_VERSIONS, LEGACY_TEMPLATE_SET_VERSIONS } from "./version.js";
import { isCommitRef } from "./operation-receipts.js";
import type { ProjectState } from "./state.js";

/** Project metadata and ignored runtime paths must satisfy the same rules before and after promotion. */
export function validateProjectConfig(project: ProjectState, ignore: string | undefined, ignorePath: string, errors: string[], warnings: string[]): void {
  if (!project || typeof project !== "object" || Array.isArray(project)) { errors.push("project.json: invalid project state"); return; }
  const ignored = new Set(ignore?.split(/\r?\n/) ?? []);
  if (ignore !== undefined) for (const path of ["/.worktrees/", "/wisps/"]) if (!ignored.has(path)) errors.push(`${ignorePath}: must ignore ${path}`);
  if (!ignored.has("/stage/")) {
    if ((LEGACY_TEMPLATE_SET_VERSIONS as readonly string[]).includes(project.templateSetVersion ?? "")) warnings.push("PROJECT_UPGRADE_REQUIRED: .cadre/.gitignore must ignore /stage/");
    else errors.push(`${ignorePath}: must ignore /stage/`);
  }
  if (![1, 2].includes(project.schemaVersion)) errors.push("project.json: unsupported schemaVersion");
  if (!isCompatibleRuntimeVersion(project.runtimeVersion)) {
    if ((LEGACY_RUNTIME_VERSIONS as readonly string[]).includes(project.runtimeVersion ?? "")) warnings.push(`PROJECT_UPGRADE_REQUIRED: legacy runtimeVersion ${project.runtimeVersion}`);
    else errors.push(`project.json: unsupported runtimeVersion ${String(project.runtimeVersion)}`);
  }
  if (!isCompatibleTemplateSet(project.templateSetVersion)) {
    if ((LEGACY_TEMPLATE_SET_VERSIONS as readonly string[]).includes(project.templateSetVersion ?? "")) warnings.push(`PROJECT_UPGRADE_REQUIRED: legacy templateSetVersion ${project.templateSetVersion}`);
    else errors.push(`project.json: unsupported templateSetVersion ${String(project.templateSetVersion)}`);
  }
  if (!supportsProjectFormat(project)) warnings.push(`PROJECT_UPGRADE_REQUIRED: ${PROJECT_UPGRADE_INSTRUCTIONS}`);
  if (!project.project?.context || !["greenfield", "brownfield"].includes(project.project.context)) errors.push("project.json: project context must be greenfield or brownfield");
  if (!project.setup?.checkpoint) errors.push("project.json: setup checkpoint is required");
  if (!Array.isArray(project.setup?.artifactProgress)) errors.push("project.json: setup artifactProgress must be an array");
  if (project.setup?.status === "completed") {
    if (!isCommitRef(project.setup.commit)) errors.push("project.json: completed setup requires a commit SHA");
    if (project.setup.checkpoint !== "completed") errors.push("project.json: completed setup requires completed checkpoint");
    if (project.setup.operation != null) errors.push("project.json: completed setup cannot retain an operation journal");
  } else if (project.setup?.status !== "in_progress") errors.push(`project.json: invalid setup status ${project.setup?.status ?? "<missing>"}`);
  if (project.lastRefresh && !isCommitRef(project.lastRefresh.commit)) errors.push("project.json: lastRefresh requires a commit SHA");
  if (Object.hasOwn(project, "tracks")) errors.push("project.json: must not duplicate track records");
}
