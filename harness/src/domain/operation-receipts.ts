import { readGitBlobs } from "./git.js";
import { recordedRecoveryInputs, mergeRecoveryInputs, type RecoveryInput } from "./recovery-inputs.js";
import { requireReviewFreshness } from "./review-freshness.js";
import { requireRevertFreshness, revertApprovalProofSchema } from "./revert-freshness.js";
import { requireInitFreshness } from "./init-freshness.js";
import { repositoryBasisSchema, type RepositoryBasis } from "./repository-basis.js";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, fsyncSync, openSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod/v4";
import { safeProjectRoot } from "./paths.js";
import { CadreError } from "./errors.js";
import { inspectionValue, countGitProcess } from "./inspection.js";

/** A stable reference avoids writing a commit's own SHA back into tracked state. */
export type CommitRef = string;
const operationId = z.string().regex(/^[a-z0-9][a-z0-9-]{7,95}$/);
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const isCommitRef = (value: unknown): value is CommitRef => typeof value === "string"
  && (/^[0-9a-f]{7,40}$/.test(value) || /^op:[a-z0-9][a-z0-9-]{7,95}$/.test(value));
export const operationRef = (id: string): CommitRef => `op:${operationId.parse(id)}`;
export const receiptSchema = z.strictObject({ schemaVersion: z.literal(1), operationId, kind: z.enum(["create", "track", "revise", "refresh", "implement", "review", "archive", "revert"]),
  status: z.literal("completed"), approvalDigest: digest, baseCommit: sha.nullable(),
  artifacts: z.array(z.strictObject({ path: z.string(), sha256: digest.nullable() })).min(1) });
export type OperationReceipt = z.infer<typeof receiptSchema>;
export interface ReceiptFile { path: string; content: string | null }
export type OperationPromotionInput = Omit<OperationReceipt, "schemaVersion" | "status" | "artifacts"> & { inputs?: RecoveryInput[]; createBasis?: RepositoryBasis };
const recoverySchema = z.strictObject({ receipt: receiptSchema, inputs: z.array(z.strictObject({ path: z.string(), sha256: digest })).optional(),
  revertApproval: revertApprovalProofSchema.optional(), reviewBeforeState: z.string().max(1024 * 1024).optional(), createBasis: repositoryBasisSchema.optional(),
  files: z.array(z.strictObject({ path: z.string(), content: z.string().nullable(), before: digest.nullable() })).min(1) });
type Recovery = z.infer<typeof recoverySchema>;
function parseRecovery(body: string): Recovery {
  const recovery = recoverySchema.parse(JSON.parse(body));
  const manifest = recovery.files.map((file) => ({ path: file.path, sha256: file.content === null ? null : receiptHash(file.content) })).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(manifest) !== JSON.stringify(recovery.receipt.artifacts)) throw new Error("Recovery contents disagree with the approved receipt");
  return recovery;
}
export const receiptHash = (content: string) => createHash("sha256").update(content).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const receiptPath = (id: string) => `.cadre/receipts/${operationId.parse(id)}.json`;
const recoveryPath = (id: string) => `.cadre/stage/operations/${operationId.parse(id)}.json`;

function git(root: string, args: string[]) {
  countGitProcess();
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function target(root: string, path: string): string {
  if (!path.startsWith(".cadre/") || /[\\\0\r\n]/.test(path) || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe operation artifact path");
  const absolute = join(root, path);
  let current = root;
  for (const part of relative(root, absolute).split("/")) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Unsafe symbolic link: ${path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return absolute;
}
function currentHash(root: string, path: string): string | null {
  const absolute = target(root, path);
  return existsSync(absolute) ? receiptHash(readFileSync(absolute, "utf8")) : null;
}
function requireUnchangedInputs(root: string, inputs: Array<{ path: string; sha256: string }>): void {
  const paths = inputs.filter((input) => currentHash(root, input.path) !== input.sha256).map((input) => input.path);
  if (paths.length) throw new CadreError("OPERATION_INPUT_DRIFT", "Required inputs changed after approval; preserve the pending operation and reassess before resuming", { paths });
}
function write(root: string, file: ReceiptFile): void {
  const path = target(root, file.path);
  if (file.content === null) {
    if (existsSync(path)) unlinkSync(path);
    let parent = dirname(path);
    while (parent !== join(root, ".cadre") && existsSync(parent) && readdirSync(parent).length === 0) { rmdirSync(parent); parent = dirname(parent); }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, file.content, { flag: "wx" });
    const descriptor = openSync(temp, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temp, path);
    const directory = openSync(dirname(path), "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}

/** No Git writes. Persist intent first; repeat promotion safely after interruption. */
export function promoteOperation(rootInput: string, input: OperationPromotionInput,
  files: ReceiptFile[], afterWrite?: (path: string) => void) {
  const root = safeProjectRoot(rootInput);
  if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("Duplicate operation artifacts");
  if (files.some((file) => /^\.cadre\/(?:stage|receipts|\.worktrees|wisps)\//.test(file.path))) throw new Error("Operation cannot promote temporary state or overwrite receipts");
  const recoveryFile = target(root, recoveryPath(input.operationId));
  const stored = existsSync(recoveryFile) ? parseRecovery(readFileSync(recoveryFile, "utf8")) : null;
  const recorded = recordedRecoveryInputs(files);
  const inputs = input.inputs !== undefined ? mergeRecoveryInputs(files, [...input.inputs, ...recorded])
    : stored ? stored.inputs : recorded;
  const {inputs: _inputs, createBasis: _createBasis, ...receiptInput} = input;
  const receipt = receiptSchema.parse({ ...receiptInput, schemaVersion: 1, status: "completed", artifacts: files.map((file) => ({ path: file.path, sha256: file.content === null ? null : receiptHash(file.content) })).sort((a, b) => a.path.localeCompare(b.path)) });
  const receiptBody = json(receipt), path = recoveryPath(input.operationId);
  let recovery: Recovery;
  if (existsSync(target(root, path))) {
    recovery = parseRecovery(readFileSync(target(root, path), "utf8"));
    if (json(recovery.receipt) !== receiptBody || json(recovery.files.map(({ before: _before, ...file }) => file)) !== json(files)) throw new Error("Pending operation differs from approved promotion");
    if (input.inputs !== undefined && json(inputs) !== json(recovery.inputs ?? recorded)) throw new Error("Pending operation inputs differ from approved promotion");
    if (input.createBasis !== undefined && json(input.createBasis) !== json(recovery.createBasis)) throw new Error("Pending create repository evidence changed");
    try {
      const committed = reconcileOperation(root, input.operationId);
      return { status: "committed" as const, commit: committed, operationId: input.operationId, receiptHash: receiptHash(receiptBody), trailers: trailers(receipt) };
    } catch (error) { if (!(error instanceof CadreError) || error.code !== "COMMIT_PENDING") throw error; }
  } else {
    if (existsSync(target(root, receiptPath(input.operationId)))) {
      const committed = resolveOperation(root, operationRef(input.operationId));
      if (readFileSync(target(root, receiptPath(input.operationId)), "utf8") !== receiptBody) throw new Error("Operation ID is already used by a different receipt");
      return { status: "committed" as const, commit: committed, operationId: input.operationId, receiptHash: receiptHash(receiptBody), trailers: trailers(receipt) };
    }
    const reviewBeforeState = requireReviewFreshness(root, input.kind, files);
    const revertApproval = requireRevertFreshness(root, input.kind, input.operationId, files);
    requireUnchangedInputs(root, inputs ?? recorded);
    if (input.kind === "create") requireInitFreshness(root, files, input.createBasis, false, input.approvalDigest);
    recovery = { receipt, ...(inputs !== undefined ? {inputs} : {}), ...(revertApproval ? {revertApproval} : {}),
      ...(reviewBeforeState ? {reviewBeforeState} : {}), ...(input.createBasis ? {createBasis: input.createBasis} : {}),
      files: files.map((file) => ({ ...file, before: currentHash(root, file.path) })) };
    write(root, { path, content: json(recovery) });
    afterWrite?.(path);
  }
  const reviewBeforeState = requireReviewFreshness(root, recovery.receipt.kind, recovery.files, recovery.reviewBeforeState, recovery.receipt.baseCommit);
  const revertApproval = requireRevertFreshness(root, recovery.receipt.kind, recovery.receipt.operationId, recovery.files, recovery.revertApproval);
  requireUnchangedInputs(root, recovery.inputs ?? recordedRecoveryInputs(recovery.files));
  if (recovery.receipt.kind === "create") requireInitFreshness(root, recovery.files, recovery.createBasis, true, recovery.receipt.approvalDigest);
  for (const file of recovery.files) {
    const actual = currentHash(root, file.path), expected = file.content === null ? null : receiptHash(file.content);
    if (actual !== file.before && actual !== expected) throw new CadreError("OPERATION_PROMOTION_DRIFT", "An artifact changed during operation recovery", { path: file.path });
  }
  if (revertApproval && !recovery.revertApproval || reviewBeforeState && !recovery.reviewBeforeState) {
    if (revertApproval) recovery.revertApproval = revertApproval;
    if (reviewBeforeState) recovery.reviewBeforeState = reviewBeforeState;
    write(root, {path, content: json(recovery)});
  }
  for (const file of recovery.files) { write(root, file); afterWrite?.(file.path); }
  write(root, { path: receiptPath(input.operationId), content: receiptBody });
  afterWrite?.(receiptPath(input.operationId));
  return { status: "commit_pending" as const, commit: null, operationId: input.operationId, receiptHash: receiptHash(receiptBody), trailers: trailers(receipt) };
}

function trailers(receipt: OperationReceipt): string[] {
  return [`Cadre-Operation: ${receipt.operationId}`, `Cadre-Receipt: ${receiptHash(json(receipt))}`];
}

function footerLines(message: string): string[] {
  const footer: string[] = [];
  // Git -m may put each returned trailer in its own paragraph. Accept that
  // footer spelling while still excluding claims embedded in the message body.
  for (const line of message.trimEnd().split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    if (!/^[A-Za-z0-9-]+: .+$/.test(line)) break;
    footer.push(line);
  }
  return footer;
}

/** Resolve only from HEAD's ancestry; require exactly one claim and verify every committed byte. */
export function resolveOperation(rootInput: string, ref: string): string {
  return inspectionValue(`receipt:${safeProjectRoot(rootInput)}:${ref}`, () => resolveOperationUncached(rootInput, ref));
}

function resolveOperationUncached(rootInput: string, ref: string): string {
  const root = safeProjectRoot(rootInput), id = operationId.parse(ref.replace(/^op:/, ""));
  const entries = inspectionValue(`receipt-history:${root}`, () => {
    const history = git(root, ["log", "HEAD", "--format=%H%x00%B%x00", "--fixed-strings", "--grep=Cadre-Operation: "]);
    return history.status === 0 ? history.stdout.split("\0") : [];
  });
  const claims: string[] = [];
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const commit = entries[i]!.trim(), message = entries[i + 1]!;
    if (footerLines(message).includes(`Cadre-Operation: ${id}`)) claims.push(commit);
  }
  if (claims.length !== 1) throw new CadreError(claims.length ? "OPERATION_AMBIGUOUS" : "COMMIT_PENDING", claims.length ? `Multiple reachable commits claim operation ${id}` : `commit_pending: no reachable commit contains operation ${id}`);
  const commit = claims[0]!, stored = git(root, ["show", `${commit}:${receiptPath(id)}`]);
  if (stored.status !== 0) throw new CadreError("OPERATION_RECEIPT_MISSING", "Operation commit has no receipt");
  const receipt = receiptSchema.parse(JSON.parse(stored.stdout));
  const localReceipt = target(root, receiptPath(id));
  if (existsSync(localReceipt) && readFileSync(localReceipt, "utf8") !== stored.stdout) throw new Error("Immutable operation receipt was modified");
  if (receipt.operationId !== id) throw new Error("Committed receipt identity mismatch");
  const message = git(root, ["show", "-s", "--format=%B", commit]).stdout;
  if (footerLines(message).filter((line) => line === `Cadre-Operation: ${id}`).length !== 1 || footerLines(message).filter((line) => line === `Cadre-Receipt: ${receiptHash(stored.stdout)}`).length !== 1) throw new CadreError("OPERATION_RECEIPT_FORGED", "Commit trailer does not match the committed receipt");
  if (receipt.baseCommit && git(root, ["merge-base", "--is-ancestor", receipt.baseCommit, commit]).status !== 0) throw new Error("Operation base is not an ancestor of its commit");
  for (const artifact of receipt.artifacts) target(root, artifact.path);
  const blobs = readGitBlobs(root, receipt.artifacts.map((artifact) => `${commit}:${artifact.path}`));
  for (const artifact of receipt.artifacts) {
    const blob = blobs.get(`${commit}:${artifact.path}`);
    if (artifact.sha256 === null ? blob != null : blob == null || receiptHash(blob) !== artifact.sha256) throw new CadreError("OPERATION_ARTIFACT_MISMATCH", "Committed operation artifact differs from the receipt", { path: artifact.path });
  }
  return commit;
}

/** Cleanup touches ignored recovery state only. */
export function reconcileOperation(root: string, id: string): string {
  const commit = resolveOperation(root, operationRef(id)), path = target(safeProjectRoot(root), recoveryPath(id));
  if (existsSync(path)) {
    const recovery = parseRecovery(readFileSync(path, "utf8"));
    const committed = git(root, ["show", `${commit}:${receiptPath(id)}`]);
    if (committed.stdout !== json(recovery.receipt)) throw new Error("Recovery receipt disagrees with committed receipt");
    unlinkSync(path);
  }
  return commit;
}

/** Retry a completed operation using its immutable receipt, never a new approval. */
export function committedOperationReceipt(root: string, id: string, kind: OperationReceipt["kind"],
  baseCommit?: string, expectedArtifacts: ReceiptFile[] = []) {
  const commit = reconcileOperation(root, id);
  const body = readFileSync(target(safeProjectRoot(root), receiptPath(id)), "utf8");
  const receipt = receiptSchema.parse(JSON.parse(body));
  if (receipt.kind !== kind || baseCommit !== undefined && receipt.baseCommit !== baseCommit) throw new Error("Completed operation does not match the requested identity");
  for (const file of expectedArtifacts) {
    const expected = file.content === null ? null : receiptHash(file.content);
    if (!receipt.artifacts.some((artifact) => artifact.path === file.path && artifact.sha256 === expected)) {
      throw new Error(`Completed operation evidence changed: ${file.path}`);
    }
  }
  return { status: "committed" as const, commit, operationId: id, receiptHash: receiptHash(body), trailers: trailers(receipt) };
}

/** Match the original approval before replaying a completed operation. */
export function committedReceiptForApproval(rootInput: string, id: string, kind: OperationReceipt["kind"],
  approvalDigest: string, baseCommit: string) {
  const root = safeProjectRoot(rootInput), path = target(root, receiptPath(id));
  if (!existsSync(path)) return null;
  const receipt = receiptSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (receipt.approvalDigest !== approvalDigest) throw new Error("Completed operation approval digest differs from the requested approval");
  return committedOperationReceipt(root, id, kind, baseCommit);
}

/** An opaque cached candidate approval identifies the original receipt even after stage cleanup. */
export function committedReceiptForDigest(rootInput: string, kind: OperationReceipt["kind"], approvalDigest: string) {
  const root = safeProjectRoot(rootInput), directory = target(root, ".cadre/receipts");
  if (!existsSync(directory)) return null;
  const matches = readdirSync(directory).filter((file) => file.endsWith(".json")).map((file) => {
    const receipt = receiptSchema.parse(JSON.parse(readFileSync(target(root, `.cadre/receipts/${file}`), "utf8")));
    if (file !== `${receipt.operationId}.json`) throw new Error("Immutable operation receipt filename does not match its identity");
    return receipt;
  }).filter((receipt) => receipt.kind === kind && receipt.approvalDigest === approvalDigest);
  if (matches.length > 1) throw new Error("Multiple operation receipts claim the same approved candidate");
  return matches[0] ? committedOperationReceipt(root, matches[0].operationId, kind) : null;
}

export function resumeOperation(root: string, id: string, approvalDigest: string) {
  const recovery = parseRecovery(readFileSync(target(safeProjectRoot(root), recoveryPath(id)), "utf8"));
  const receipt = receiptSchema.parse(recovery.receipt);
  if (receipt.operationId !== id || receipt.approvalDigest !== approvalDigest) throw new Error("Recovery must match the persisted approved operation");
  return promoteOperation(root, {...receipt, ...(recovery.inputs !== undefined ? {inputs: recovery.inputs} : {}),
    ...(recovery.createBasis ? {createBasis: recovery.createBasis} : {})}, recovery.files.map(({ before: _before, ...file }) => file));
}

/** Locate only the original matching intent; never mint a new approval on retry. */
export function pendingOperationForDigest(rootInput: string, kind: OperationReceipt["kind"], approvalDigest: string): string | null {
  const root = safeProjectRoot(rootInput), directory = target(root, ".cadre/stage/operations");
  if (!existsSync(directory)) return null;
  const matches = readdirSync(directory).filter((file) => file.endsWith(".json")).map((file) => {
    const recovery = parseRecovery(readFileSync(target(root, `.cadre/stage/operations/${file}`), "utf8"));
    if (file !== `${recovery.receipt.operationId}.json`) throw new Error("Recovery journal identity mismatch");
    return recovery.receipt;
  }).filter((receipt) => receipt.kind === kind && receipt.approvalDigest === approvalDigest);
  if (matches.length > 1) throw new Error("Multiple pending operations claim the same approval");
  return matches[0]?.operationId ?? null;
}

/** Read-only recovery gate, including a crash before any canonical state was promoted. */
export function pendingOperationErrors(rootInput: string): string[] {
  const root = safeProjectRoot(rootInput), directory = target(root, ".cadre/stage/operations");
  if (!existsSync(directory)) return [];
  const errors: string[] = [];
  for (const file of readdirSync(directory).filter((file) => file.endsWith(".json"))) {
    try {
      const recovery = parseRecovery(readFileSync(target(root, `.cadre/stage/operations/${file}`), "utf8"));
      const receipt = receiptSchema.parse(recovery.receipt);
      if (file !== `${receipt.operationId}.json`) throw new Error("Recovery journal identity mismatch");
      resolveOperation(root, operationRef(receipt.operationId));
    } catch (error) { errors.push(`${file}: ${String(error)}`); }
  }
  return errors;
}

export function requireCommittedOperations(root: string): void {
  const errors = pendingOperationErrors(root);
  if (errors.length) throw new CadreError("COMMIT_PENDING", "Reconcile pending operations before dependent delivery", { errors });
}
