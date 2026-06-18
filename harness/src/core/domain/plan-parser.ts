import type { JsonObject, ParsedPlan, PlanPhase, PlanTask } from "../../types";

function parseAnnotation(line: string): { key: string; value: string } | null {
  const match = line.match(/<!--\s*([a-zA-Z0-9_-]+)\s*:\s*([\s\S]*?)\s*-->/);
  if (!match?.[1] || match[2] === undefined) return null;
  return { key: match[1], value: match[2].trim() };
}

function extractCommitRefs(text: unknown): { commit_shas: string[]; repo_shas: JsonObject } {
  const value = String(text || "");
  const commitShas: string[] = [];
  const repoShas: JsonObject = {};
  const repoPattern = /\b([A-Za-z0-9_.-]+):([0-9a-f]{7,40})\b/g;
  let match: RegExpExecArray | null;
  while ((match = repoPattern.exec(value))) {
    if (!match[1] || !match[2]) continue;
    repoShas[match[1]] = match[2];
    commitShas.push(match[2]);
  }
  const shaPattern = /\b(?:commit[:\s]+|sha[:\s]+)?([0-9a-f]{7,40})\b/gi;
  while ((match = shaPattern.exec(value))) {
    if (match[1] && !commitShas.includes(match[1])) commitShas.push(match[1]);
  }
  return { commit_shas: commitShas, repo_shas: repoShas };
}

export function parsePlanText(text: string): ParsedPlan {
  const phases: PlanPhase[] = [];
  let currentPhase: PlanPhase | null = null;
  let currentTask: PlanTask | null = null;

  const ensurePhase = () => {
    if (!currentPhase) {
      currentPhase = { title: "Unsectioned", annotations: {}, tasks: [], phase_index: phases.length + 1 };
      phases.push(currentPhase);
    }
    return currentPhase;
  };

  text.split(/\r?\n/).forEach((line, index) => {
    const phaseMatch = line.match(/^##+\s+(.+?)\s*$/);
    if (phaseMatch?.[1]) {
      currentPhase = {
        title: phaseMatch[1].trim(),
        annotations: {},
        tasks: [],
        line: index + 1,
        phase_index: phases.length + 1,
      };
      phases.push(currentPhase);
      currentTask = null;
      return;
    }

    const taskMatch = line.match(/^\s*-\s+\[([ x~!\-])\]\s+(.+?)\s*$/);
    if (taskMatch?.[1] && taskMatch[2]) {
      const phase = ensurePhase();
      const taskIndex = phase.tasks.length + 1;
      const title = taskMatch[2].trim();
      const refs = extractCommitRefs(title);
      currentTask = {
        marker: taskMatch[1],
        title,
        annotations: {},
        files: [],
        depends: [],
        repo: null,
        line: index + 1,
        phase_index: phase.phase_index || phases.indexOf(phase) + 1,
        task_index: taskIndex,
        task_key: `phase${phase.phase_index || phases.indexOf(phase) + 1}_task${taskIndex}`,
        commit_shas: refs.commit_shas,
        repo_shas: refs.repo_shas,
      };
      phase.tasks.push(currentTask);
      return;
    }

    const annotation = parseAnnotation(line);
    if (!annotation) return;
    const target = currentTask || ensurePhase();
    target.annotations = target.annotations || {};
    target.annotations[annotation.key] = annotation.value;
    if (currentTask) {
      if (annotation.key === "files") {
        currentTask.files = annotation.value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (annotation.key === "depends") {
        currentTask.depends = annotation.value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      } else if (annotation.key === "repo") {
        currentTask.repo = annotation.value;
      } else if (["commit", "commits", "sha", "shas"].includes(annotation.key)) {
        const refs = extractCommitRefs(annotation.value);
        currentTask.commit_shas = Array.from(new Set([...(currentTask.commit_shas ?? []), ...refs.commit_shas]));
        currentTask.repo_shas = { ...currentTask.repo_shas, ...refs.repo_shas };
      }
    }
  });

  const tasks = phases.flatMap((phase) => phase.tasks);
  return { ok: true, phases, tasks, warnings: [], errors: [] };
}
