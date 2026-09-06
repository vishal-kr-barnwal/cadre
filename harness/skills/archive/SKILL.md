---
name: archive
description: Archive one or more completed Cadre tracks in one approved, resumable batch; distill their incremental learning with existing patterns, rebuild the pattern catalog, and reseed non-completed tracks by relevance. Use for the archive command after clean approved reviews.
---

# Cadre Archive

Archive one or more `completed` tracks in a single batch. Read `.cadre/workflow.md`, every artifact and recorded commit for every selected track, the complete pattern catalog, active-track status summaries, and relevant implementation files. Use catalog applicability, provenance, and supersession summaries to identify affected patterns and active tracks, then read their full pattern/spec/plan/seed artifacts before proposing changes. If metadata is missing, incomplete, or ambiguous, read the full catalog bodies and active specs/plans/seeds. Never exclude guidance by keyword alone.

At every required selection or approval boundary, show a concise batch summary or focused diff. Inspect the active host policy before calling `workflow_elicit`: if the task context reports approval policy `never`, including Codex Full Access, skip the form and ask the same short question once in chat. Otherwise prefer `workflow_elicit`, using `clarification` for at most three questions and `approval` bound to the archive proposal digest. Treat only an `approved` result as approval. If it returns `fallback_required`, or immediately returns `declined` while the task explicitly reports policy `never`, ask the same short question once in chat; the latter is policy rejection, not a human decline. Never request secrets or retry the form.

Call `project_status` first with `view: "project"` and use its embedded structured validation; do not repeat `state_validate` at command entry. Stop when `valid` is false or the Cadre MCP is unavailable; do not start or advance an archive batch.

Build one bounded archive inventory after selection. Read every selected artifact exactly once, summarize execution journals structurally in one pass, and verify recorded commit reachability in one Git pass. Do not precede reads with line counts, rediscover the same paths, or restart full reads after truncation; continue from the first unread line. Reuse unchanged workflow/product/styleguide context already loaded in the same flow. Fetch known pattern templates directly with one `template_get_many` call and use descriptor tools when an ID must be resolved; do not discover MCP resources. The declared mutation surface is adaptive `archive_batch_candidate` followed by atomic `archive_batch_record`; do not inspect the installed runtime or tool catalog for alternatives.

Expected human decision count is one for the complete batch. Ask again only when its selection, content, or consequences change.

1. Accept an explicit list of track IDs. When selection is omitted or the human says `all completed`, omit `selectedTracks`; the server selects every eligible completed track in dependency order. Preserve an explicit order and remove duplicates.
2. Verify the entire selection before changing anything. Every selected track must be `completed`, have clean centralized `state_validate`, and have no pending state mutation. Do not recompute its DAG, manual-verification barriers, or review evidence inside archive; those are completed-state invariants. Reject the batch without partial mutation if any selected track is ineligible. Ignore completed tracks that were not selected.
3. If an in-progress `.cadre/operations/archive-<timestamp>.json` exists, reconcile it before accepting a new batch. Resume from its first incomplete checkpoint. If its journal, files, Git state, or expected commit disagree, stop and present the mismatch.
4. Distill durable, evidenced learning across the selected tracks as one corpus; discard track-specific trivia. Merge, replace, split, or retire existing patterns when justified, preserving provenance to every contributing track/phase/task commit. Reconcile overlapping or conflicting learning once so batch order cannot silently change the result.
5. Keep catalog summaries and applicability/provenance/supersession information complete. Compute relevant Pattern Seed section changes in `learning.md` for every non-completed, non-archived track using the final proposed pattern set. Never seed by keyword alone; explain semantic relevance.
6. Call `candidate_stage_prepare` for `archive-<proposal-id>` with `expectedFiles` equal to every proposed pattern, pattern-index, and active-track seed path, then write exactly that set. Call `archive_batch_candidate` with `request: { mode: "prepare", projectRoot, candidateId, selectedTracks?, updates }`; `updates` contains the required body-free descriptors. Present the resulting proposal once.
7. After approval, call only `request: { mode: "apply", proposalToken }` on `archive_batch_candidate`; it re-reads staged files and rejects drift. Never make the two calls consecutively without the human decision between them. Commit all approved moves and derived changes together, keep the matching candidate stage through that checkpoint, and never stage it.
8. Call `archive_batch_record` once with the project root and batch ID; it derives the actual current HEAD and atomically records deterministic provenance and the generated index without another approval. Create `cadre(archive): record batch <batch-id>`, then remove only the matching candidate stage.
9. Use the final apply result instead of redundant `state_validate` or `project_status` calls when it is valid/current. Verify only the clean worktree and the two expected commits.

If interrupted, reuse the same approved apply token; the journal and approved hashes converge remaining moves/writes without another approval. Provenance recording is idempotent and never duplicates track/project history. Never redistill or start a second batch while one is active.

Do not delete learning, review cycles, revisions, bug reports, or commit provenance.

## Memory contract

Preserve phase history and existing handoffs. For active v3 tracks, keep the marked `cadre:memory` JSON block inside Pattern Seed synchronized with the proposed spec/plan revisions and exact approved pattern hashes. Every applicable pattern requires its safe `patterns/<slug>.md` path, SHA-256, and human-readable relevance/constraints; never invent or silently omit guidance. When a staged plan changes revisions, include the reassessed learning file in `expectedFiles`. Inspect `candidate_inspect.learning` and `memoryInputs` as well as `plans`; resolve invalid or stale memory before approval. Immediately before direct promotion, re-inspect and compare the complete approved digest, including unchanged memory inputs; changed inputs require reassessment and a corrected approval. Archive apply performs this check in the runtime. Completed and archived learning remains historical evidence, not a claim that old hashes describe current patterns.

## Evidence quality and proposal identity

Before promoting an observation into a pattern, verify it against actual imports, source and relevant tests; distinguish observed facts, hypotheses and scope decisions. Hashes establish freshness, not truth. Do not infer that an assertion is loose from its method name without checking the imported module, or that no I/O implies no trust boundary. Correct mistaken historical claims explicitly in new guidance with evidence, preserving completed history.

Prepare results describe prospective operation paths; check disk before claiming that a journal exists or is duplicated. Apply alone persists the archive journal. The public proposal digest binds the complete preview; the persisted approvalDigest binds the batch inputs/updates. They serve different purposes. Resume using the persisted batch identity, approved file hashes and actual artifact commit; do not interpret the differing digests alone as source drift.
