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
const VALID_STATUSES = new Set(Object.keys(STATUS_MARKERS));
const STALE_LEASE_MS = 30 * 60 * 1000;

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
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

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: options.shell === true,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    command: [command, ...args].join(" "),
  };
}

function commandExists(command, cwd) {
  const result = spawnSync("sh", ["-lc", `command -v '${String(command).replace(/'/g, "'\\''")}'`], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0;
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

function parseIsoTime(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function staleInfo(value, now = Date.now()) {
  const time = parseIsoTime(value);
  if (!time) return { stale: false, age_minutes: null };
  const ageMs = Math.max(0, now - time);
  return {
    stale: ageMs > STALE_LEASE_MS,
    age_minutes: Math.floor(ageMs / 60000),
  };
}

function workStateForTrack(track) {
  const statePath = path.join(track.dir, "implement_state.json");
  return readJson(statePath, null);
}

function holdInfo(track, now = Date.now()) {
  const state = workStateForTrack(track);
  const lease = track.metadata.lease || null;
  const stateOwner = state && state.owner ? state.owner : null;
  const owner = stateOwner || track.metadata.owner || null;
  const leaseOwner = lease && lease.owner ? lease.owner : null;
  const leaseTime = lease && (lease.heartbeat_at || lease.acquired_at);
  const stateTime = state && (state.last_updated || state.last_handoff);
  const leaseStale = staleInfo(leaseTime, now);
  const stateStale = staleInfo(stateTime, now);
  return {
    owner,
    metadata_owner: track.metadata.owner || null,
    state_owner: stateOwner,
    lease_owner: leaseOwner,
    lease_heartbeat_at: leaseTime || null,
    lease_stale: lease ? leaseStale.stale : false,
    lease_age_minutes: leaseStale.age_minutes,
    state_last_updated: stateTime || null,
    state_stale: state ? stateStale.stale : false,
    state_age_minutes: stateStale.age_minutes,
  };
}

function taskCounts(plan) {
  const counts = { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0, skipped: 0 };
  for (const phase of plan.phases || []) {
    for (const task of phase.tasks || []) {
      counts.total += 1;
      if (task.marker === "x") counts.completed += 1;
      else if (task.marker === "~") counts.in_progress += 1;
      else if (task.marker === "!") counts.blocked += 1;
      else if (task.marker === "-") counts.skipped += 1;
      else counts.pending += 1;
    }
  }
  counts.percent = counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100);
  return counts;
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

function extractCommitRefs(text) {
  const value = String(text || "");
  const commitShas = [];
  const repoShas = {};
  const repoPattern = /\b([A-Za-z0-9_.-]+):([0-9a-f]{7,40})\b/g;
  let match;
  while ((match = repoPattern.exec(value))) {
    repoShas[match[1]] = match[2];
    commitShas.push(match[2]);
  }
  const shaPattern = /\b(?:commit[:\s]+|sha[:\s]+)?([0-9a-f]{7,40})\b/gi;
  while ((match = shaPattern.exec(value))) {
    if (!commitShas.includes(match[1])) commitShas.push(match[1]);
  }
  return { commit_shas: commitShas, repo_shas: repoShas };
}

function parsePlanText(text) {
  const phases = [];
  let currentPhase = null;
  let currentTask = null;

  const ensurePhase = () => {
    if (!currentPhase) {
      currentPhase = { title: "Unsectioned", annotations: {}, tasks: [], phase_index: phases.length + 1 };
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
        phase_index: phases.length + 1,
      };
      phases.push(currentPhase);
      currentTask = null;
      return;
    }

    const taskMatch = line.match(/^\s*-\s+\[([ x~!\-])\]\s+(.+?)\s*$/);
    if (taskMatch) {
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
        currentTask.commit_shas = Array.from(new Set([...currentTask.commit_shas, ...refs.commit_shas]));
        currentTask.repo_shas = { ...currentTask.repo_shas, ...refs.repo_shas };
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

function normalizeClaimPath(file) {
  return String(file || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

function globToRegExp(glob) {
  const normalized = normalizeClaimPath(glob);
  let out = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      i += 1;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else if ("\\^$+?.()|{}[]".includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`${out}$`);
}

function isGlobClaim(file) {
  return /[*?]/.test(file);
}

function claimsOverlap(leftFile, rightFile) {
  const left = normalizeClaimPath(leftFile);
  const right = normalizeClaimPath(rightFile);
  if (!left || !right) return false;
  if (left === right) return true;
  if (right.startsWith(`${left}/`) || left.startsWith(`${right}/`)) return true;
  if (isGlobClaim(left) && globToRegExp(left).test(right)) return true;
  if (isGlobClaim(right) && globToRegExp(right).test(left)) return true;
  return false;
}

function collisionScan(root) {
  const topology = loadTopology(root);
  const active = listTracks(root).filter((track) =>
    ["new", "in_progress", "blocked"].includes(track.metadata.status || "new")
  );
  const claims = [];
  for (const track of active) {
    for (const claim of planClaims(root, track, topology)) {
      claims.push({
        ...claim,
        file: normalizeClaimPath(claim.file),
      });
    }
  }

  const collisions = [];
  const seen = new Set();
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const left = claims[i];
      const right = claims[j];
      if (left.track_id === right.track_id) continue;
      if (left.repo !== right.repo) continue;
      if (!claimsOverlap(left.file, right.file)) continue;
      const trackIds = [left.track_id, right.track_id].sort();
      const files = [left.file, right.file].sort();
      const key = `${left.repo}\u0000${trackIds.join("\u0000")}\u0000${files.join("\u0000")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const collisionClaims = [left, right];
      collisions.push({
        repo: left.repo,
        file: left.file === right.file ? left.file : `${left.file} <-> ${right.file}`,
        kind: left.file === right.file ? "exact" : "overlap",
        claims: collisionClaims,
        track_ids: trackIds,
        owners: Array.from(new Set(collisionClaims.map((claim) => claim.owner).filter(Boolean))).sort(),
      });
    }
  }
  collisions.sort((a, b) => (a.repo + a.file).localeCompare(b.repo + b.file));
  return {
    root,
    active_tracks: active.length,
    collisions,
  };
}

function liveStatus(root) {
  const tracks = listTracks(root);
  const identity = gitIdentity(root);
  const byStatus = new Map();
  const activeTracks = [];
  for (const track of tracks) {
    const status = track.metadata.status || "new";
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    if (status === "in_progress") {
      const plan = parsePlanFile(track.plan_path);
      activeTracks.push({
        track_id: track.track_id,
        name: track.metadata.name || track.metadata.description || track.track_id,
        owner: track.metadata.owner || null,
        git_branch: track.metadata.git_branch || `track/${track.track_id}`,
        task_counts: taskCounts(plan),
      });
    }
  }
  return {
    root,
    identity,
    total_tracks: tracks.length,
    by_status: Object.fromEntries(Array.from(byStatus.entries()).sort()),
    active_tracks: activeTracks,
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
      name: track.metadata.name || track.metadata.description || track.track_id,
      priority: track.metadata.priority || "medium",
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
  const reclaimable = [];
  const now = Date.now();
  for (const track of tracks) {
    const status = track.metadata.status || "new";
    const owner = track.metadata.owner || null;
    const hold = holdInfo(track, now);
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
    const heldBy = hold.lease_owner || hold.owner;
    const stale = hold.lease_stale || hold.state_stale;
    if (depsMet && heldBy && stale && ["new", "in_progress", "blocked"].includes(status)) {
      reclaimable.push({
        track_id: track.track_id,
        status,
        priority: track.metadata.priority || "medium",
        description: track.metadata.description || track.metadata.name || track.track_id,
        held_by: heldBy,
        lease_age_minutes: hold.lease_age_minutes,
        state_age_minutes: hold.state_age_minutes,
      });
    }
  }
  return { root, available, reclaimable };
}

function findTrack(root, trackId) {
  return listTracks(root).find((item) => item.track_id === trackId) || null;
}

function trackContext(root, trackId) {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  const topology = loadTopology(root);
  const plan = parsePlanFile(track.plan_path);
  const hold = holdInfo(track);
  const worktrees = [];
  if (track.metadata.worktree_path) {
    const abs = path.resolve(root, track.metadata.worktree_path);
    worktrees.push({
      repo: ".",
      path: track.metadata.worktree_path,
      exists: fileExists(abs),
      git_branch: track.metadata.git_branch || `track/${track.track_id}`,
    });
  }
  if (track.metadata.repos && typeof track.metadata.repos === "object") {
    for (const [repo, info] of Object.entries(track.metadata.repos)) {
      const submodulePath = info.submodule_path || "";
      const worktreePath = info.worktree_path || "";
      worktrees.push({
        repo,
        submodule_path: submodulePath,
        path: worktreePath,
        exists: worktreePath ? fileExists(path.resolve(root, worktreePath)) : false,
        git_branch: info.git_branch || `track/${track.track_id}`,
        base_branch: info.base_branch || "main",
      });
    }
  }
  return {
    ok: true,
    root,
    topology: {
      polyrepo: topology.polyrepo,
      default_repo: topology.defaultRepo,
      sync_mode: topology.config.sync_mode || "local",
    },
    track: {
      track_id: track.track_id,
      status: track.metadata.status || "new",
      name: track.metadata.name || track.metadata.description || track.track_id,
      priority: track.metadata.priority || "medium",
      owner: track.metadata.owner || null,
      reviewer: track.metadata.reviewer || null,
      git_branch: track.metadata.git_branch || `track/${track.track_id}`,
      metadata_path: path.relative(root, track.metadata_path),
      plan_path: path.relative(root, track.plan_path),
      spec_path: path.relative(root, track.spec_path),
      beads_epic: track.metadata.beads_epic || null,
      beads_tasks: track.metadata.beads_tasks || {},
      review: track.metadata.review || null,
      last_coverage: track.metadata.last_coverage ?? null,
    },
    hold,
    task_counts: taskCounts(plan),
    plan,
    worktrees,
  };
}

function planIntegrity(root, trackId = null) {
  const topology = loadTopology(root);
  const tracks = trackId ? [findTrack(root, trackId)].filter(Boolean) : listTracks(root);
  if (trackId && tracks.length === 0) return { ok: false, error: `Track not found: ${trackId}` };
  const errors = [];
  const warnings = [];
  for (const track of tracks) {
    const plan = parsePlanFile(track.plan_path);
    const seenKeys = new Set();
    for (const phase of plan.phases || []) {
      const execution = phase.annotations.execution || "sequential";
      const claimedFiles = new Set();
      for (const task of phase.tasks || []) {
        if (seenKeys.has(task.task_key)) {
          errors.push({ track_id: track.track_id, line: task.line, message: `Duplicate task key ${task.task_key}` });
        }
        seenKeys.add(task.task_key);
        if (!task.files || task.files.length === 0) {
          warnings.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: "Missing <!-- files: ... --> annotation" });
        }
        if (topology.polyrepo && !task.repo && !topology.defaultRepo) {
          errors.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: "Task has no repo annotation and repos.json has no default_repo" });
        }
        for (const dep of task.depends || []) {
          if (!/^task\d+$|^phase\d+_task\d+$/.test(dep)) {
            warnings.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: `Unrecognized dependency reference ${dep}` });
          }
        }
        if (execution === "parallel") {
          for (const file of task.files || []) {
            const normalized = `${task.repo || topology.defaultRepo || "."}:${normalizeClaimPath(file)}`;
            if (claimedFiles.has(normalized)) {
              warnings.push({ track_id: track.track_id, line: task.line, task_key: task.task_key, message: `Parallel phase repeats file claim ${normalized}` });
            }
            claimedFiles.add(normalized);
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, root, checked_tracks: tracks.length, errors, warnings };
}

function reviewGate(root, trackId, options = {}) {
  const track = listTracks(root).find((item) => item.track_id === trackId);
  if (!track) {
    return { ok: false, track_id: trackId, reasons: [`Track not found: ${trackId}`] };
  }
  const config = loadTopology(root).config || {};
  const review = track.metadata.review || null;
  const reasons = [];
  const warnings = [];
  if (!review) {
    if (config.allow_unreviewed_ship === true) {
      warnings.push("No recorded review verdict; allowed by config.allow_unreviewed_ship");
    } else {
      reasons.push("No recorded review verdict");
    }
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
      if (config.allow_unpinned_review_ship === true) {
        warnings.push("Review does not record reviewed_sha; allowed by config.allow_unpinned_review_ship");
      } else {
        reasons.push("Review does not record reviewed_sha");
      }
    } else if (options.headSha && options.headSha !== review.reviewed_sha) {
      reasons.push(`Head ${options.headSha} differs from reviewed_sha ${review.reviewed_sha}; re-review required`);
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

function claimTrack(root, trackId, options = {}) {
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };
  const identity = options.identity || gitIdentity(root);
  if (!identity) return { ok: false, error: "No git identity found for claim" };
  const now = utcNow();
  const hold = holdInfo(track);
  const heldBy = hold.lease_owner || hold.owner;
  const stale = hold.lease_stale || hold.state_stale || !heldBy || heldBy === identity;
  if (heldBy && heldBy !== identity && !stale && options.takeover !== true) {
    return { ok: false, claimed: false, reason: "foreign-held", held_by: heldBy, hold };
  }

  const commands = [];
  if (track.metadata.beads_epic) {
    if (!commandExists("bd", root)) {
      return { ok: false, claimed: false, error: "Beads CLI (bd) is required but was not found" };
    }
    const escapedIdentity = identity.replace(/'/g, "''");
    const escapedEpic = String(track.metadata.beads_epic).replace(/'/g, "''");
    const sql =
      `UPDATE issues SET assignee='${escapedIdentity}' ` +
      `WHERE id='${escapedEpic}' AND (` +
      `assignee IS NULL OR assignee='' OR assignee='${escapedIdentity}' ` +
      `OR updated_at < datetime('now','-30 minutes'))`;
    commands.push(runCommand("bd", ["sql", sql], { cwd: root }));
    const last = commands[commands.length - 1];
    if (!last.ok) return { ok: false, claimed: false, error: "Beads claim failed", commands };
  }

  const metadata = { ...track.metadata, owner: identity };
  const topology = loadTopology(root);
  if (topology.config.sync_mode === "shared") {
    metadata.lease = {
      ...(metadata.lease || {}),
      owner: identity,
      acquired_at: metadata.lease && metadata.lease.owner === identity ? metadata.lease.acquired_at || now : now,
      heartbeat_at: now,
    };
  }
  writeJson(track.metadata_path, metadata);
  const statePath = path.join(track.dir, "implement_state.json");
  writeJson(statePath, {
    status: "starting",
    owner: identity,
    track_id: track.track_id,
    last_updated: now,
  });
  return {
    ok: true,
    claimed: true,
    track_id: track.track_id,
    owner: identity,
    previous_hold: hold,
    commands,
  };
}

function setTrackStatus(root, trackId, status) {
  if (!VALID_STATUSES.has(status)) {
    return {
      ok: false,
      error: `Invalid status: ${status}`,
      valid_statuses: Array.from(VALID_STATUSES),
    };
  }
  const track = listTracks(root).find((item) => item.track_id === trackId);
  if (!track) {
    return { ok: false, error: `Track not found: ${trackId}` };
  }
  const metadata = { ...track.metadata, status };
  writeJson(track.metadata_path, metadata);
  const regen = regenIndex(root);
  return {
    ok: Boolean(regen.ok),
    track_id: trackId,
    status,
    regen,
  };
}

function markerForStatus(status) {
  return {
    pending: " ",
    new: " ",
    in_progress: "~",
    completed: "x",
    blocked: "!",
    skipped: "-",
  }[status] || status;
}

function recordTaskResult(root, args = {}) {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const plan = parsePlanFile(track.plan_path);
  const phaseIndex = Number(args.phaseIndex);
  const taskIndex = Number(args.taskIndex);
  const phase = (plan.phases || []).find((item) => item.phase_index === phaseIndex);
  const task = phase && (phase.tasks || []).find((item) => item.task_index === taskIndex);
  if (!task) return { ok: false, error: `Task not found: phase ${phaseIndex} task ${taskIndex}` };

  const marker = markerForStatus(args.status || "completed");
  const lines = fs.readFileSync(track.plan_path, "utf8").split(/\r?\n/);
  const idx = task.line - 1;
  const line = lines[idx];
  if (!line) return { ok: false, error: `Task line missing at ${task.line}` };
  let nextLine = line.replace(/^(\s*-\s+\[)[ x~!\-](\]\s+)/, `$1${marker}$2`);
  const commitSha = args.commitSha ? String(args.commitSha).trim() : "";
  if (commitSha && !nextLine.includes(commitSha)) {
    nextLine = `${nextLine} (${commitSha.slice(0, 12)})`;
  }
  lines[idx] = nextLine;
  fs.writeFileSync(track.plan_path, `${lines.join("\n").replace(/\n+$/, "")}\n`);

  const metadata = { ...track.metadata };
  if (typeof args.coverage === "number") metadata.last_coverage = args.coverage;
  metadata.last_task_result = {
    phase_index: phaseIndex,
    task_index: taskIndex,
    task_key: task.task_key,
    status: args.status || "completed",
    commit_sha: commitSha || null,
    recorded_at: utcNow(),
  };
  writeJson(track.metadata_path, metadata);
  return {
    ok: true,
    track_id: track.track_id,
    task_key: task.task_key,
    line: task.line,
    status: args.status || "completed",
    commit_sha: commitSha || null,
    beads_task_id: metadata.beads_tasks ? metadata.beads_tasks[task.task_key] || null : null,
  };
}

function recordReview(root, args = {}) {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const verdict = args.verdict;
  if (!["approved", "changes_requested"].includes(verdict)) {
    return { ok: false, error: `Invalid review verdict: ${verdict}` };
  }
  const reviewer = args.reviewer || gitIdentity(root);
  const existing = track.metadata.review || {};
  if (
    verdict === "approved" &&
    args.allowOverride !== true &&
    existing.reviewer &&
    existing.reviewer !== reviewer &&
    (existing.verdict === "changes_requested" || Number(existing.blocking_count || 0) > 0)
  ) {
    return {
      ok: false,
      error: "Approval would override another reviewer's open changes_requested verdict",
      existing_review: existing,
      requires_override: true,
    };
  }
  const metadata = { ...track.metadata };
  const reviewedSha = args.reviewedSha || runCommand("git", ["rev-parse", metadata.git_branch || `track/${track.track_id}`], { cwd: root }).stdout.trim() || runCommand("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  metadata.review = {
    verdict,
    blocking_count: Number(args.blockingCount || 0),
    date: args.date || utcNow(),
    reviewer: reviewer || null,
    coverage: args.coverage ?? metadata.last_coverage ?? null,
    self_reviewed: Boolean(reviewer && metadata.owner && reviewer === metadata.owner),
    reviewed_sha: reviewedSha || null,
    review_seq: Number(existing.review_seq || 0) + 1,
  };
  writeJson(track.metadata_path, metadata);
  const gate = reviewGate(root, track.track_id);
  return { ok: true, track_id: track.track_id, review: metadata.review, gate };
}

function syncControlPlane(root, args = {}) {
  const topology = loadTopology(root);
  if (topology.config.sync_mode !== "shared") {
    return { ok: true, skipped: true, reason: "sync_mode is not shared", commands: [] };
  }
  const mode = args.mode || "pre";
  const remote = topology.config.control_remote || "origin";
  const branch = topology.config.control_branch || "main";
  const commands = [];
  commands.push(runCommand("git", ["config", "merge.ours.driver", "true"], { cwd: root }));
  if (mode === "pre") {
    commands.push(runCommand("git", ["pull", "--rebase", remote, branch], { cwd: root }));
    if (commandExists("bd", root)) commands.push(runCommand("bd", ["dolt", "pull"], { cwd: root }));
  } else if (mode === "post") {
    if (commandExists("bd", root)) commands.push(runCommand("bd", ["dolt", "push"], { cwd: root }));
    commands.push(runCommand("git", ["push", remote, branch], { cwd: root }));
  } else {
    return { ok: false, error: `Invalid sync mode: ${mode}`, commands };
  }
  return { ok: commands.every((cmd) => cmd.ok), mode, remote, branch, commands };
}

function lspReview(root, args = {}) {
  const candidates = [
    path.join(root, "templates", "scripts", "cadre-lsp-review.js"),
    path.join(__dirname, "cadre-lsp-review.js"),
    path.join(__dirname, "..", "templates", "scripts", "cadre-lsp-review.js"),
    path.join(__dirname, "..", "skills", "cadre", "templates", "scripts", "cadre-lsp-review.js"),
  ];
  const helper = candidates.find(fileExists);
  if (!helper) return { available: false, reason: "No cadre-lsp-review.js helper found", checked: candidates };
  const commandArgs = [helper, "--base", args.base || "main", "--head", args.head || "HEAD", "--json"];
  if (args.config) commandArgs.push("--config", args.config);
  const result = runCommand("node", commandArgs, { cwd: root });
  if (!result.ok) {
    return { available: false, reason: "LSP review helper failed", helper, result };
  }
  try {
    return { helper, ...JSON.parse(result.stdout || "{}") };
  } catch (_) {
    return { available: false, reason: "LSP review helper returned invalid JSON", helper, result };
  }
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
  const tracksFile = path.join(root, "cadre", "tracks.md");
  const start = "<!-- cadre:index:start -->";
  const end = "<!-- cadre:index:end -->";
  const tracks = listTracks(root).sort((a, b) => a.track_id.localeCompare(b.track_id));
  const body = tracks
    .map((track) => {
      const marker = STATUS_MARKERS[track.metadata.status || "new"] || STATUS_MARKERS.new;
      const name = track.metadata.name || track.metadata.track_id || track.track_id;
      return `## ${marker} Track: ${name}`;
    })
    .join("\n");
  const existing = fileExists(tracksFile) ? fs.readFileSync(tracksFile, "utf8") : "";
  let next;
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existing.slice(0, startIndex + start.length).replace(/[ \t]*$/g, "");
    const after = existing.slice(endIndex);
    next = `${before}\n${body}${body ? "\n" : ""}${after.replace(/^\n*/, "")}`;
  } else {
    const preamble = existing ? `${existing.replace(/\n*$/, "")}\n` : "";
    next = `${preamble}${start}\n${body}${body ? "\n" : ""}${end}\n`;
  }
  fs.mkdirSync(path.dirname(tracksFile), { recursive: true });
  const tmp = `${tracksFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, tracksFile);
  return {
    ok: true,
    tracks_file: tracksFile,
    tracks: tracks.length,
    stdout: `Regenerated ${tracksFile} index from ${tracks.length} tracks' metadata (preamble preserved).\n`,
    stderr: "",
  };
}

module.exports = {
  STATUS_MARKERS,
  availableWork,
  claimTrack,
  collisionScan,
  gitIdentity,
  listTracks,
  liveStatus,
  loadTopology,
  lspReview,
  parsePlanFile,
  parsePlanText,
  planClaims,
  planIntegrity,
  polyrepoPreflight,
  recordReview,
  recordTaskResult,
  regenIndex,
  reviewGate,
  setTrackStatus,
  syncControlPlane,
  teamStatus,
  trackContext,
};
