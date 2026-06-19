# Product Guidelines

Use this file to capture product rules that should shape implementation choices,
review decisions, and acceptance criteria.

## Product Principles

- Put the primary user workflow first.
- Prefer changes that reduce ambiguity in the user's next action.
- Keep product behavior explainable from the UI, docs, or API contract.
- Preserve explicit product invariants unless a spec intentionally revises them.

## User Promises

- Record promises the product must keep for users, teams, operators, or
  integrators.
- Note the situations where reliability, privacy, accessibility, or performance
  matter more than feature breadth.

## Trust And Safety Boundaries

- Record authentication, authorization, tenancy, privacy, and audit guarantees.
- Identify public trust boundaries and internal-only surfaces.
- State which data must be redacted, encrypted, scoped, or excluded from logs.

## Domain And Workflow Rules

- List lifecycle, state-machine, ordering, idempotency, and concurrency rules.
- Capture deterministic evaluation, attribution, or compatibility requirements.
- Note workflows that require preview, rollback, migration, or audit support.

## Data Ownership

- Map major product data to its owning store, service, module, or external
  provider.
- Record generated artifacts, contracts, fixtures, migrations, or SDK assets that
  must be updated alongside behavior changes.

## Non-Goals

- List behaviors, audiences, platforms, or workflows this project intentionally
  does not serve yet.
- Record tempting shortcuts or alternate architectures that should not be used
  without revising product context first.

## Decision Rules

- When product tradeoffs appear, write the rule the team should use to choose.
- Link decisions back to product context, usage evidence, support requests, or
  explicit user feedback.
- Prefer tests and review evidence around product invariants, trust boundaries,
  tenancy, authorization, data ownership, and public contracts.

## Review Checklist

- Does the change preserve the product invariants in `cadre/product.md`?
- Are user-visible behavior, docs, API contracts, SDK fixtures, generated
  artifacts, and migrations updated together when needed?
- Are privacy, audit, observability, and rollback implications covered?
- Are non-goals and compatibility boundaries still respected?
