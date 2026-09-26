# Specification: {{TRACK_TITLE}}

- Track: `{{TRACK_ID}}`
- Type: `{{feature|bug|operation}}`
- Revision: 1
- Status: proposed

## Goal and scope

{{GOAL_SCOPE}}

## Functional Requirements

- FR-001: {{REQUIREMENT}}

## Non-Functional Requirements

- NFR-001: {{REQUIREMENT_AND_MEASURE}}

## Acceptance Criteria

- AC-001: {{OBSERVABLE_ACCEPTANCE_CRITERION}}

## Dependencies

{{TRACK_DEPENDENCIES_OR_NONE}}

## Additional Information

{{CONSTRAINTS_RISKS_ASSUMPTIONS_REFERENCES}}

## Dependent-track impact

{{KNOWN_OR_POTENTIAL_IMPACT}}

## Operational Readiness

Required for `operation` tracks. Define the future human-controlled change; do not claim that any external action has occurred.

- Owner: {{OPERATION_OWNER}}
- Target: {{OPERATION_TARGET}}
- Change window: {{CHANGE_WINDOW}}
- Preconditions: {{PRECONDITIONS}}

## Human-Controlled Preflight, Rollout, and Postflight Evidence

Required for `operation` tracks. Plan who will capture evidence and the timestamp format. Cadre does not perform these actions or infer that they occurred.

### Preflight

- Planned operator: {{PREFLIGHT_OPERATOR}}
- Evidence to capture: {{PREFLIGHT_EVIDENCE}}
- Timestamp format: {{PREFLIGHT_TIMESTAMP_FORMAT}}

### Rollout

- Planned operator: {{ROLLOUT_OPERATOR}}
- Evidence to capture: {{ROLLOUT_EVIDENCE}}
- Timestamp format: {{ROLLOUT_TIMESTAMP_FORMAT}}

### Postflight

- Planned operator: {{POSTFLIGHT_OPERATOR}}
- Evidence to capture: {{POSTFLIGHT_EVIDENCE}}
- Timestamp format: {{POSTFLIGHT_TIMESTAMP_FORMAT}}

## Monitoring and Success Signals

Required for `operation` tracks. Define the future observation and success decision; do not report a result as already observed.

- Signal: {{MONITORING_SIGNAL}}
- Baseline: {{MONITORING_BASELINE}}
- Success threshold: {{SUCCESS_THRESHOLD}}
- Observation window: {{OBSERVATION_WINDOW}}

## Abort, Rollback, and Recovery

Required for `operation` tracks. Define the human-authorized recovery plan and its limits before approval.

- Abort threshold: {{ABORT_THRESHOLD}}
- Rollback/recovery owner: {{ROLLBACK_RECOVERY_OWNER}}
- Procedure: {{ROLLBACK_RECOVERY_PROCEDURE}}
- Reversibility limit: {{REVERSIBILITY_LIMIT}}

## Residual Risk

Required for `operation` tracks. State remaining risk and who must accept it; do not assert acceptance has already happened.

- Residual risk: {{RESIDUAL_RISK}}
- Mitigation: {{RISK_MITIGATION}}
- Acceptance owner: {{RISK_ACCEPTANCE_OWNER}}

## Approval

{{APPROVAL_RECORD}}
