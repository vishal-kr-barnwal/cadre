export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export type UnknownRecord = Record<string, unknown>;

export interface CommandResult extends JsonObject {
  ok: boolean;
  status: number | null;
  signal?: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
  cwd?: string | undefined;
  error?: string;
  timed_out?: boolean;
}

export interface LockInfo extends JsonObject {
  name?: string;
  pid?: number;
  owner?: string | null;
  acquired_at?: string;
  updated_at?: string;
  hostname?: string;
}

export interface CadreLock extends JsonObject {
  ok: boolean;
  dir?: string;
  info?: LockInfo;
  attempts?: number;
  conflict?: boolean;
  stale?: boolean;
  holder?: LockInfo;
  error?: string;
}

export type TrackStatus = "new" | "in_progress" | "completed" | "blocked" | "skipped";

export interface ReviewMetadata extends JsonObject {
  verdict?: "approved" | "changes_requested" | string;
  blocking_count?: number;
  date?: string;
  reviewer?: string | null;
  coverage?: number | null;
  self_reviewed?: boolean;
  reviewed_sha?: string | null;
  reviewed_shas?: JsonObject;
  review_seq?: number;
}

export interface LeaseMetadata extends JsonObject {
  owner?: string | null;
  identity?: string | null;
  acquired_at?: string;
  updated_at?: string;
  expires_at?: string;
  pid?: number;
}

export interface TrackMetadata extends JsonObject {
  track_id?: string;
  name?: string;
  type?: string;
  status?: TrackStatus | string;
  priority?: string;
  depends_on?: JsonValue[];
  description?: string;
  owner?: string | null;
  reviewer?: string | null;
  git_branch?: string;
  worktree_path?: string;
  beads_epic?: string | null;
  beads_tasks?: JsonObject;
  last_coverage?: number | null;
  review?: ReviewMetadata;
  review_evidence?: JsonObject;
  lease?: LeaseMetadata;
}

export interface CadreTrack {
  track_id: string;
  dir: string;
  metadata_path: string;
  metadata: TrackMetadata;
  plan_path: string;
  spec_path: string;
  learnings_path?: string;
}

export interface PlanTask {
  index?: number;
  key?: string;
  task_index: number;
  task_key: string;
  title: string;
  marker: string;
  annotations: JsonObject;
  files: string[];
  depends: string[];
  repo?: string | null;
  commit?: string | null;
  commit_shas?: string[];
  repo_shas?: JsonObject;
  line: number;
  phase_index: number;
}

export interface PlanPhase {
  index?: number;
  key?: string;
  phase_index: number;
  title: string;
  execution?: "parallel" | "serial" | "sequential" | string;
  annotations: JsonObject;
  depends?: string[];
  depends_on?: string[];
  phase_id?: string;
  status?: string;
  claims?: JsonObject[];
  repo?: string | null;
  tasks: PlanTask[];
  line?: number | undefined;
}

export interface ParsedPlan {
  ok: boolean;
  phases: PlanPhase[];
  tasks: PlanTask[];
  warnings: string[];
  errors: string[];
}

export interface RepoEntry extends JsonObject {
  name?: string;
  submodule_path?: string;
  enabled?: boolean;
  default_branch?: string;
}

export interface Topology {
  polyrepo: boolean;
  repos: {
    mode?: string;
    default_repo?: string;
    repos?: RepoEntry[];
  };
}

export interface RuntimeArgs extends JsonObject {
  root?: string | undefined;
  action?: string | undefined;
  workflow?: string | undefined;
  execute?: boolean | undefined;
  async?: boolean;
  trackId?: string | undefined;
  track_id?: string | undefined;
  phaseIndex?: number | undefined;
  taskIndex?: number | undefined;
  planPath?: string;
  status?: string;
  patch?: JsonObject;
  identity?: string | null;
  takeover?: boolean;
  base?: string | undefined;
  head?: string | undefined;
  config?: string | undefined;
  operation?: string;
  id?: string;
  command?: string | undefined;
  machineCommand?: string | undefined;
  timeoutMs?: number | undefined;
  provider?: string;
  symbol?: string | undefined;
  symbols?: string[];
  files?: string[];
  args?: JsonObject;
  type?: string;
  jobId?: string;
  includeLsp?: boolean;
  includeMachine?: boolean;
  todoLimit?: number;
  lspResult?: JsonObject;
  lsp_result?: JsonObject;
  dryRun?: boolean;
  planText?: string;
  specText?: string;
  techStack?: JsonObject;
  styleGuideIds?: string[] | string;
  styleGuideMaxChars?: number;
  metadata?: TrackMetadata;
  lock?: boolean;
  lockName?: string;
  lockOptions?: JsonObject;
  retries?: number;
  cwd?: string | undefined;
  shell?: boolean;
  maxBuffer?: number;
  coverageThreshold?: number | undefined;
  allowMissingCoverage?: boolean | undefined;
  allowLowCoverage?: boolean | undefined;
  reason?: string;
  commit?: string;
  commitSha?: string | null | undefined;
  completeTask?: boolean;
  mode?: string;
  remote?: string;
  branch?: string | null;
  mine?: boolean;
  headSha?: string;
  headShas?: JsonObject;
  reviewedSha?: string;
  reviewed_sha?: string;
  reviewedShas?: JsonObject;
  reviewed_shas?: JsonObject;
  repo?: string | null | undefined;
  workingRoot?: string | null | undefined;
  claim?: boolean;
  threshold?: number;
  limit?: number;
  epicId?: string;
  assignee?: string;
  taskId?: string | null;
  beadsTaskId?: string | null | undefined;
  workerId?: string | null;
  worker_id?: string | null;
  worktree?: string | null;
  summary?: string;
  lastTestRun?: JsonObject | undefined;
  coverage?: number | null | undefined;
  allowOverride?: boolean;
  reviewer?: string;
  verdict?: string;
  blockingCount?: number;
  date?: string;
  machine_command?: string;
  pr?: number;
  prNumber?: number | string;
  mr?: number | string;
  issueId?: string;
  note?: string;
  dedupKey?: string;
  continue?: boolean;
  allowNoPr?: boolean;
  allowNoCommit?: boolean;
  now?: string;
  evidence?: JsonObject | string;
  hasCadreProject?: boolean;
  parent?: string;
  label?: string;
  long?: boolean;
  priority?: string | number;
  notes?: string;
  dependsOn?: string;
  title?: string;
  deps?: string;
  labels?: string[] | string;
  design?: string;
  acceptance?: string;
  ephemeral?: boolean;
  to?: string;
  subject?: string;
  body?: string;
  name?: string;
  all?: boolean;
  sql?: string;
  path?: string;
  force?: boolean;
}

export interface Envelope<T = JsonValue> {
  ok: boolean;
  data: T | null;
  warnings: string[];
  errors: string[];
  commands?: JsonValue;
  job?: JsonValue;
}

export interface TextJsonResult {
  content: Array<{ type: "text"; text: string }>;
}
