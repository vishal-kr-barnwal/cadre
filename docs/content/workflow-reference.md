---
title: Workflow Reference
description: Inputs, prerequisites, approval behavior, outputs, resources, and failure modes for every Cadre workflow.
section: Reference
order: 210
---

# Workflow Reference

Invoke workflows through `cadre_workflow` with a root candidate, workflow ID,
structured input when needed, and `execute:false` until the packet is ready for
confirmed mutation. Project-skill selection runs before workflow-specific work.

## Shared Contract

| Concern | Contract |
|---|---|
| Root | Required on every project-scoped call and resolved internally. |
| Clarification | Calls that lack meaningful workflow evidence return prompts without creating approval sessions or template artifacts. |
| Preview | `execute:false` returns the current decision and materializes the complete deterministic artifact diff for document workflows. |
| Approval | Only explicit approval of a human-facing document belongs in the `approval` field; its canonical/projection pair is one unit. |
| Supersession | A new payload can replace untouched, wholly unapproved overlapping previews. Approved, edited, staged, or committed targets are preserved and reported. |
| Cancellation | `approvalCancel:true` with the returned `approvalSessionId` restores a target preview only after workflow, content, Git-index, and HEAD-baseline validation; failure retains the session. |
| Execution | `execute:true` is valid only after prerequisites and current approvals are satisfied. |
| Continuation | `next` is the sole immediate single-agent Cadre continuation. The only callbacks outside it are provider `decision.required.write_back` after external evidence collection, each parallel worker's `data.workers[].dispatch.record_finish_packet`, and exact completion or recovery callbacks reissued under `data.worker_callbacks[].record_finish_packet`. |
| Skills | Applicable repository skills are selected by workflow, repo target, and optional explicit IDs. |
| Evidence | Large context is exposed through targeted `cadre://` resources. |

## cadre-setup

**Purpose:** Initialize Cadre in a target repository.

- Inputs: topology, provider/sync choices, project identity, style-guide choices,
  infrastructure options, and approved setup artifacts.
- Approval: product context, guidelines, tech stack, workflow, optional repo
  topology, and one collective styleguide document set. Patterns and machine
  configuration are generated without separate approval.
- Output: canonical `cadre/` context, projections, native state defaults,
  optional shared-sync attributes, and hosted CI scaffolding.
- Common failures: ambiguous provider remotes, weak project intent, dirty target
  previews, schema errors, or missing stage approval.

## cadre-newtrack

**Purpose:** Create a spec-first unit of work.

- Inputs: desired outcome, constraints, optional ID/skill selectors, spec, and
  plan payloads.
- Approval: clarification until the structured spec and plan contain
  substantive project-specific evidence, then spec and plan stages. Empty or
  generic objects do not materialize previews.
- Output: canonical track spec/plan, task graph, projections, events, and an
  exact `next` call when implementation can proceed.
- Common failures: untestable acceptance criteria, missing task dependencies,
  invalid schema, ambiguous repo targets, or preview drift.

## cadre-implement

**Purpose:** Select and execute the next safe planned task.

- Inputs: optional track/task targeting, repo context, and explicit skill IDs.
- Approval: implementation itself is not a staged document approval; returned
  task completion or parallel actions remain packet-owned.
- Output: task context, phase schedule, applicable rules, test impact,
  completion requirements, or an exact parallel-dispatch `next` call.
- Common failures: no ready task, blockers, ownership collision, unresolved repo,
  invalid skill, or unfinished prerequisite.

## cadre-debug

**Purpose:** Investigate a reproducible defect while preserving track context.

- Inputs: symptom, reproduction, expected/actual behavior, evidence, and
  optional track/repository target.
- Approval: none for diagnostics; requested configuration writes require
  `execute:true`.
- Output: bounded diagnosis context, test/diagnostic evidence, and an exact
  `next` call when a debug operation or track update is safe.
- Common failures: no reproduction evidence, ambiguous root, unrelated active
  work, or a request that is actually a scope change.

## cadre-status

**Purpose:** Read active work, health, ownership, review, and next actions.

- Inputs: optional track, identity, team, repo, or view filters.
- Approval: none for reads.
- Output: compact status plus resource links for team/fleet boards, next
  actions, review queue, handoff inbox, workspace health, and integrations.
- Common failures: malformed native state, unresolved root, or stale generated
  views that require validation/refresh.

## cadre-validate

**Purpose:** Validate control-plane structure, schemas, projections, topology,
integrations, and generated state.

- Inputs: optional validation scope and repository target.
- Approval: none for read-only validation; a returned repair action may mutate.
- Output: errors, warnings, workspace health, and exact repair guidance.
- Common failures: schema mismatch, missing canonical file, projection drift,
  invalid repo map, unsafe skill source, or generated runtime drift.

## cadre-flag

**Purpose:** Record a blocker, risk, or coordination flag.

- Inputs: target, reason, severity/context, and optional owner or track.
- Approval: no document approval; mutation requires `execute:true`.
- Output: native flag/event state and updated status visibility.
- Common failures: unknown target, empty reason, conflicting ownership, or stale
  reviewed state.

## cadre-revise

**Purpose:** Change an accepted track spec or plan deliberately.

- Inputs: reason, changed scope/criteria/tasks, and affected track.
- Approval: clarification until the reason and changed spec/plan are
  meaningful, then staged spec changes followed by plan changes. There is no
  template revision fallback.
- Output: updated canonical artifacts, projections, task graph, and revision
  events.
- Common failures: missing rationale, incompatible completed work, invalid
  schema, or approval drift.

## cadre-review

**Purpose:** Evaluate implementation against accepted intent and delivery policy.

- Inputs: track target plus test, diagnostics, manual verification, reviewer,
  and provider evidence supplied through `decision.required.write_back`.
- Approval: records review through packet-owned actions; verdict must reference
  the reviewed commit identity.
- Output: findings, review evidence, quality gate, provider summary, and an
  exact `next` call when another immediate operation is safe.
- Common failures: stale SHA, missing tests/manual checks, self-review under a
  second-reviewer policy, provider unavailability, or blocking findings.

## cadre-ship

**Purpose:** Publish reviewed work from a single repository or monorepo.

- Inputs: reviewed track, publication intent, and provider evidence/actions.
- Approval: no document approval; `execute:true` plus provider and review gates
  authorizes the publication actions.
- Output: ship plan, provider action queue, publication evidence, trace records,
  and control/product commit state.
- Common failures: unreviewed or unpinned work, missing provider evidence,
  unfinished tasks/workers, dirty branch state, or policy gate failure.

## cadre-land

**Purpose:** Coordinate reviewed delivery across declared polyrepo repositories.

- Inputs: track, resolved repo group, merge order, provider evidence, and
  publication confirmation.
- Approval: no document approval; `execute:true` plus provider and review gates
  authorizes repo-scoped actions.
- Output: land plan, grouped provider actions, repo publication evidence,
  control-plane updates, and trace records.
- Common failures: ambiguous repo selection, inconsistent reviewed SHAs,
  dependency ordering, missing PR evidence, or partial merge-train state.

## cadre-handoff

**Purpose:** Transfer active context and responsibility to another contributor
or session.

- Inputs: track/task, recipient or audience, summary, evidence, blockers, and
  requested next action.
- Approval: clarification requires substantive `handoffText`, then one
  `HANDOFF.md` review; `handoff.json` is approved atomically with it. Missing or
  generic content does not create a placeholder handoff.
- Output: canonical handoff record, inbox message, projection, and event.
- Common failures: missing recipient/context, stale task ownership, or an
  incomplete current-state summary.

## cadre-archive

**Purpose:** Close completed or intentionally stopped work while preserving
history.

- Inputs: track target, completion/closure reason, and archive confirmation.
- Approval: no document approval; archive mutation requires `execute:true`.
- Output: archived track state with retained spec, plan, journal, review,
  events, and traceability.
- Common failures: active tasks, unfinished publication, pending workers,
  unresolved blockers, or missing closure rationale.

## cadre-release

**Purpose:** Create target-project release artifacts from shipped/landed tracks.

- Inputs: optional bump and `releaseVersion`, plus completed-track evidence or
  substantive `releaseNotes` when no completed track is available.
- Approval: clarification blocks empty default releases, then one release-notes
  review. Release JSON is the atomic canonical pair; optional local tagging
  runs under final `execute:true` without another approval.
- Output: release Markdown/JSON and setup-state release metadata.
- Common failures: invalid version, incomplete tracks, missing review evidence,
  target drift, or an existing conflicting tag.

This project workflow is distinct from publishing the `cadre-ai` harness npm
package.

## cadre-refresh

**Purpose:** Synchronize canonical project context with material repository
changes.

- Inputs: optional reason and `detectedChanges` for analysis, selected
  `refreshLevels`, and evidence-backed semantic candidates under
  `proposedContext`.
- Analysis: the first call is read-only and returns `refresh_analysis` plus a
  recommended native multi-select. Available levels are `product`,
  `product-guidelines`, `tech-stack`, `workflow`, `patterns`,
  `repository-topology`, `lsp`, `projections`, and `diagnostics`.
- Approval: selected semantic levels each receive staged review of their
  canonical/projection pair. `lsp` and `projections` require execution
  authorization but no document approval; `diagnostics` is read-only.
- Evidence: semantic selections require complete structured candidates and
  never fall back to setup templates. Missing evidence returns
  `stage:"refresh_evidence"` before previews or sessions are created.
- Output: analysis, selected-level results, updated semantic documents, LSP
  configuration, projection repair, and refresh trace evidence as applicable.
- Common failures: unsupported levels, missing semantic evidence, stale
  approval, dirty/staged/committed targets, or conflicting manual edits.

## cadre-revert

**Purpose:** Deliberately reverse a Cadre-managed local change.

- Inputs: exact target/change and reason.
- Approval: no document approval; revert mutation requires `execute:true` and
  automatically repairs affected registered projections.
- Output: reverted product/control state plus trace event.
- Common failures: ambiguous target, non-Cadre/user-owned change, published
  history requiring provider coordination, or destructive scope.

## cadre-formula

**Purpose:** Define or run reusable Cadre workflow formulas and local wisps.

- Inputs: formula ID/definition, run parameters, and optional target context.
- Approval: no document approval for current operations; mutations require
  `execute:true`.
- Output: formula catalog state and an ignored local wisp run unless configured
  for trace commits.
- Common failures: invalid formula schema, unsafe step, missing dependency, or
  an attempt to bypass packet-owned workflow state.

## cadre-artifacts

**Purpose:** Inspect, preview, validate, and synchronize canonical artifacts and
their projections.

- Inputs: action/scope, artifact identity, and sync confirmation.
- Approval: none for generated projection repair; synchronization requires
  `execute:true` and refuses unmarked user-owned Markdown.
- Output: artifact catalog/schema, preview, diff, or synchronized projection.
- Common failures: unknown artifact, malformed canonical JSON, projection drift,
  dirty target, or missing template.

## cadre-skill

**Purpose:** Inspect and manage repository-owned project skills.

- Inputs: management action, skill ID, source/manifest changes, selectors,
  references, formatting request, and optional workflow/repo context.
- Approval: create/update reviews `SKILL.md` and one collective changed-reference
  set. Rename/remove require `execute:true` without a content approval.
- Output: catalog/selection diagnostics, validated manifest, projection,
  enablement state, or an exact `next` call.
- Common failures: schema/version mismatch, unsafe path, duplicate ID, invalid
  selector, unresolved repo, unsupported reference, or required-rule overflow.

## Choosing A Supporting Workflow

Use `debug` for a product defect, `revise` for accepted scope change, `refresh`
for project-context drift, `artifacts` for canonical/projection maintenance,
`revert` for a specific Cadre-managed local reversal, and `flag` for durable
coordination risk. Do not use generic filesystem edits as substitutes.
