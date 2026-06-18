# Team Operations

Cadre is designed for solo projects and for teams of roughly 10-20 people
working across monorepos or polyrepos.

## Sync Mode

Use `local` mode for solo work or private experiments. Use `shared` mode when
multiple people need to see ownership, leases, review queues, blockers, and
available work. Shared sync is packet-owned; agents should rely on Cadre packet
results for pre/post sync status and recovery instructions.

Generated setup can configure `.gitattributes` for Beads and parallel worker
state so shared control-plane merges stay low-conflict.

## Parallelism

Parallel work is task-level and dependency-aware. `cadre_parallel` returns only
tasks whose phase, dependencies, worker state, and file claims are ready. A
sequential phase dispatches one unfinished task at a time. A parallel phase may
dispatch multiple independent tasks when file claims do not conflict.

Worker status transitions:

- `in_progress` after worker setup
- `awaiting_merge` after tested worker completion with commit evidence
- `merged` after safe merge-back
- `failed` or `conflict` when the worker cannot be merged safely

Cleanup removes merged workers by default; force is required for unfinished,
failed, or conflicted workers.

## MCP And LSP Use

Use `cadre_intel` before prompt-side repo scans when possible. It can return
repo maps, dependency graphs, workspace diagnostics, test impact, LSP setup,
LSP impact, and warm review evidence. Polyrepo projects return repo-qualified
results so clients can distinguish control-plane files from product-repo files.

Recommended optional MCP additions for larger teams:

- GitHub or GitLab provider MCP for PR/MR metadata, review approvals, CI status,
  and hosted provider evidence.
- Sourcegraph or internal code-search MCP for cross-repo symbol search when
  product repos are not fully local.
- Issue tracker MCP such as Jira or Linear when roadmap evidence lives outside
  Cadre.
- CI-specific MCP for Buildkite, CircleCI, Argo, Jenkins, or other systems that
  are not covered by GitHub/GitLab checks.
- Sentry, Datadog, Honeycomb, or logging MCP for incident and runtime evidence.
- Knowledge-base MCP for product/domain documents used as read-only evidence.
