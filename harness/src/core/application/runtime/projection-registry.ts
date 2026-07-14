import type { ArtifactDefinition, ProjectionIntent } from "./contracts";

export interface ProjectionRegistryEntry {
  intent: ProjectionIntent;
  title: string;
  canonical: string;
  projection: string;
  schema: string;
  scope: ArtifactDefinition["scope"];
  sourceFormat: ArtifactDefinition["sourceFormat"];
  reviewRole: NonNullable<ArtifactDefinition["reviewRole"]>;
}

export interface ProjectionPathParameters {
  id?: string;
  trackId?: string;
  version?: string;
  archived?: boolean;
}

export const PROJECTION_REGISTRY: readonly ProjectionRegistryEntry[] = [
  { intent: "product", title: "Product context", canonical: "cadre/product.json", projection: "cadre/product.md", schema: "cadre.product.v1", scope: "project", sourceFormat: "json", reviewRole: "document" },
  { intent: "product-guidelines", title: "Product guidelines", canonical: "cadre/product_guidelines.json", projection: "cadre/product_guidelines.md", schema: "cadre.product_guidelines.v1", scope: "project", sourceFormat: "json", reviewRole: "document" },
  { intent: "tech-stack", title: "Tech stack", canonical: "cadre/tech-stack.json", projection: "cadre/tech-stack.md", schema: "cadre.tech_stack.v1", scope: "project", sourceFormat: "json", reviewRole: "document" },
  { intent: "workflow", title: "Workflow policy", canonical: "cadre/workflow.json", projection: "cadre/workflow.md", schema: "cadre.workflow.v1", scope: "project", sourceFormat: "json", reviewRole: "document" },
  { intent: "repository-topology", title: "Repository topology", canonical: "cadre/repos.json", projection: "cadre/repos.md", schema: "cadre.repos.v1", scope: "project", sourceFormat: "json", reviewRole: "document" },
  { intent: "patterns", title: "Project patterns", canonical: "cadre/patterns.jsonl", projection: "cadre/patterns.md", schema: "cadre.patterns.v1", scope: "project", sourceFormat: "jsonl", reviewRole: "generated" },
  { intent: "styleguide-catalog", title: "Style guide catalog", canonical: "cadre/styleguides/index.json", projection: "cadre/styleguides/README.md", schema: "cadre.styleguide_index.v1", scope: "styleguide", sourceFormat: "json", reviewRole: "document" },
  { intent: "styleguide", title: "Style guide", canonical: "cadre/styleguides/{id}.json", projection: "cadre/styleguides/{id}.md", schema: "cadre.styleguide.v1", scope: "styleguide", sourceFormat: "json", reviewRole: "document" },
  { intent: "track-specification", title: "Track specification", canonical: "cadre/tracks/{trackId}/spec.json", projection: "cadre/tracks/{trackId}/spec.md", schema: "cadre.spec.v1", scope: "track", sourceFormat: "json", reviewRole: "document" },
  { intent: "track-plan", title: "Track plan", canonical: "cadre/tracks/{trackId}/plan.json", projection: "cadre/tracks/{trackId}/plan.md", schema: "cadre.plan.v1", scope: "track", sourceFormat: "json", reviewRole: "document" },
  { intent: "track-learnings", title: "Track learnings", canonical: "cadre/tracks/{trackId}/learnings.jsonl", projection: "cadre/tracks/{trackId}/learnings.md", schema: "cadre.learnings.v1", scope: "track", sourceFormat: "jsonl", reviewRole: "generated" },
  { intent: "track-handoff", title: "Track handoff", canonical: "cadre/tracks/{trackId}/handoff.json", projection: "cadre/tracks/{trackId}/HANDOFF.md", schema: "cadre.handoff.v1", scope: "track", sourceFormat: "json", reviewRole: "document" },
  { intent: "release", title: "Release", canonical: "cadre/releases/{version}.json", projection: "cadre/releases/{version}.md", schema: "cadre.release.v1", scope: "release", sourceFormat: "json", reviewRole: "document" },
  { intent: "project-skill", title: "Project skill", canonical: "cadre/skills/{id}/skill.json", projection: "cadre/skills/{id}/SKILL.md", schema: "cadre.project-skill.v1", scope: "skill", sourceFormat: "json", reviewRole: "document" },
] as const;

export function projectionRegistration(intent: ProjectionIntent): ProjectionRegistryEntry {
  const registration = PROJECTION_REGISTRY.find((entry) => entry.intent === intent);
  if (!registration) throw new Error(`Unknown projection intent: ${intent}`);
  return registration;
}

function resolveTemplate(template: string, parameters: ProjectionPathParameters): string {
  const replacements: Record<string, string | undefined> = {
    id: parameters.id,
    trackId: parameters.trackId,
    version: parameters.version,
  };
  let resolved = template;
  for (const [key, value] of Object.entries(replacements)) {
    if (!resolved.includes(`{${key}}`)) continue;
    if (!value) throw new Error(`Projection path parameter ${key} is required for ${template}`);
    resolved = resolved.replaceAll(`{${key}}`, value);
  }
  if (parameters.archived && parameters.trackId) {
    resolved = resolved.replace(`cadre/tracks/${parameters.trackId}/`, `cadre/archive/${parameters.trackId}/`);
  }
  return resolved;
}

export function projectionDefinition(
  intent: ProjectionIntent,
  id: string,
  parameters: ProjectionPathParameters = {},
  title?: string,
): ArtifactDefinition {
  const registration = projectionRegistration(intent);
  return {
    id,
    title: title || registration.title,
    canonical: resolveTemplate(registration.canonical, parameters),
    projection: resolveTemplate(registration.projection, parameters),
    schema: registration.schema,
    scope: registration.scope,
    sourceFormat: registration.sourceFormat,
    projectionFormat: "markdown",
    reviewRole: registration.reviewRole,
    projectionIntent: intent,
  };
}
