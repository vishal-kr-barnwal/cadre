---
title: Development
description: Work safely in the Cadre harness and documentation workspace.
section: Contributor Guide
order: 170
---

# Development

This repository builds the Cadre package. It is not itself a Cadre-initialized
target project. Do not create a root `.cadre/` unless a fixture explicitly tests
project creation.

## Install The Workspace

```bash
pnpm install --frozen-lockfile
```

The root workspace contains `harness/` and `docs/`.

## Common Commands

```bash
pnpm check                         # Harness and docs checks
pnpm --filter cadre-ai check       # TypeScript only
pnpm --filter cadre-ai test        # Build and all harness tests
pnpm --filter cadre-ai validate    # Build and package-source validation
pnpm --filter cadre-ai build       # Build the two dist bundles
pnpm --filter cadre-docs check     # Content, lint, types, and static build
pnpm --filter cadre-docs dev       # Local documentation server
```

## Edit Source Files

Primary sources are:

- `harness/skills/*/SKILL.md` and `agents/openai.yaml`;
- `harness/agents/` worker definitions;
- `harness/src/domain/` and `harness/src/mcp/`;
- `harness/scripts/*.ts`;
- `harness/templates/v1/` through `v5/` (immutable history), and active `harness/templates/v6/`;
- tracked plugin manifests, MCP configs, and marketplace catalogs;
- `harness/test/`;
- `docs/content/` and the docs application.

`harness/dist/` and `node_modules/` are generated and ignored. The installed
marketplace under `~/.cadre/marketplaces/cadre` is also generated. Never make a
source fix only in those outputs.

## TypeScript Conventions

- Read an existing file and its direct callers/tests/templates before editing.
- Normalize MCP and JSON input at boundaries.
- Prefer explicit interfaces, literal unions, and validation over broad
  business-logic `unknown` values.
- Keep the MCP server focused on registration and boundary schemas; move
  reusable behavior into the relevant capability module.
- Preserve atomic writes, stale-digest rejection, path safety, Git ancestry
  checks, and resumable checkpoints.
- Prefer cohesive modules. Avoid casually growing already-large files; split
  when a real capability boundary can be separated safely.

## Focused Tests

From `harness/`:

```bash
node --import tsx --test --test-name-pattern='<pattern>' test/harness.test.ts
node --import tsx --test test/cli.test.ts
```

Run focused coverage first, then the full harness check appropriate to the
change.

## Documentation Work

Markdown frontmatter, navigation membership, heading IDs, internal links,
workflow coverage, MCP tool coverage, and release version are checked by
`docs/scripts/check-content.mjs`. The site statically exports through Next.js.

When React components are touched, keep static data at module scope, reuse the
existing shadcn components, and avoid adding client-side state for content-only
changes.

### Search discovery and indexing

The production site is `https://cadre-docs.pages.dev/`. The static build emits
`/sitemap.xml` from the documentation catalog and `/robots.txt` with its sitemap
location. Each page has a distinct canonical URL, title, description and social
metadata. The homepage includes WebSite structured data, and guides include
breadcrumbs matching the visible navigation. These improve discovery and
identification; they do not guarantee Google indexing or rankings.

After deployment, use [Google Search Console](https://search.google.com/search-console/)
to add the **URL-prefix property** `https://cadre-docs.pages.dev/`. For HTML-tag
verification, copy only the supplied tag's `content` value into the GitHub
repository Actions variable `GOOGLE_SITE_VERIFICATION`, then rerun **Deploy Docs**
for the intended commit. The build includes the verification tag only when that
value is configured. Keep it configured after verification to retain ownership.

Submit `https://cadre-docs.pages.dev/sitemap.xml` in Search Console, inspect the
homepage and a guide, and request indexing. Use the Page Indexing report to
diagnose exclusions. npm's package page is outside this site's Search Console
property. See [Google's sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

Production canonicals remain on the production origin for preview builds; an
optional `NEXT_PUBLIC_BASE_PATH` is included consistently. Change `SITE_ORIGIN`
in `docs/lib/seo.ts` only as part of an intentional domain migration. Do not add
invented ratings, reviews or modification dates to search metadata.

## Release gates

Run frozen-lockfile installation, harness type checking, full tests, package validation, `pnpm --filter cadre-ai pack --dry-run`, and the documentation check. Keep the changelog entry under Unreleased until publication is authorized and the candidate is verified.

Use disposable projects for native Claude and Codex workflow tests, including dirty-worktree revert preparation and fresh-session recovery. SDK client-identity tests cover wire compatibility but do not replace native activation. Before publishing, validate the packaged installer, enabled candidate version, narrow MCP approvals, and server activation in Codex, Claude Code, and Zed; Zed must discover all ten skills. Record absent or untested clients as incomplete gates. Personal-client installation and publication require their own authorization.

The 100-node aggregate benchmark compares current request/response bytes with a captured response-only baseline and resets retained context halfway through. This is a conservative retrieval comparison, not a before/after live-delivery token experiment. Report small-fixture overhead and client-reported usage separately.

### Version bump and release

Feature pull requests leave every version unchanged. `CADRE_RUNTIME_VERSION` in `harness/src/domain/version.ts` is the single source that package validation, tests and the documentation check compare against.

1. Merge the reviewed pull request with its changelog entry under `## [Unreleased]`.
2. Once publication is authorized, run `pnpm --filter cadre-ai release:version <version> --dry-run` from an up-to-date `main`, then again without `--dry-run`. It refuses a version that is not strict `MAJOR.MINOR.PATCH`, not greater than the current one, or already released, and requires the four manifest versions to match `CADRE_RUNTIME_VERSION` and exactly one non-empty Unreleased section. It then updates those versions, moves the previous runtime into `LEGACY_RUNTIME_VERSIONS`, dates the changelog section, adds the release notes entry, and creates `.github/releases/<version>.md`; `--date YYYY-MM-DD` overrides today's UTC date. It never stages, commits, tags or publishes.
3. Review the generated changelog section, release notes and GitHub release body, and update the README release blurb if needed.
4. When the release changes the active template set, add the previous release's runtime and template set to `CONTINUABLE_EXECUTION_RELEASES` in `harness/src/domain/version.ts`, so its in-flight executions can reach a safe boundary before the approved refresh.
5. Run every release gate and the native three-client installer checks from the root `AGENTS.md`, and record the results in `docs/development/cadre-<version>-release.md`.
6. Commit the release as `chore(release): prepare <version>`.
7. Create the signed `release-<version>` tag and publish the GitHub release from `.github/releases/<version>.md`. Publishing runs the release workflow, which requires the tag to match `harness/package.json`, publishes npm, and then deploys the documentation.
