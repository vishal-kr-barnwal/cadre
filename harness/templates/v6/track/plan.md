# Plan: {{TRACK_TITLE}}

- Track: `{{TRACK_ID}}`
- Spec revision: 1
- Plan revision: 1
- Status: proposed

## Phase 1: {{DELIVERY_PHASE_NAME}}

- Phase dependencies: none

### Outcome

{{PHASE_OUTCOME}}

- [ ] T1.1 {{IMPLEMENTATION_OR_VERIFICATION_TASK}}
  - Task dependencies: none
  - Commit group: {{COHESIVE_CHANGE_SLUG}}
- [ ] T1.2 User Manual Verification

- Phase completion commit: pending

## Phase 2: Track-level User Manual Verification

### Outcome

The human verifies the complete track against the approved specification and acceptance criteria.

- [ ] T2.1 User Manual Verification

- Phase completion commit: pending

## Approval

{{APPROVAL_RECORD}}

<!-- Regular phases declare dependencies explicitly. Regular tasks declare same-phase dependencies explicitly. -->
<!-- Phase User Manual Verification implicitly depends on every sibling task. -->
<!-- Track-level User Manual Verification implicitly depends on every preceding phase. -->
<!-- For a completed task, append a commit marker containing the full hexadecimal SHA. -->

<!-- Commit groups stay within one phase; preserve task evidence and reject cycles after collapsing groups. -->
<!-- Operation tracks model planned, human-controlled preflight, rollout, postflight, monitoring, abort, rollback, and recovery verification. Record planned evidence capture and decision criteria; Cadre never runs those actions, infers their completion, or attests that they occurred. -->
