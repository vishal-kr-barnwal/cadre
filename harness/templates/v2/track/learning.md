# Incremental Learning: {{TRACK_TITLE}}

Never overwrite an earlier phase. Each phase begins by reading the learning of every declared dependency phase. A root phase reads the marked Pattern Seed section below. Parallel sibling phases do not assume or consume each other's learning.

<!-- cadre:pattern-seed:start -->
## Pattern Seed

- Spec revision: 1
- Plan revision: 1

| Pattern | Relevance to this track | Constraints to carry forward |
| --- | --- | --- |
| `{{PATTERN_PATH}}` | {{RELEVANCE}} | {{CONSTRAINTS}} |

If no existing pattern is relevant, state that explicitly rather than inventing guidance.
<!-- cadre:pattern-seed:end -->

## Phase 1: {{PHASE_NAME}}

### Inputs read

{{FILES_PATTERNS_DEPENDENCY_PHASE_LEARNING}}

### Task observations

{{OBSERVATIONS_WITH_TASK_AND_COMMIT}}

### Decisions and corrections

{{DECISIONS_AND_CORRECTIONS}}

### Reusable pattern candidates

{{CANDIDATES_OR_NONE}}

### Phase completion

- Commit: {{PHASE_COMPLETION_COMMIT}}
- Human verification: {{APPROVAL_RECORD}}
