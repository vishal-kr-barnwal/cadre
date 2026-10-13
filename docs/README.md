# Cadre Docs Website

This directory is the Next.js App Router documentation site for Cadre inside the
root pnpm workspace. Markdown source lives in `content/`, the custom homepage
lives in `app/page.tsx`, and shared docs rendering/navigation lives in
`components/` and `lib/docs.ts`.

```bash
pnpm install
pnpm --filter cadre-docs dev
pnpm --filter cadre-docs lint
pnpm --filter cadre-docs typecheck
pnpm --filter cadre-docs build
```

Or from this directory:

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
```

The app uses static export and deploys to Cloudflare Pages with Wrangler Direct
Upload. The default deployment expects the Pages site at the domain root; set
`NEXT_PUBLIC_BASE_PATH=/your-subpath` only when intentionally serving from a
subpath. The default Pages project name is `cadre-docs`; set the GitHub Actions
repository variable `CLOUDFLARE_PAGES_PROJECT_NAME` or the local environment
variable of the same name if the Cloudflare Pages project uses another name.
The release workflow creates the Pages project on first deploy when it does not
already exist, and only runs when a GitHub release is published.

```bash
pnpm build
pnpm preview:pages
pnpm deploy
```

## Content and search validation

`pnpm --filter cadre-docs check` validates content/navigation and version parity,
lints, type-checks, exports the site, then audits the rendered HTML with
`check:seo`. The export audit checks every page for unique titles/descriptions,
one H1, canonical URLs, social previews, JSON-LD, internal links and section
anchors, sitemap coverage, crawlable robots rules and a noindex 404.

Canonical URLs use `SITE_ORIGIN` in `lib/seo.ts` plus the configured base path.
Update that origin before deploying to a different canonical domain. Sitemap
and metadata share this URL builder. Dates are not fabricated at build time;
there is no artificial sitemap freshness claim.

The optional `GOOGLE_SITE_VERIFICATION` build variable adds a verification meta
tag. Deployment and Google Search Console indexing remain separate from local
validation. Guidance follows [Google's SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
and [sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
