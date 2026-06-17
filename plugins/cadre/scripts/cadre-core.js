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

function isCadreProjectRoot(root) {
  const cadreDir = path.join(root, "cadre");
  if (!fileExists(cadreDir)) return false;
  return [
    "tracks.md",
    "setup_state.json",
    "product.md",
    "tech-stack.md",
    "workflow.md",
    "beads.json",
    "config.json",
    "repos.json",
  ].some((name) => fileExists(path.join(cadreDir, name))) || fileExists(path.join(cadreDir, "tracks"));
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
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal || null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    command: options.shell === true ? command : [command, ...args].join(" "),
  };
}

function parsePorcelainFiles(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const raw = line.slice(3).trim();
      if (!raw) return [];
      if (raw.includes(" -> ")) return [raw.split(" -> ").pop()];
      return [raw.replace(/^"|"$/g, "")];
    });
}

function isControlPlaneFile(file) {
  const normalized = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) return true;
  if (normalized.startsWith("cadre/")) return true;
  if (normalized.startsWith(".beads/")) return true;
  if (normalized === ".gitattributes" || normalized === ".gitmodules") return true;
  if (normalized === "cadre-merge-train.gitlab-ci.yml") return true;
  if (normalized === ".gitlab-ci.yml") return true;
  if (normalized.startsWith(".github/workflows/cadre-")) return true;
  return false;
}

function controlPlaneSyncSafety(root, mode, remote, branch) {
  const status = runCommand("git", ["status", "--porcelain"], { cwd: root });
  const dirtyFiles = parsePorcelainFiles(status.stdout);
  const unsafeDirtyFiles = dirtyFiles.filter((file) => !isControlPlaneFile(file));
  const safety = {
    ok: true,
    mode,
    remote,
    branch,
    dirty_files: dirtyFiles,
    unsafe_dirty_files: unsafeDirtyFiles,
    ahead_files: [],
    unsafe_ahead_files: [],
    warnings: [],
  };
  if (!status.ok) {
    return { ...safety, ok: false, reason: "Unable to inspect git status", status };
  }
  if (unsafeDirtyFiles.length > 0) {
    return {
      ...safety,
      ok: false,
      reason: "Working tree has non-control-plane changes; refusing control-plane sync",
    };
  }
  if (mode !== "post") return safety;

  const remoteRef = `${remote}/${branch}`;
  const fetch = runCommand("git", ["fetch", "--quiet", remote, branch], { cwd: root });
  const rev = runCommand("git", ["rev-parse", "--verify", remoteRef], { cwd: root });
  let diff;
  if (fetch.ok && rev.ok) {
    diff = runCommand("git", ["diff", "--name-only", `${remoteRef}..HEAD`], { cwd: root });
  } else {
    safety.warnings.push(`Unable to verify ${remoteRef}; falling back to last-commit file classification`);
    diff = runCommand("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], { cwd: root });
  }
  const aheadFiles = diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const unsafeAheadFiles = aheadFiles.filter((file) => !isControlPlaneFile(file));
  safety.ahead_files = aheadFiles;
  safety.unsafe_ahead_files = unsafeAheadFiles;
  if (!diff.ok) {
    return { ...safety, ok: false, reason: "Unable to classify unpushed commits", diff };
  }
  if (unsafeAheadFiles.length > 0) {
    return {
      ...safety,
      ok: false,
      reason: "Unpushed commits include non-control-plane files; refusing control-plane push",
    };
  }
  return safety;
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

function loadPackageJson(root) {
  return readJson(path.join(root, "package.json"), null);
}

function configuredCoverageCommand(root, args = {}) {
  if (args.command) return String(args.command);
  const topology = loadTopology(root);
  const config = topology.config || {};
  for (const key of ["coverage_command", "test_coverage_command", "test_command"]) {
    if (typeof config[key] === "string" && config[key].trim()) return config[key].trim();
  }
  const pkg = loadPackageJson(root);
  if (pkg && pkg.scripts) {
    for (const name of ["coverage", "test:coverage", "test:cov", "test"]) {
      if (pkg.scripts[name]) {
        if (fileExists(path.join(root, "pnpm-lock.yaml"))) return `pnpm ${name}`;
        if (fileExists(path.join(root, "yarn.lock"))) return `yarn ${name}`;
        return `npm run ${name}`;
      }
    }
  }
  if (fileExists(path.join(root, "pyproject.toml")) || fileExists(path.join(root, "pytest.ini"))) {
    return "pytest --cov --cov-report=term";
  }
  if (fileExists(path.join(root, "go.mod"))) return "go test ./...";
  return null;
}

function parseCoveragePercent(text) {
  const source = String(text || "");
  const patterns = [
    /All files[^|\n]*(?:\|[^|\n]*){3,}\|\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\||$)/i,
    /\bStatements\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i,
    /\bLines\s*:\s*([0-9]+(?:\.[0-9]+)?)%/i,
    /\bTOTAL\b[^\n%]*\s([0-9]+(?:\.[0-9]+)?)%/i,
    /\bcoverage[^0-9%]{0,40}([0-9]+(?:\.[0-9]+)?)%/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function parseLcovCoverage(root) {
  const candidates = [
    path.join(root, "coverage", "lcov.info"),
    path.join(root, "lcov.info"),
  ];
  for (const file of candidates) {
    if (!fileExists(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    let found = 0;
    let hit = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("LF:")) found += Number(line.slice(3)) || 0;
      if (line.startsWith("LH:")) hit += Number(line.slice(3)) || 0;
    }
    if (found > 0) return Math.round((hit / found) * 10000) / 100;
  }
  return null;
}

function coverageThreshold(root) {
  const topology = loadTopology(root);
  const config = topology.config || {};
  for (const key of ["coverage_threshold", "minimum_coverage", "min_coverage"]) {
    const value = Number(config[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const workflowPath = path.join(root, "cadre", "workflow.md");
  if (fileExists(workflowPath)) {
    const text = fs.readFileSync(workflowPath, "utf8");
    const match = text.match(/(?:coverage|test coverage)[^\n%]{0,80}?([0-9]+(?:\.[0-9]+)?)\s*%/i);
    if (match) return Number(match[1]);
  }
  return 80;
}

function runCoverage(root, args = {}) {
  const command = configuredCoverageCommand(root, args);
  if (!command) {
    return {
      ok: false,
      available: false,
      command: null,
      coverage: null,
      reason: "No coverage/test command configured or detected",
      hints: [
        "Set cadre/config.json coverage_command",
        "Add package.json scripts.coverage or scripts.test:coverage",
        "Pass { command } explicitly to cadre_complete_task",
      ],
    };
  }
  const timeoutMs = Number(args.timeoutMs || 10 * 60 * 1000);
  const result = runCommand(command, [], {
    cwd: root,
    shell: true,
    timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  const parsed = parseCoveragePercent(combined);
  const lcov = parsed == null ? parseLcovCoverage(root) : null;
  const coverage = parsed == null ? lcov : parsed;
  return {
    ok: result.ok,
    available: true,
    command,
    status: result.status,
    signal: result.signal,
    coverage,
    coverage_source: parsed == null && lcov != null ? "lcov" : (parsed != null ? "output" : null),
    timed_out: result.signal === "SIGTERM" || result.signal === "SIGKILL",
    stdout_tail: result.stdout.slice(-4000),
    stderr_tail: result.stderr.slice(-4000),
    result,
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

function runBdJson(root, args) {
  if (!commandExists("bd", root)) return { ok: false, available: false, args, json: null };
  const result = runCommand("bd", args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  let json = null;
  try {
    json = JSON.parse(result.stdout || "null");
  } catch (_) {
    // Preserve raw output below.
  }
  return { ok: result.ok, available: true, args, json, stdout_tail: result.stdout.slice(-2000), stderr_tail: result.stderr.slice(-2000) };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.issues)) return value.issues;
  if (value && Array.isArray(value.data)) return value.data;
  return [];
}

function taskMarkerName(marker) {
  return {
    "~": "in_progress",
    "!": "blocked",
    "x": "completed",
    "-": "skipped",
    " ": "pending",
  }[marker] || "pending";
}

function metadataTrackSummary(track) {
  return {
    track_id: track.track_id,
    name: track.metadata.name || track.metadata.description || track.track_id,
    status: track.metadata.status || "new",
    priority: track.metadata.priority || "medium",
    owner: track.metadata.owner || null,
    reviewer: track.metadata.reviewer || null,
    beads_epic: track.metadata.beads_epic || null,
    review: track.metadata.review || null,
  };
}

function teamBoard(root, args = {}) {
  const tracks = listTracks(root);
  const identity = gitIdentity(root);
  const scope = args.mine === true ? "mine" : "all";
  const byId = new Map(tracks.map((track) => [track.track_id, track]));
  const byEpic = new Map(tracks.map((track) => [track.metadata.beads_epic, track]).filter(([epic]) => Boolean(epic)));
  const wip = [];
  const reviewQueue = [];
  const blockers = [];

  for (const track of tracks) {
    const summary = metadataTrackSummary(track);
    const hold = holdInfo(track);
    if (
      summary.status === "in_progress" ||
      summary.status === "blocked" ||
      hold.owner ||
      hold.lease_owner
    ) {
      if (scope !== "mine" || summary.owner === identity || hold.owner === identity || hold.lease_owner === identity) {
        wip.push({ ...summary, hold });
      }
    }

    if (summary.review && (summary.review.verdict === "changes_requested" || Number(summary.review.blocking_count || 0) > 0)) {
      reviewQueue.push({ ...summary, review_state: "changes_requested" });
    } else if (summary.review && summary.review.verdict === "approved") {
      reviewQueue.push({ ...summary, review_state: "ready_to_ship" });
    }

    const deps = Array.isArray(track.metadata.depends_on) ? track.metadata.depends_on : [];
    for (const dep of deps) {
      const depTrack = byId.get(dep);
      if (!depTrack || depTrack.metadata.status !== "completed") {
        blockers.push({
          kind: "track_dependency",
          track_id: track.track_id,
          blocked_on: dep,
          blocked_on_status: depTrack ? depTrack.metadata.status || "new" : "missing",
        });
      }
    }
    const plan = parsePlanFile(track.plan_path);
    for (const phase of plan.phases || []) {
      for (const task of phase.tasks || []) {
        if (task.marker === "!" || task.marker === "~") {
          blockers.push({
            kind: taskMarkerName(task.marker),
            track_id: track.track_id,
            phase: phase.phase_index,
            task: task.task_index,
            task_key: task.task_key,
            title: task.title,
          });
        }
      }
    }
  }

  const beads = {
    available: commandExists("bd", root),
    wip: null,
    handoffs: null,
    review_labels: {},
    blocked_edges: null,
  };
  const handoffs = [];
  if (beads.available) {
    beads.wip = runBdJson(root, ["list", "--status", "in_progress", "--json"]);
    beads.handoffs = runBdJson(root, ["list", "--label", "handoff:pending", "--json"]);
    beads.blocked_edges = runBdJson(root, ["ready", "--json"]);
    for (const label of ["review:changes", "review:ready", "review:requested"]) {
      beads.review_labels[label] = runBdJson(root, ["list", "--label", label, "--json"]);
      for (const issue of asArray(beads.review_labels[label].json)) {
        const id = issue.id || issue.issue_id || issue.issueId || issue.parent || issue.epic || null;
        const track = id ? byEpic.get(id) : null;
        if (track) {
          reviewQueue.push({
            ...metadataTrackSummary(track),
            review_state: label.replace("review:", ""),
            source: "beads_label",
            bead_id: id,
          });
        }
      }
    }
    for (const issue of asArray(beads.handoffs && beads.handoffs.json)) {
      const id = issue.id || issue.issue_id || issue.issueId || null;
      const track = id ? byEpic.get(id) : null;
      const assignee = issue.assignee || issue.assigned_to || null;
      if (scope === "mine" && assignee !== identity) continue;
      handoffs.push({
        track_id: track ? track.track_id : null,
        bead_id: id,
        assignee,
        title: issue.title || issue.summary || null,
      });
    }
  }

  const dedupReview = new Map();
  for (const item of reviewQueue) {
    const key = `${item.track_id}:${item.review_state}:${item.bead_id || ""}`;
    if (!dedupReview.has(key)) dedupReview.set(key, item);
  }

  return {
    ok: true,
    root,
    identity,
    scope,
    generated_at: utcNow(),
    summary: teamStatus(root),
    wip,
    incoming_handoffs: handoffs,
    review_queue: Array.from(dedupReview.values()),
    blockers,
    beads,
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

function priorityRank(priority) {
  return {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  }[String(priority || "medium").toLowerCase()] ?? 2;
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

function implementationPrep(root, args = {}) {
  const identity = args.identity || gitIdentity(root);
  const team = teamStatus(root);
  const available = availableWork(root);
  let trackId = args.trackId || args.track_id || null;
  const warnings = [];

  if (!trackId && available.available.length > 0) {
    trackId = available.available[0].track_id;
  }
  if (!trackId) {
    const mine = team.tracks.find((track) => track.status === "in_progress" && (!track.owner || track.owner === identity));
    const anyOpen = team.tracks.find((track) => ["new", "in_progress", "blocked"].includes(track.status));
    trackId = (mine || anyOpen || {}).track_id || null;
  }
  if (!trackId) {
    return {
      ok: false,
      root,
      identity,
      reason: "No available or incomplete track found",
      team,
      available,
    };
  }

  let claim = null;
  if (args.claim === true) {
    claim = claimTrack(root, trackId, { identity, takeover: args.takeover === true });
    if (!claim.ok) {
      return { ok: false, root, identity, selected_track: trackId, claim, team, available };
    }
  }

  const context = trackContext(root, trackId);
  const collisions = collisionScan(root);
  const selectedCollisions = (collisions.collisions || []).filter((collision) =>
    (collision.track_ids || []).includes(trackId)
  );
  const integrity = planIntegrity(root, trackId);
  const foreignCollisions = selectedCollisions.filter((collision) =>
    (collision.owners || []).some((owner) => owner && owner !== identity)
  );
  if (foreignCollisions.length > 0) {
    warnings.push(`${foreignCollisions.length} cross-owner file collision(s) involve the selected track`);
  }
  if (context.ok && context.hold && context.hold.owner && identity && context.hold.owner !== identity) {
    warnings.push(`Selected track is held by ${context.hold.owner}`);
  }

  return {
    ok: context.ok && integrity.ok,
    root,
    identity,
    selected_track: trackId,
    claim,
    context,
    team_summary: {
      total_tracks: team.total_tracks,
      by_status: team.by_status,
      by_owner: team.by_owner,
    },
    available,
    collisions: selectedCollisions,
    integrity,
    warnings,
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

function extractBeadsId(json, fallback = null) {
  if (!json || typeof json !== "object") return fallback;
  return json.id || json.issue_id || json.issueId || (json.issue && json.issue.id) || fallback;
}

function extractAssignee(json) {
  if (Array.isArray(json)) {
    for (const item of json) {
      const nested = extractAssignee(item);
      if (nested) return nested;
    }
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const direct = json.assignee || json.assigned_to || json.owner || json.claimed_by;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  for (const key of ["issue", "task", "epic", "data"]) {
    const nested = extractAssignee(json[key]);
    if (nested) return nested;
  }
  return null;
}

function parseCommandJson(result) {
  try {
    return JSON.parse(result.stdout || "null");
  } catch (_) {
    return null;
  }
}

function beadsCommandPlanEntry(args) {
  return { command: ["bd", ...args].join(" "), args };
}

function compactLines(value, limit = 1200) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, limit);
}

function sectionText(markdown, headingPattern) {
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,4}\s+/.test(lines[i]) && out.length > 0) break;
    out.push(lines[i]);
  }
  return compactLines(out.join("\n"));
}

function trackSpecContext(track) {
  const text = fileExists(track.spec_path) ? fs.readFileSync(track.spec_path, "utf8") : "";
  const overview = sectionText(text, /^#{1,4}\s+(overview|summary|technical approach|approach|requirements?)\b/i) || compactLines(text, 1400);
  const acceptance = sectionText(text, /^#{1,4}\s+(acceptance|success criteria|done|definition of done)\b/i) || compactLines(text, 1000);
  return { overview, acceptance };
}

function taskDesignText(track, phase, task, specContext) {
  return compactLines([
    `Track: ${track.track_id}`,
    `Phase: ${phase.title}`,
    `Task: ${task.title}`,
    task.files && task.files.length ? `Files: ${task.files.join(", ")}` : null,
    task.depends && task.depends.length ? `Depends on: ${task.depends.join(", ")}` : null,
    task.repo ? `Repo: ${task.repo}` : null,
    specContext.overview ? `Spec context: ${specContext.overview}` : null,
  ].filter(Boolean).join("\n"), 1800);
}

function taskAcceptanceText(task, specContext) {
  return compactLines([
    `Complete when this task is implemented, tested, and committed.`,
    task.files && task.files.length ? `Owned files changed only as needed: ${task.files.join(", ")}` : null,
    specContext.acceptance ? `Track acceptance context: ${specContext.acceptance}` : null,
  ].filter(Boolean).join("\n"), 1600);
}

function addCreateContext(args, design, acceptance) {
  if (design) args.push("--design", design);
  if (acceptance) args.push("--acceptance", acceptance);
  return args;
}

function createBeadsTree(root, args = {}) {
  const trackId = args.trackId || args.track_id;
  if (!trackId) return { ok: false, error: "trackId is required" };
  const track = findTrack(root, trackId);
  if (!track) return { ok: false, error: `Track not found: ${trackId}` };

  const dryRun = args.dryRun === true;
  if (!dryRun && !commandExists("bd", root)) {
    return { ok: false, available: false, reason: "Beads CLI (bd) is not installed or not on PATH" };
  }

  const identity = args.identity || gitIdentity(root);
  const plan = parsePlanFile(track.plan_path);
  const specContext = trackSpecContext(track);
  const epicId = args.epicId || track.metadata.beads_epic || `cadre-${track.track_id}`;
  const commands = [];
  const results = [];
  const beadsTasks = {};

  const runBd = (bdArgs) => {
    commands.push(beadsCommandPlanEntry(bdArgs));
    if (dryRun) {
      const id = bdArgs[0] === "create" && bdArgs.includes("--id") ? epicId : `dry-${commands.length}`;
      return { ok: true, status: 0, stdout: JSON.stringify({ id }), stderr: "", command: ["bd", ...bdArgs].join(" ") };
    }
    const result = runCommand("bd", bdArgs, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    results.push(result);
    return result;
  };

  const showEpic = dryRun ? { ok: false } : runCommand("bd", ["show", epicId, "--json"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  if (showEpic.ok) {
    if (track.metadata.beads_epic === epicId && track.metadata.beads_tasks && Object.keys(track.metadata.beads_tasks).length > 0) {
      return {
        ok: true,
        available: true,
        existing: true,
        dry_run: false,
        track_id: track.track_id,
        beads_epic: epicId,
        beads_tasks: track.metadata.beads_tasks,
        commands,
        results,
        metadata_patch: {
          beads_epic: epicId,
          beads_tasks: track.metadata.beads_tasks,
        },
      };
    }
    return {
      ok: false,
      available: true,
      existing: true,
      reason: `Beads epic ${epicId} already exists but metadata.beads_tasks is missing; reconcile existing children before creating new ones`,
      commands,
      results,
    };
  } else {
    const epicArgs = addCreateContext([
      "create",
      `${track.track_id}: ${track.metadata.description || track.metadata.name || track.track_id}`,
      "--id",
      epicId,
      "-t",
      "epic",
      "-p",
      String(priorityRank(track.metadata.priority)),
    ], specContext.overview, specContext.acceptance);
    epicArgs.push("--json");
    if (identity) epicArgs.splice(epicArgs.length - 1, 0, "--assignee", identity);
    const epicResult = runBd(epicArgs);
    if (!epicResult.ok) return { ok: false, available: true, stage: "create_epic", commands, results };
  }

  const phaseIds = {};
  for (const phase of plan.phases || []) {
    const phaseKey = `phase${phase.phase_index}`;
    const phaseResult = runBd(addCreateContext(
      ["create", phase.title, "-t", "task", "--parent", epicId, "--labels", "cadre:phase"],
      `Phase for Cadre track ${track.track_id}: ${phase.title}`,
      `All tasks in this phase are complete or intentionally skipped.`
    ).concat("--json"));
    if (!phaseResult.ok) return { ok: false, available: true, stage: "create_phase", phase: phaseKey, commands, results };
    const phaseId = extractBeadsId(parseCommandJson(phaseResult), dryRun ? `dry-${phaseKey}` : null);
    phaseIds[phaseKey] = phaseId;
    beadsTasks[phaseKey] = phaseId;

    for (const task of phase.tasks || []) {
      const taskKey = `phase${phase.phase_index}_task${task.task_index}`;
      const taskResult = runBd(addCreateContext([
        "create",
        task.title,
        "-t",
        "task",
        "--parent",
        phaseId,
        "--labels",
        "cadre:task",
      ], taskDesignText(track, phase, task, specContext), taskAcceptanceText(task, specContext)).concat("--json"));
      if (!taskResult.ok) return { ok: false, available: true, stage: "create_task", task: taskKey, commands, results };
      beadsTasks[taskKey] = extractBeadsId(parseCommandJson(taskResult), dryRun ? `dry-${taskKey}` : null);
    }
  }

  for (const phase of plan.phases || []) {
    const phaseKey = `phase${phase.phase_index}`;
    if (!phase.annotations.depends && phase.phase_index > 1) {
      runBd(["dep", "add", phaseIds[phaseKey], phaseIds[`phase${phase.phase_index - 1}`], "--json"]);
    } else if (phase.annotations.depends) {
      for (const dep of phase.annotations.depends.split(",").map((item) => item.trim()).filter(Boolean)) {
        if (phaseIds[dep]) runBd(["dep", "add", phaseIds[phaseKey], phaseIds[dep], "--json"]);
      }
    }

    const execution = phase.annotations.execution || "sequential";
    for (const task of phase.tasks || []) {
      const taskKey = `phase${phase.phase_index}_task${task.task_index}`;
      if (execution !== "parallel" && task.task_index > 1) {
        runBd(["dep", "add", beadsTasks[taskKey], beadsTasks[`phase${phase.phase_index}_task${task.task_index - 1}`], "--json"]);
      }
      if (execution === "parallel") {
        for (const dep of task.depends || []) {
          const taskDep = dep.match(/^task(\d+)$/);
          const depKey = taskDep ? `phase${phase.phase_index}_task${taskDep[1]}` : dep;
          if (beadsTasks[depKey]) runBd(["dep", "add", beadsTasks[taskKey], beadsTasks[depKey], "--json"]);
        }
      }
    }
  }

  runBd([
    "note",
    epicId,
    [
      `TRACK INITIALIZED: ${track.track_id}`,
      `PHASES: ${(plan.phases || []).length}`,
      `BRANCH: ${track.metadata.git_branch || `track/${track.track_id}`}`,
    ].join("\n"),
    "--json",
  ]);

  for (const phase of plan.phases || []) {
    if ((phase.annotations.execution || "sequential") !== "parallel") continue;
    for (const task of phase.tasks || []) {
      const taskKey = `phase${phase.phase_index}_task${task.task_index}`;
      runBd([
        "note",
        beadsTasks[taskKey],
        [
          "PARALLEL_ENABLED: true",
          `FILES_OWNED: ${(task.files || []).join(", ")}`,
          `DEPENDS_ON: ${(task.depends || []).join(", ") || "none"}`,
          task.repo ? `REPO: ${task.repo}` : null,
        ].filter(Boolean).join("\n"),
        "--json",
      ]);
    }
  }

  if (!dryRun) {
    writeJson(track.metadata_path, {
      ...track.metadata,
      beads_epic: epicId,
      beads_tasks: beadsTasks,
    });
  }

  return {
    ok: true,
    available: true,
    dry_run: dryRun,
    track_id: track.track_id,
    beads_epic: epicId,
    beads_tasks: beadsTasks,
    commands,
    results,
    metadata_patch: {
      beads_epic: epicId,
      beads_tasks: beadsTasks,
    },
  };
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
    const verify = runCommand("bd", ["show", track.metadata.beads_epic, "--json"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    commands.push(verify);
    if (!verify.ok) return { ok: false, claimed: false, error: "Beads claim verification failed", commands };
    const assignedTo = extractAssignee(parseCommandJson(verify));
    if (!assignedTo) {
      return {
        ok: false,
        claimed: false,
        reason: "claim-unverified",
        error: "Beads claim verification did not expose an assignee",
        commands,
      };
    }
    if (assignedTo !== identity) {
      return {
        ok: false,
        claimed: false,
        reason: "foreign-held",
        held_by: assignedTo,
        hold,
        commands,
      };
    }
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

function completeTask(root, args = {}) {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const phaseIndex = Number(args.phaseIndex);
  const taskIndex = Number(args.taskIndex);
  const plan = parsePlanFile(track.plan_path);
  const phase = (plan.phases || []).find((item) => item.phase_index === phaseIndex);
  const task = phase && (phase.tasks || []).find((item) => item.task_index === taskIndex);
  if (!task) return { ok: false, error: `Task not found: phase ${phaseIndex} task ${taskIndex}` };

  const coverage = runCoverage(root, args);
  const threshold = Number(args.coverageThreshold ?? coverageThreshold(root));
  const allowMissingCoverage = args.allowMissingCoverage === true;
  const allowLowCoverage = args.allowLowCoverage === true;
  if (!coverage.available && !allowMissingCoverage) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: coverage.reason || "Coverage command unavailable",
    };
  }
  if (coverage.available && !coverage.ok) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: "Coverage/test command failed; task was not marked complete",
    };
  }
  if (coverage.available && typeof coverage.coverage === "number" && coverage.coverage < threshold && !allowLowCoverage) {
    return {
      ok: false,
      stage: "coverage",
      blocked: true,
      threshold,
      coverage,
      reason: `Coverage ${coverage.coverage}% is below required ${threshold}%; task was not marked complete`,
    };
  }

  const metadataBefore = readJson(track.metadata_path, track.metadata) || track.metadata;
  writeJson(track.metadata_path, {
    ...metadataBefore,
    last_test_run: {
      command: coverage.command,
      ok: coverage.available ? coverage.ok : null,
      status: coverage.available ? coverage.status : null,
      signal: coverage.available ? coverage.signal : null,
      coverage: coverage.coverage,
      threshold,
      measured_at: utcNow(),
      allow_missing_coverage: allowMissingCoverage,
      allow_low_coverage: allowLowCoverage,
    },
    ...(typeof coverage.coverage === "number" ? { last_coverage: coverage.coverage } : {}),
  });

  const taskResult = recordTaskResult(root, {
    trackId: args.trackId,
    phaseIndex,
    taskIndex,
    status: args.status || "completed",
    commitSha: args.commitSha,
    coverage: coverage.coverage,
  });
  if (!taskResult.ok) return { ok: false, stage: "record_task_result", coverage, task_result: taskResult };

  const beads = {
    attempted: false,
    available: commandExists("bd", root),
    note: null,
    close: null,
    skipped_reason: null,
  };
  const beadsTaskId = taskResult.beads_task_id || args.beadsTaskId || args.taskId || null;
  if (!beadsTaskId) {
    beads.skipped_reason = "No Beads task id mapped for this plan task";
  } else if (!beads.available) {
    beads.skipped_reason = "Beads CLI (bd) is not installed or not on PATH";
  } else {
    beads.attempted = true;
    const sha = args.commitSha ? String(args.commitSha).slice(0, 12) : "unknown";
    const note = [
      `key: ${track.track_id}:p${phaseIndex}:t${taskIndex}:${sha.slice(0, 7)}`,
      `COMPLETED: ${task.title}`,
      `COMMIT: ${sha}`,
      `COVERAGE: ${coverage.coverage == null ? "unmeasured" : `${coverage.coverage}%`}`,
      args.summary ? `SUMMARY: ${args.summary}` : null,
    ].filter(Boolean).join("\n");
    beads.note = beadsTaskWrite(root, { operation: "note", id: beadsTaskId, note });
    if (beads.note.ok) {
      beads.close = beadsTaskWrite(root, {
        operation: "close",
        id: beadsTaskId,
        continue: true,
        reason: args.reason || `commit: ${args.commitSha || "completed"}`,
      });
    }
    if (beads.note && !beads.note.ok) {
      return { ok: false, stage: "beads_note", coverage, task_result: taskResult, beads };
    }
    if (beads.close && !beads.close.ok) {
      return { ok: false, stage: "beads_close", coverage, task_result: taskResult, beads };
    }
  }

  return {
    ok: true,
    track_id: track.track_id,
    task_key: taskResult.task_key,
    threshold,
    coverage,
    task_result: taskResult,
    beads,
  };
}

function recordParallelWorker(root, args = {}) {
  const track = findTrack(root, args.trackId);
  if (!track) return { ok: false, error: `Track not found: ${args.trackId}` };
  const workerId = args.workerId || args.worker_id;
  if (!workerId) return { ok: false, error: "workerId is required" };
  const status = args.status || "awaiting_merge";
  const valid = new Set(["in_progress", "awaiting_merge", "merged", "conflict", "failed"]);
  if (!valid.has(status)) return { ok: false, error: `Invalid parallel worker status: ${status}` };

  const statePath = path.join(track.dir, "parallel_state.json");
  const existing = readJson(statePath, {
    track_id: track.track_id,
    execution_mode: "parallel",
    started_at: utcNow(),
    workers: [],
  });
  const state = existing && typeof existing === "object" ? existing : { workers: [] };
  if (!Array.isArray(state.workers)) state.workers = [];
  const now = utcNow();
  const index = state.workers.findIndex((worker) => worker.worker_id === workerId);
  const nextWorker = {
    ...(index >= 0 ? state.workers[index] : {}),
    worker_id: workerId,
    status,
    phase_index: args.phaseIndex ?? (index >= 0 ? state.workers[index].phase_index : null),
    task_index: args.taskIndex ?? (index >= 0 ? state.workers[index].task_index : null),
    task_key: args.phaseIndex && args.taskIndex ? `phase${args.phaseIndex}_task${args.taskIndex}` : (index >= 0 ? state.workers[index].task_key : null),
    beads_task_id: args.beadsTaskId || args.taskId || (index >= 0 ? state.workers[index].beads_task_id : null),
    repo: args.repo || (index >= 0 ? state.workers[index].repo : null),
    worktree: args.worktree || (index >= 0 ? state.workers[index].worktree : null),
    branch: args.branch || (index >= 0 ? state.workers[index].branch : null),
    commit_sha: args.commitSha || (index >= 0 ? state.workers[index].commit_sha : null),
    coverage: typeof args.coverage === "number" ? args.coverage : (index >= 0 ? state.workers[index].coverage : null),
    evidence: args.evidence || (index >= 0 ? state.workers[index].evidence : null),
    updated_at: now,
  };
  if (status === "awaiting_merge" && !nextWorker.completed_at) nextWorker.completed_at = now;
  if (status === "merged") nextWorker.merged_at = now;
  if (status === "conflict") nextWorker.conflict_at = now;
  if (index >= 0) state.workers[index] = nextWorker;
  else state.workers.push(nextWorker);
  state.completed_workers = state.workers.filter((worker) => ["awaiting_merge", "merged"].includes(worker.status)).length;
  state.merged_workers = state.workers.filter((worker) => worker.status === "merged").length;
  state.conflict_workers = state.workers.filter((worker) => worker.status === "conflict").length;
  state.updated_at = now;

  let completion = null;
  if (args.completeTask === true) {
    completion = completeTask(root, {
      trackId: track.track_id,
      phaseIndex: args.phaseIndex,
      taskIndex: args.taskIndex,
      commitSha: args.commitSha,
      command: args.command,
      timeoutMs: args.timeoutMs,
      coverageThreshold: args.coverageThreshold,
      allowMissingCoverage: args.allowMissingCoverage,
      allowLowCoverage: args.allowLowCoverage,
      summary: args.summary || `parallel worker ${workerId}`,
      reason: args.reason || `merged ${workerId}`,
      beadsTaskId: nextWorker.beads_task_id,
    });
    if (!completion.ok) return { ok: false, stage: "complete_task", state_path: statePath, worker: nextWorker, completion };
  }

  writeJson(statePath, state);
  return {
    ok: true,
    track_id: track.track_id,
    state_path: path.relative(root, statePath),
    worker: nextWorker,
    completion,
    summary: {
      total_workers: state.workers.length,
      completed_workers: state.completed_workers,
      merged_workers: state.merged_workers,
      conflict_workers: state.conflict_workers,
    },
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
  const safety = controlPlaneSyncSafety(root, mode, remote, branch);
  if (!safety.ok) {
    return { ok: false, mode, remote, branch, safety, commands };
  }
  if (mode === "pre") {
    commands.push(runCommand("git", ["pull", "--rebase", remote, branch], { cwd: root }));
    if (commandExists("bd", root)) commands.push(runCommand("bd", ["dolt", "pull"], { cwd: root }));
  } else if (mode === "post") {
    if (commandExists("bd", root)) commands.push(runCommand("bd", ["dolt", "push"], { cwd: root }));
    commands.push(runCommand("git", ["push", remote, branch], { cwd: root }));
  } else {
    return { ok: false, error: `Invalid sync mode: ${mode}`, commands };
  }
  return { ok: commands.every((cmd) => cmd.ok), mode, remote, branch, safety, commands };
}

function testCoverage(root, args = {}) {
  const coverageRun = runCoverage(root, args);
  if (!coverageRun.available) return coverageRun;
  const { command, result, coverage } = coverageRun;
  let task_result = null;
  if (args.trackId) {
    const track = findTrack(root, args.trackId);
    if (!track) {
      return { ok: false, available: true, command, result, coverage, error: `Track not found: ${args.trackId}` };
    }
    const metadata = { ...track.metadata };
    metadata.last_test_run = {
      command,
      ok: result.ok,
      status: result.status,
      signal: result.signal,
      coverage,
      measured_at: utcNow(),
    };
    if (typeof coverage === "number") metadata.last_coverage = coverage;
    writeJson(track.metadata_path, metadata);
    if (args.phaseIndex && args.taskIndex) {
      task_result = recordTaskResult(root, {
        trackId: args.trackId,
        phaseIndex: args.phaseIndex,
        taskIndex: args.taskIndex,
        status: args.status || (result.ok ? "completed" : "blocked"),
        commitSha: args.commitSha,
        coverage,
      });
    }
  }
  return {
    ok: result.ok,
    available: true,
    command,
    status: result.status,
    signal: result.signal,
    coverage,
    coverage_source: coverageRun.coverage_source,
    timed_out: result.signal === "SIGTERM" || result.signal === "SIGKILL",
    stdout_tail: result.stdout.slice(-4000),
    stderr_tail: result.stderr.slice(-4000),
    task_result,
  };
}

function providerFromConfig(root, args = {}) {
  if (args.provider) return args.provider;
  const config = loadTopology(root).config || {};
  if (config.pr_provider) return config.pr_provider;
  const remote = runCommand("git", ["remote", "get-url", "origin"], { cwd: root });
  const url = `${remote.stdout}\n${remote.stderr}`.toLowerCase();
  if (url.includes("gitlab")) return "gitlab";
  return "github";
}

function prCiStatus(root, args = {}) {
  const provider = providerFromConfig(root, args);
  const track = args.trackId ? findTrack(root, args.trackId) : null;
  const branch = args.branch || (track && (track.metadata.git_branch || `track/${track.track_id}`)) || null;
  if (provider === "github") {
    if (!commandExists("gh", root)) {
      return { ok: false, available: false, provider, reason: "GitHub CLI (gh) is not installed or not on PATH" };
    }
    const target = args.pr || args.prNumber || branch;
    if (!target) return { ok: false, available: true, provider, reason: "No PR number or branch supplied" };
    const fields = [
      "number",
      "url",
      "state",
      "title",
      "headRefName",
      "headRefOid",
      "baseRefName",
      "reviewDecision",
      "mergeStateStatus",
      "statusCheckRollup",
    ].join(",");
    const result = runCommand("gh", ["pr", "view", String(target), "--json", fields], { cwd: root });
    let data = null;
    try {
      data = JSON.parse(result.stdout || "{}");
    } catch (_) {
      // Keep raw output below.
    }
    return {
      ok: result.ok,
      available: true,
      provider,
      target,
      branch,
      status: result.status,
      pr: data,
      stdout_tail: result.stdout.slice(-2000),
      stderr_tail: result.stderr.slice(-2000),
    };
  }
  if (provider === "gitlab") {
    if (!commandExists("glab", root)) {
      return { ok: false, available: false, provider, reason: "GitLab CLI (glab) is not installed or not on PATH" };
    }
    const target = args.pr || args.mr || args.prNumber || branch;
    if (!target) return { ok: false, available: true, provider, reason: "No MR number or branch supplied" };
    const result = runCommand("glab", ["mr", "view", String(target), "--output", "json"], { cwd: root });
    let data = null;
    try {
      data = JSON.parse(result.stdout || "{}");
    } catch (_) {
      // Keep raw output below.
    }
    return {
      ok: result.ok,
      available: true,
      provider,
      target,
      branch,
      status: result.status,
      mr: data,
      stdout_tail: result.stdout.slice(-2000),
      stderr_tail: result.stderr.slice(-2000),
    };
  }
  return { ok: false, available: false, provider, reason: `Unsupported provider: ${provider}` };
}

function diffSurface(root, base, head) {
  const range = `${base}...${head}`;
  const stat = runCommand("git", ["diff", "--stat", range], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const names = runCommand("git", ["diff", "--name-only", range], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  return {
    ok: stat.ok || names.ok,
    base,
    head,
    stat: stat.stdout.trim(),
    files: names.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    errors: [stat.stderr, names.stderr].filter(Boolean).join("\n").trim(),
  };
}

function scanReviewTodos(root, files, limit = 100) {
  const findings = [];
  const patterns = [
    /\bTODO\b/i,
    /\bFIXME\b/i,
    /\bstub\b/i,
    /throw new Error\(["']not implemented/i,
  ];
  for (const file of files || []) {
    if (isIgnoredRepoMapFile(file)) continue;
    const abs = path.join(root, file);
    if (!fileExists(abs)) continue;
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (_) {
      continue;
    }
    if (stat.size > 1024 * 1024) continue;
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length && findings.length < limit; index += 1) {
      const line = lines[index];
      if (patterns.some((pattern) => pattern.test(line))) {
        findings.push({ file, line: index + 1, snippet: line.trim().slice(0, 180) });
      }
    }
  }
  return findings;
}

function reviewAssist(root, args = {}) {
  const trackId = args.trackId || args.track_id;
  if (!trackId) return { ok: false, error: "trackId is required" };
  const context = trackContext(root, trackId);
  if (!context.ok) return context;
  const base = args.base || "main";
  const head = args.head || context.track.git_branch || "HEAD";
  const diff = diffSurface(root, base, head);
  const incompleteTasks = [];
  for (const phase of context.plan.phases || []) {
    for (const task of phase.tasks || []) {
      if (task.marker !== "x" && task.marker !== "-") {
        incompleteTasks.push({
          phase: phase.phase_index,
          task: task.task_index,
          task_key: task.task_key,
          title: task.title,
          marker: task.marker,
        });
      }
    }
  }
  const todos = scanReviewTodos(root, diff.files, Number(args.todoLimit || 100));
  const lsp = args.includeLsp === false ? null : lspReview(root, { base, head, config: args.config });
  const blocking = [];
  if (incompleteTasks.length > 0) blocking.push(`${incompleteTasks.length} plan task(s) are not completed or skipped`);
  if (todos.length > 0) blocking.push(`${todos.length} TODO/FIXME/stub marker(s) found in changed files`);
  if (context.track.last_coverage == null) blocking.push("No measured coverage recorded on the track");
  if (lsp && lsp.available !== false && Array.isArray(lsp.findings)) {
    const lspBlocking = lsp.findings.filter((finding) => finding.severity === "blocking" || finding.blocking === true);
    if (lspBlocking.length > 0) blocking.push(`${lspBlocking.length} blocking LSP/code-intelligence finding(s)`);
  }

  return {
    ok: true,
    root,
    track_id: trackId,
    base,
    head,
    diff,
    task_counts: context.task_counts,
    incomplete_tasks: incompleteTasks,
    coverage: context.track.last_coverage,
    todos,
    lsp,
    suggested_verdict: blocking.length === 0 ? "approved" : "changes_requested",
    blocking_reasons: blocking,
  };
}

function isIgnoredRepoMapFile(file) {
  const normalized = String(file || "").replace(/\\/g, "/");
  if (!normalized) return true;
  if (normalized.startsWith(".agents/")) return true;
  if (normalized.startsWith(".claude/")) return true;
  if (normalized.startsWith(".claude-plugin/")) return true;
  if (normalized.startsWith("plugins/cadre/")) return true;
  if (normalized.startsWith("plugins/cadre-claude/")) return true;
  return normalized
    .split("/")
    .some((part) => [".git", ".beads", "node_modules", "dist", "build", "coverage"].includes(part));
}

function gitTrackedFiles(root) {
  const result = runCommand("git", ["ls-files"], { cwd: root });
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !isIgnoredRepoMapFile(file));
}

function languageForFile(file) {
  return {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".rb": "ruby",
    ".php": "php",
  }[path.extname(file)] || null;
}

function extractRepoSymbols(root, file, limitPerFile = 40) {
  const abs = path.join(root, file);
  if (!fileExists(abs)) return [];
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (_) {
    return [];
  }
  if (stat.size > 1024 * 1024) return [];
  const language = languageForFile(file);
  if (!language) return [];
  const text = fs.readFileSync(abs, "utf8");
  const patterns = [
    /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g,
    /\b(?:export\s+)?(?:class|interface|type|enum|struct)\s+([A-Za-z_$][\w$]*)\b/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g,
    /^\s*def\s+([A-Za-z_][\w]*)\b/gm,
    /^\s*class\s+([A-Za-z_][\w]*)\b/gm,
    /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\b/gm,
  ];
  const symbols = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) && symbols.length < limitPerFile) {
      const prefix = text.slice(0, match.index);
      const line = prefix.split(/\r?\n/).length;
      symbols.push({ name: match[1], file, line, language });
    }
  }
  return symbols;
}

function repoMap(root, args = {}) {
  const limit = Number(args.limit || 200);
  const symbol = args.symbol ? String(args.symbol) : null;
  if (symbol) {
    const result = runCommand("git", ["grep", "-n", "-w", "--", symbol], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    const matches = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !isIgnoredRepoMapFile(line.split(":")[0]))
      .slice(0, limit)
      .map((line) => {
        const [file, lineNo, ...rest] = line.split(":");
        return { file, line: Number(lineNo), snippet: rest.join(":").trim().slice(0, 180) };
      });
    return { ok: result.ok || matches.length > 0, root, symbol, matches, truncated: matches.length >= limit };
  }
  const files = gitTrackedFiles(root);
  const byLanguage = {};
  const symbols = [];
  for (const file of files) {
    const language = languageForFile(file);
    if (language) byLanguage[language] = (byLanguage[language] || 0) + 1;
    if (symbols.length < limit) symbols.push(...extractRepoSymbols(root, file, 12));
    if (symbols.length > limit) symbols.length = limit;
  }
  return {
    ok: true,
    root,
    files: files.length,
    by_language: Object.fromEntries(Object.entries(byLanguage).sort()),
    symbols,
    truncated: symbols.length >= limit,
  };
}

function lspImpact(root, args = {}) {
  const limit = Number(args.limit || 50);
  const symbols = Array.isArray(args.symbols)
    ? args.symbols
    : (args.symbol ? [args.symbol] : []);
  const files = Array.isArray(args.files) ? args.files : [];
  const symbolResults = {};
  for (const symbol of symbols.filter(Boolean)) {
    symbolResults[symbol] = repoMap(root, { symbol, limit });
  }
  const fileSymbols = {};
  for (const file of files) {
    if (isIgnoredRepoMapFile(file)) continue;
    fileSymbols[file] = extractRepoSymbols(root, file, limit);
  }
  const review = args.base || args.head
    ? lspReview(root, { base: args.base || "main", head: args.head || "HEAD", config: args.config })
    : null;
  return {
    ok: true,
    root,
    symbols: symbolResults,
    files: fileSymbols,
    review,
  };
}

function lspConfigStatus(root) {
  const configPath = path.join(root, "cadre", "lsp.json");
  const config = readJson(configPath, null);
  if (!config) {
    return {
      configured: false,
      path: path.relative(root, configPath),
      servers: [],
      missing: [],
    };
  }
  const servers = Array.isArray(config.servers) ? config.servers : [];
  return {
    configured: true,
    path: path.relative(root, configPath),
    servers: servers.map((server) => ({
      id: server.id || server.command || "unknown",
      command: server.command || null,
      available: server.command ? commandExists(server.command, root) : false,
    })),
    missing: servers
      .filter((server) => !server.command || !commandExists(server.command, root))
      .map((server) => server.id || server.command || "unknown"),
  };
}

function mergeDriverStatus(root) {
  const result = runCommand("git", ["config", "merge.ours.driver"], { cwd: root });
  return {
    configured: result.ok && result.stdout.trim() !== "",
    value: result.stdout.trim() || null,
  };
}

function doctor(root, options = {}) {
  const candidateRoot = path.resolve(root || process.cwd());
  const generatedCheck = path.join(candidateRoot, "scripts", "generate-skills.sh");
  const checks = {
    mcp_runtime: { ok: true, server: "cadre" },
    cadre_project: {
      ok: Boolean(options.hasCadreProject || isCadreProjectRoot(candidateRoot)),
      root: candidateRoot,
      markers: [
        "cadre/tracks.md",
        "cadre/setup_state.json",
        "cadre/product.md",
        "cadre/config.json",
        "cadre/beads.json",
        "cadre/lsp.json",
      ].filter((name) => fileExists(path.join(candidateRoot, name))),
    },
    git: {
      available: commandExists("git", candidateRoot),
      identity: gitIdentity(candidateRoot),
      merge_ours: mergeDriverStatus(candidateRoot),
    },
    beads: {
      available: commandExists("bd", candidateRoot),
      config_present: fileExists(path.join(candidateRoot, "cadre", "beads.json")),
    },
    lsp: lspConfigStatus(candidateRoot),
    providers: {
      gh: commandExists("gh", candidateRoot),
      glab: commandExists("glab", candidateRoot),
    },
    generated_bundles: {
      check_available: fileExists(generatedCheck),
      command: fileExists(generatedCheck) ? "bash scripts/generate-skills.sh --check" : null,
    },
  };
  const warnings = [];
  if (!checks.cadre_project.ok) {
    warnings.push("No Cadre project markers found. This is fine for the Cadre harness/source repo, but project-scoped Cadre workflows need setup first.");
  }
  if (checks.cadre_project.ok && !checks.beads.available) {
    warnings.push("Beads CLI (bd) is not available; Cadre project workflows require it.");
  }
  if (checks.lsp.configured && checks.lsp.missing.length > 0) {
    warnings.push(`LSP config exists but missing server commands: ${checks.lsp.missing.join(", ")}`);
  }
  return {
    ok: warnings.length === 0,
    root: candidateRoot,
    checks,
    warnings,
  };
}

function beadsTaskWrite(root, args = {}) {
  if (!commandExists("bd", root)) {
    return { ok: false, available: false, reason: "Beads CLI (bd) is not installed or not on PATH" };
  }
  const op = args.operation;
  const id = args.id || args.taskId || args.issueId;
  const commands = [];
  const runBd = (bdArgs) => {
    const result = runCommand("bd", bdArgs, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    commands.push(result);
    return result;
  };
  if (op === "ready") {
    const bdArgs = ["ready", "--json"];
    if (args.parent) bdArgs.push("--parent", String(args.parent));
    runBd(bdArgs);
  } else if (op === "show") {
    if (!id) return { ok: false, available: true, error: "id is required for show" };
    runBd(["show", String(id), "--json"]);
  } else if (op === "update") {
    if (!id) return { ok: false, available: true, error: "id is required for update" };
    const bdArgs = ["update", String(id), "--json"];
    if (args.status) bdArgs.push("--status", String(args.status));
    if (Object.prototype.hasOwnProperty.call(args, "assignee")) bdArgs.push("--assignee", String(args.assignee || ""));
    if (args.priority) bdArgs.push("--priority", String(args.priority));
    runBd(bdArgs);
  } else if (op === "note") {
    if (!id || !args.note) return { ok: false, available: true, error: "id and note are required for note" };
    runBd(["note", String(id), String(args.note), "--json"]);
  } else if (op === "close") {
    if (!id) return { ok: false, available: true, error: "id is required for close" };
    const bdArgs = ["close", String(id), "--reason", String(args.reason || "Task completed"), "--json"];
    if (args.continue === true) bdArgs.splice(2, 0, "--continue");
    runBd(bdArgs);
  } else if (op === "label_add" || op === "label_remove") {
    if (!id || !args.label) return { ok: false, available: true, error: "id and label are required for label operations" };
    runBd(["label", op === "label_add" ? "add" : "remove", String(id), String(args.label), "--json"]);
  } else if (op === "dep_add") {
    if (!id || !args.dependsOn) return { ok: false, available: true, error: "id and dependsOn are required for dep_add" };
    runBd(["dep", "add", String(id), String(args.dependsOn), "--json"]);
  } else if (op === "create") {
    if (!args.title) return { ok: false, available: true, error: "title is required for create" };
    const bdArgs = ["create", String(args.title), "--json"];
    if (args.type) bdArgs.push("-t", String(args.type));
    if (args.parent) bdArgs.push("--parent", String(args.parent));
    if (args.priority) bdArgs.push("-p", String(args.priority));
    if (args.deps) bdArgs.push("--deps", String(args.deps));
    runBd(bdArgs);
  } else {
    return {
      ok: false,
      available: true,
      error: `Unsupported Beads operation: ${op}`,
      operations: ["ready", "show", "update", "note", "close", "label_add", "label_remove", "dep_add", "create"],
    };
  }
  const ok = commands.every((cmd) => cmd.ok);
  let json = null;
  const last = commands[commands.length - 1];
  try {
    json = JSON.parse(last && last.stdout ? last.stdout : "null");
  } catch (_) {
    // Keep raw output.
  }
  return { ok, available: true, operation: op, commands, json };
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
  beadsTaskWrite,
  claimTrack,
  completeTask,
  collisionScan,
  createBeadsTree,
  doctor,
  gitIdentity,
  implementationPrep,
  isCadreProjectRoot,
  isIgnoredRepoMapFile,
  listTracks,
  liveStatus,
  loadTopology,
  lspImpact,
  lspReview,
  parsePlanFile,
  parsePlanText,
  planClaims,
  planIntegrity,
  polyrepoPreflight,
  prCiStatus,
  recordParallelWorker,
  recordReview,
  recordTaskResult,
  regenIndex,
  repoMap,
  reviewAssist,
  reviewGate,
  setTrackStatus,
  syncControlPlane,
  teamBoard,
  teamStatus,
  testCoverage,
  trackContext,
};
