import { asJsonObject, asStringArray, isRecord } from "../../../guards";
import type { JsonObject, RuntimeArgs, UnknownRecord } from "../../../types";

import { renderJsonCodeblock } from "./artifact-actions";
import type { CoreResult, ReviewFile } from "./contracts";
import { renderMarkdownDoc, withGeneratedMarker } from "./markdown-docs";
import {
  documentReviewPair,
  jsonReviewFile,
  plainReviewFile,
  textReviewFile,
} from "./review-bundles";
import type { SetupEvidenceStage } from "./setup-evidence";
import { renderSemanticProjection, renderTechStackMarkdown } from "./semantic-projections";
import { renderStyleGuideMarkdown } from "./spec-docs";
import { techStackForPacket } from "./tech-stack";
import { normalizeProjectDoc, templateJson } from "./workflow-response";

function projectDocumentPair(
  documentId: "product" | "product_guidelines" | "workflow",
  value: JsonObject,
  canonicalTitle: string,
  projectionTitle: string,
  renderTitle: string,
  source: string,
  filename: string,
): ReviewFile[] {
  const canonicalPath = `cadre/${filename}.json`;
  const projectionPath = `cadre/${filename}.md`;
  const canonicalContent = `${JSON.stringify(value, null, 2)}\n`;
  const schema = `cadre.${documentId}.v1`;
  return documentReviewPair(
    documentId,
    jsonReviewFile(canonicalPath, canonicalTitle, source, value),
    textReviewFile(
      projectionPath,
      projectionTitle,
      canonicalPath,
      withGeneratedMarker(
        canonicalPath,
        schema,
        renderSemanticProjection(schema, value, renderTitle, canonicalPath)
          || renderMarkdownDoc(value, renderTitle, canonicalPath),
        { canonicalContent, projection: projectionPath },
      ),
    ),
  );
}

function productFiles(args: RuntimeArgs): ReviewFile[] {
  const rawArgs = args as UnknownRecord;
  return projectDocumentPair(
    "product",
    normalizeProjectDoc("product", rawArgs.product, "product.json", "Product Context", "Project-Specific Product Notes"),
    "Product context canonical",
    "Product context",
    "Product Context",
    "product",
    "product",
  );
}

function productGuidelineFiles(args: RuntimeArgs): ReviewFile[] {
  const rawArgs = args as UnknownRecord;
  return projectDocumentPair(
    "product_guidelines",
    normalizeProjectDoc(
      "product_guidelines",
      rawArgs.productGuidelines || rawArgs.product_guidelines,
      "product_guidelines.json",
      "Product Guidelines",
      "Project-Specific Product Guideline Notes",
    ),
    "Product guidelines canonical",
    "Product guidelines",
    "Product Guidelines",
    "productGuidelines",
    "product_guidelines",
  );
}

export function styleGuideReviewFiles(styleGuides: CoreResult, generatedGuideIds?: string[]): ReviewFile[] {
  const selected = asStringArray(styleGuides.selected);
  const generated = new Set(generatedGuideIds || selected);
  const index: JsonObject = {
    version: 1,
    schema: "cadre.styleguide_index.v1",
    selected,
  };
  const indexContent = `${JSON.stringify(index, null, 2)}\n`;
  return [
    ...documentReviewPair(
      "styleguides",
      jsonReviewFile("cadre/styleguides/index.json", "Style guide catalog canonical", "tech-stack.json/styleGuideIds", index),
      textReviewFile(
        "cadre/styleguides/README.md",
        "Style guide catalog",
        "cadre/styleguides/index.json",
        withGeneratedMarker(
          "cadre/styleguides/index.json",
          "cadre.styleguide_index.v1",
          renderJsonCodeblock("Style guide catalog", index),
          { canonicalContent: indexContent, projection: "cadre/styleguides/README.md" },
        ),
      ),
      "styleguides",
    ),
    ...selected.filter((guideId) => generated.has(guideId)).flatMap((guideId) => {
      const guide = templateJson(`styleguides/${guideId}.json`, {
        version: 1,
        schema: "cadre.styleguide.v1",
        id: guideId,
        title: guideId,
        rules: [],
        source: "bundled_template",
      });
      const canonicalPath = `cadre/styleguides/${guideId}.json`;
      const projectionPath = `cadre/styleguides/${guideId}.md`;
      return documentReviewPair(
        "styleguides",
        jsonReviewFile(canonicalPath, `Code style guide canonical: ${guideId}`, "tech-stack.json/styleGuideIds", guide),
        textReviewFile(
          projectionPath,
          `Code style guide: ${guideId}`,
          canonicalPath,
          withGeneratedMarker(canonicalPath, "cadre.styleguide.v1", renderStyleGuideMarkdown(guide), {
            canonicalContent: `${JSON.stringify(guide, null, 2)}\n`,
            projection: projectionPath,
          }),
        ),
        "styleguides",
      );
    }),
  ];
}

function repositoryFiles(args: RuntimeArgs, polyrepoRequested: boolean): ReviewFile[] {
  if (!polyrepoRequested) return [];
  const rawArgs = args as UnknownRecord;
  const repos = isRecord(rawArgs.repos) ? asJsonObject(rawArgs.repos) : null;
  if (!repos) return [];
  const canonicalContent = `${JSON.stringify(repos, null, 2)}\n`;
  return documentReviewPair(
    "repos",
    jsonReviewFile("cadre/repos.json", "Polyrepo topology canonical", "repos", repos),
    textReviewFile(
      "cadre/repos.md",
      "Repository topology",
      "cadre/repos.json",
      withGeneratedMarker(
        "cadre/repos.json",
        "cadre.repos.v1",
        renderJsonCodeblock("Repository topology", repos),
        { canonicalContent, projection: "cadre/repos.md" },
      ),
    ),
  );
}

function technicalFiles(
  root: string,
  args: RuntimeArgs,
  styleGuides: CoreResult,
  polyrepoRequested: boolean,
  machineFiles: ReviewFile[],
): ReviewFile[] {
  const techStack = techStackForPacket(root, args);
  const projection = techStack || {};
  const canonicalContent = `${JSON.stringify(projection, null, 2)}\n`;
  return [
    ...documentReviewPair(
      "tech_stack",
      jsonReviewFile("cadre/tech-stack.json", "Structured tech stack", "techStack", techStack),
      textReviewFile(
        "cadre/tech-stack.md",
        "Tech stack",
        "cadre/tech-stack.json",
        withGeneratedMarker(
          "cadre/tech-stack.json",
          "cadre.tech_stack.v1",
          renderTechStackMarkdown(projection, "cadre/tech-stack.json"),
          { canonicalContent, projection: "cadre/tech-stack.md" },
        ),
      ),
    ),
    ...styleGuideReviewFiles(styleGuides),
    ...repositoryFiles(args, polyrepoRequested),
    ...machineFiles,
  ];
}

function workflowFiles(args: RuntimeArgs): ReviewFile[] {
  const rawArgs = args as UnknownRecord;
  return projectDocumentPair(
    "workflow",
    normalizeProjectDoc(
      "workflow",
      rawArgs.workflowPolicy || rawArgs.workflow_policy,
      "workflow.json",
      "Project Workflow",
      "Project-Specific Workflow Notes",
    ),
    "Workflow policy canonical",
    "Workflow policy",
    "Project Workflow",
    "workflowPolicy",
    "workflow",
  );
}

export function setupStageReviewFiles(
  root: string,
  args: RuntimeArgs,
  styleGuides: CoreResult,
  polyrepoRequested: boolean,
  stage: SetupEvidenceStage | null,
  technicalMachineFiles: ReviewFile[] = [],
): ReviewFile[] {
  if (stage === "product") return productFiles(args);
  if (stage === "product_guidelines") return productGuidelineFiles(args);
  if (stage === "technical") return technicalFiles(root, args, styleGuides, polyrepoRequested, technicalMachineFiles);
  if (stage === "workflow") return workflowFiles(args);
  return [];
}

export function setupFinalReviewFiles(
  generatedAt: string,
  machineFiles: ReviewFile[],
): ReviewFile[] {
  const seed = templateJson("patterns_seed.json", {
    id: "initial",
    kind: "patterns_seed",
    text: "# Codebase Patterns\n\nLast refreshed: YYYY-MM-DD\n",
  });
  const text = typeof seed.text === "string" ? seed.text : "# Codebase Patterns\n\nLast refreshed: YYYY-MM-DD\n";
  const entry: JsonObject = {
    ...seed,
    id: "initial",
    kind: "patterns_seed",
    recorded_at: generatedAt,
    text,
  };
  const canonicalContent = `${JSON.stringify(entry)}\n`;
  return [
    ...documentReviewPair(
      "patterns",
      plainReviewFile("cadre/patterns.jsonl", "Project patterns canonical", "template:patterns_seed.json", canonicalContent),
      textReviewFile(
        "cadre/patterns.md",
        "Project patterns",
        "cadre/patterns.jsonl",
        withGeneratedMarker("cadre/patterns.jsonl", "cadre.patterns.v1", text, {
          canonicalContent,
          projection: "cadre/patterns.md",
        }),
      ),
      undefined,
      "generated",
    ),
    ...machineFiles,
  ];
}
