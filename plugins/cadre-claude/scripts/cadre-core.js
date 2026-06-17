#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const STATUS_MARKERS = {
  new: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  blocked: "[!]",
  skipped: "[-]",
};

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch (_) {
    return false;
  }
}

function gitIdentity(root) {
  for (const key of ["user.email", "user.name"]) {
    const result = spawnSync("git", ["config", key], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  return null;
}

function loadTopology(root) {
  const reposPath = path.join(root, "cadre", "repos.json");
  const configPath = path.join(root, "cadre", "config.json");
  const repos = readJson(reposPath, null);
  const config = readJson(configPath, {});
  const polyrepo = Boolean(repos && repos.mode === "polyrepo");
  return {
    polyrepo,
    repos,
    config,
    defaultRepo: polyrepo ? repos.default_repo : ".",
  };
}

function listTrackDirs(root) {
  const tracksDir = path.join(root, "cadre", "tracks");
  if (!fileExists(tracksDir)) return [];
  return fs
    .readdirSync(tracksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tracksDir, entry.name))
    .sort();
}

function listTracks(root) {
  return listTrackDirs(root)
    .map((dir) => {
      const metadataPath = path.join(dir, "metadata.json");
      const metadata = readJson(metadataPath, null);
      if (!metadata) return null;
      const trackId = metadata.track_id || path.basename(dir);
      return {
        track_id: trackId,
        dir,
        metadata_path: metadataPath,
        plan_path: path.join(dir, "plan.md"),
        spec_path: path.join(dir, "spec.md"),
        metadata,
      };
    })
    .filter(Boolean);
}

function parseAnnotation(line) {
  const match = line.match(/<!--\s*([a-zA-Z0-9_-]+)\s*:\s*([\s\S]*?)\s*-->/);
  if (!match) return null;
  return { key: match[1], value: match[2].trim() };
}

function parsePlanText(text) {
  const phases = [];
  let currentPhase = null;
  let currentTask = null;

  const ensurePhase = () => {
    if (!currentPhase) {
      currentPhase = { title: "Unsectioned", annotations: {}, tasks: [] };
      phases.push(currentPhase);
    }
    return currentPhase;
  };

  text.split(/\r?\n/).forEach((line, index) => {
    const phaseMatch = line.match(/^##+\s+(.+?)\s*$/);
    if (phaseMatch) {
      currentPhase = {
        title: phaseMatch[1].trim(),
        annotations: {},
        tasks: [],
        line: index + 1,
      };
      phases.push(currentPhase);
      currentTask = null;
      return;
    }

    const taskMatch = line.match(/^\s*-\s+\[([ x~!\-])\]\s+(.+?)\s*$/);
    if (taskMatch) {
      const phase = ensurePhase();
      currentTask = {
        marker: taskMatch[1],
        title: taskMatch[2].trim(),
        annotations: {},
        files: [],
        depends: [],
        repo: null,
        line: index + 1,
      };
      phase.tasks.push(currentTask);
      return;
    }

    const annotation = parseAnnotation(line);
    if (!annotation) return;
    const target = currentTask || ensurePhase();
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
      }
    }
  });

  return { phases };
}

function parsePlanFile(file) {
  if (!fileExists(file)) return { phases: [] };
  return parsePlanText(fs.readFileSync(file, "utf8"));
}

function planClaims(root, track, topology = loadTopology(root)) {
  const plan = parsePlanFile(track.plan_path);
  const claims = [];
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      const repo = topology.polyrepo
        ? task.repo || topology.defaultRepo
        : ".";
      for (const file of task.files) {
        claims.push({
          track_id: track.track_id,
          owner: track.metadata.owner || null,
          repo,
          file,
          phase: phase.title,
          task: task.title,
          task_line: task.line,
        });
      }
    }
  }
  return claims;
}

function collisionScan(root) {
  const topology = loadTopology(root);
  const active = listTracks(root).filter((track) =>
    ["in_progress", "blocked"].includes(track.metadata.status || "new")
  );
  const groups = new Map();
  for (const track of active) {
    for (const claim of planClaims(root, track, topology)) {
      const key = `${claim.repo}\u0000${claim.file}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(claim);
    }
  }

  const collisions = [];
  for (const [key, claims] of groups.entries()) {
    const trackIds = new Set(claims.map((claim) => claim.track_id));
    if (trackIds.size < 2) continue;
    const [repo, file] = key.split("\u0000");
    collisions.push({
      repo,
      file,
      claims,
      track_ids: Array.from(trackIds).sort(),
      owners: Array.from(new Set(claims.map((claim) => claim.owner).filter(Boolean))).sort(),
    });
  }
  collisions.sort((a, b) => (a.repo + a.file).localeCompare(b.repo + b.file));
  return {
    root,
    active_tracks: active.length,
    collisions,
  };
}

function teamStatus(root) {
  const tracks = listTracks(root);
  const byOwner = new Map();
  const byStatus = new Map();
  for (const track of tracks) {
    const owner = track.metadata.owner || "(unowned)";
    const status = track.metadata.status || "new";
    byOwner.set(owner, (byOwner.get(owner) || 0) + 1);
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }
  return {
    root,
    identity: gitIdentity(root),
    total_tracks: tracks.length,
    by_owner: Object.fromEntries(Array.from(byOwner.entries()).sort()),
    by_status: Object.fromEntries(Array.from(byStatus.entries()).sort()),
    tracks: tracks.map((track) => ({
      track_id: track.track_id,
      status: track.metadata.status || "new",
      owner: track.metadata.owner || null,
      reviewer: track.metadata.reviewer || null,
      review_verdict: track.metadata.review ? track.metadata.review.verdict : null,
    })),
  };
}

function availableWork(root) {
  const tracks = listTracks(root);
  const byId = new Map(tracks.map((track) => [track.track_id, track]));
  const available = [];
  for (const track of tracks) {
    const status = track.metadata.status || "new";
    const owner = track.metadata.owner || null;
    const deps = Array.isArray(track.metadata.depends_on)
      ? track.metadata.depends_on
      : [];
    const depsMet = deps.every((dep) => {
      const depTrack = byId.get(dep);
      return depTrack && depTrack.metadata.status === "completed";
    });
    if (status === "new" && !owner && depsMet) {
      available.push({
        track_id: track.track_id,
        priority: track.metadata.priority || "medium",
        description: track.metadata.description || track.metadata.name || track.track_id,
      });
    }
  }
  return { root, available };
}

function reviewGate(root, trackId) {
  const track = listTracks(root).find((item) => item.track_id === trackId);
  if (!track) {
    return { ok: false, track_id: trackId, reasons: [`Track not found: ${trackId}`] };
  }
  const config = loadTopology(root).config || {};
  const review = track.metadata.review || null;
  const reasons = [];
  const warnings = [];
  if (!review) {
    reasons.push("No recorded review verdict");
  } else {
    if (review.verdict !== "approved") {
      reasons.push(`Review verdict is ${review.verdict || "absent"}`);
    }
    if ((review.blocking_count || 0) > 0) {
      reasons.push(`Review has ${review.blocking_count} blocking finding(s)`);
    }
    if (config.require_second_reviewer === true && review.self_reviewed === true) {
      reasons.push("Self-review is not sufficient when require_second_reviewer is true");
    }
    if (!review.reviewed_sha) {
      warnings.push("Review does not record reviewed_sha; branch-advance guard is skipped for older reviews");
    }
  }
  return {
    ok: reasons.length === 0,
    track_id: track.track_id,
    review,
    reasons,
    warnings,
  };
}

function polyrepoPreflight(root) {
  const topology = loadTopology(root);
  if (!topology.polyrepo) {
    return { ok: true, polyrepo: false, checks: ["monorepo mode"] };
  }
  const checks = [];
  const errors = [];
  const gitmodules = path.join(root, ".gitmodules");
  for (const repo of topology.repos.repos || []) {
    if (repo.enabled === false) continue;
    const repoPath = path.join(root, repo.submodule_path || "");
    if (!repo.name) errors.push("repo entry missing name");
    if (!repo.submodule_path) errors.push(`repo ${repo.name || "?"} missing submodule_path`);
    if (repo.submodule_path && !fileExists(repoPath)) {
      errors.push(`repo ${repo.name} path is missing: ${repo.submodule_path}`);
    }
    if (fileExists(gitmodules) && repo.name) {
      const result = spawnSync(
        "git",
        ["config", "-f", ".gitmodules", "--get", `submodule.${repo.name}.path`],
        { cwd: root, encoding: "utf8" }
      );
      if (result.status === 0 && result.stdout.trim() !== repo.submodule_path) {
        errors.push(
          `repo ${repo.name} submodule_path mismatch: repos.json=${repo.submodule_path}, .gitmodules=${result.stdout.trim()}`
        );
      }
    }
    checks.push(repo.name);
  }
  return { ok: errors.length === 0, polyrepo: true, checks, errors };
}

function regenIndex(root) {
  const candidates = [
    path.join(root, "templates", "scripts", "cadre-regen-index.sh"),
    path.join(__dirname, "..", "templates", "scripts", "cadre-regen-index.sh"),
    path.join(__dirname, "..", "skills", "cadre", "templates", "scripts", "cadre-regen-index.sh"),
  ];
  const script = candidates.find(fileExists);
  if (!fileExists(script)) {
    return {
      ok: false,
      error: "Missing helper script: cadre-regen-index.sh",
      checked: candidates,
    };
  }
  const result = spawnSync("bash", [script, root], { cwd: root, encoding: "utf8" });
  return {
    ok: result.status === 0,
    status: result.status,
    script,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

module.exports = {
  STATUS_MARKERS,
  availableWork,
  collisionScan,
  gitIdentity,
  listTracks,
  loadTopology,
  parsePlanFile,
  parsePlanText,
  planClaims,
  polyrepoPreflight,
  regenIndex,
  reviewGate,
  teamStatus,
};
