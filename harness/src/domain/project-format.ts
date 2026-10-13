import { CadreError } from "./errors.js";
import { CADRE_RUNTIME_VERSION, TEMPLATE_SET_VERSION, isCompatibleRuntimeVersion, isCompatibleTemplateSet } from "./version.js";

export interface ProjectFormat { schemaVersion?: unknown; runtimeVersion?: unknown; templateSetVersion?: unknown }

export const PROJECT_UPGRADE_INSTRUCTIONS = "Install cadre-ai@3.9.0 and run cadre-ai install --target all --scope user; reload your client. Complete or reconcile interrupted operations, then use Cadre refresh in 3.9.0 for an explicitly approved migration to template v5 and schema-2 project/active-track state at a quiescent boundary. Preserve historical evidence and explicitly choose any required approval-policy migration. Then install cadre-ai@4.0.0, run cadre-ai install --target all --scope user, reload your client, and continue. Do not edit version labels or approval records by hand.";

/** One admission rule shared by status, diagnostics and mutation boundaries. */
export function supportsProjectFormat(project: ProjectFormat | null | undefined): boolean {
  return project?.schemaVersion === 2 && isCompatibleRuntimeVersion(project.runtimeVersion)
    && isCompatibleTemplateSet(project.templateSetVersion);
}

export function requireSupportedProjectFormat(project: ProjectFormat | null | undefined): void {
  if (supportsProjectFormat(project)) return;
  throw new CadreError("PROJECT_UPGRADE_REQUIRED",
    `This project format is not supported for mutation by Cadre ${CADRE_RUNTIME_VERSION}. ${PROJECT_UPGRADE_INSTRUCTIONS}`,
    { currentRuntimeVersion: project?.runtimeVersion ?? null, currentTemplateSetVersion: project?.templateSetVersion ?? null,
      currentSchemaVersion: project?.schemaVersion ?? null, targetRuntimeVersion: CADRE_RUNTIME_VERSION,
      targetTemplateSetVersion: TEMPLATE_SET_VERSION, upgradeInstructions: PROJECT_UPGRADE_INSTRUCTIONS });
}
