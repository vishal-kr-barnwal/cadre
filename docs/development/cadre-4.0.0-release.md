# Cadre 4.0.0 release validation

Candidate validation completed on 2026-10-14 (Asia/Kolkata). This records local
release gates; the GitHub release workflow records npm publication and deployment.

## Package and documentation

The frozen-lockfile install, harness type check, full harness suite, package
validation, pack dry run, build and doctor passed. The fresh suite passed
**480/480 tests**, with no failures, cancellations or skips. Doctor reports
4.0.0 and 39/39 templates. The package contains only the active v6 template set,
the sole `cadre-ai` executable and self-contained runtime bundles.

The complete docs check passed content validation, lint, types, static export
and SEO validation across **24 pages and 1,368 internal links**. Deployment CI
now includes content and exported SEO checks before uploading to Cloudflare.

The [native lifecycle record](cadre-4.0.0-native-flow.md) covers 14 real Codex
sessions in a disposable brownfield project, 26 fixture tests, 200,020 arithmetic
oracle comparisons and nine receipts with exactly one operation commit each.
This is representative Autonomous/sequential coverage with synthetic fixture
approvals, not exhaustive native coverage of every client and mode.

## Installed candidate

The built candidate was installed with `install --target all --scope user`.

| Client | Evidence |
| --- | --- |
| Codex CLI 0.159.2 | Enabled `cadre@cadre` at `4.0.0+codex.local-20261013T183315Z`. A fresh read-only native session discovered all ten workflows and invoked the installed status skill/MCP: valid state, target runtime 4.0.0, no required upgrade, errors or warnings. |
| Claude Code 2.1.285 | Enabled `cadre@cadre` at `4.0.0+claude.local-20261013T183315Z`. Native MCP listing reports the packaged server connected. No additional model-driven lifecycle run claimed. |
| Zed 1.23.3 | Native Skills settings showed all ten `cadre-*` skills. MCP settings showed Cadre enabled with green status. The fixture stayed in restricted mode; no additional model-driven workflow run claimed. |

All three installed MCP bundles match the tested build byte for byte. Codex
has Cadre-scoped approval; Claude has the enabled server and Cadre tool allow
rule; Zed has all 22 required exact allow entries and ten owned skill links.
Existing exact entries for three retired tools remain inert in Zed settings;
the release exposes only 22 tools. Unrelated settings were preserved.

## Website verification

Added npm links to desktop and mobile homepage/documentation navigation.
Reproduced the homepage blank-space issue at a 412 × 8000 viewport: viewport
minimum height placed the heading about 1,794 pixels down. Removing that mobile
minimum and capping desktop height places the mobile heading at 133 pixels.

Bundled Playwright Chromium passed six combinations: JavaScript enabled and
disabled at 1440 × 1000, 390 × 844 and 412 × 8000. Checks cover heading position,
horizontal overflow, npm links and navigation to the installation page. With
JavaScript enabled, both mobile navigation drawers expose npm links and no
console/page errors occurred. Desktop, mobile and tall-viewport screenshots were
visually inspected. These are local browser checks, not CI browser coverage.

## Search Console investigation

Before publication, Cloudflare showed the successful October 1 production
deployment for 3.9.1, with `sitemap.xml` and documentation assets uploaded.
Search Console recorded a failed sitemap submission and only one known indexed
URL (report updated October 9). It provided no original HTTP failure detail.

On October 14 at 00:12 IST, Google's live inspection fetched the actual sitemap
XML successfully, with crawling and indexing allowed. A separate live test of
`/getting-started/` also succeeded. That page's indexed record was unknown to
Google, with no previous crawl or referring sitemap. This establishes current
inspection-crawler access, not successful scheduled sitemap processing or a
guarantee of indexing. No Cloudflare security protections were changed.

## Publication

Publish the signed release commit and `release-4.0.0` tag using the existing
GitHub release workflow. It publishes npm with provenance and then deploys the
documentation. Compatible schema-2/v5 3.9.x projects need only the new runtime
and client reload; unsupported older formats use the documented 3.9.0 bridge.
