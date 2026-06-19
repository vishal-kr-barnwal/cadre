# Cadre Docs Website

This directory is a standalone Next.js App Router documentation site for Cadre.
Markdown source lives in `content/`, the custom homepage lives in `app/page.tsx`,
and shared docs rendering/navigation lives in `components/` and `lib/docs.ts`.

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
subpath. The default Pages project name is `cadre-docs`; update
`--project-name` in `package.json` and `.github/workflows/docs.yml` if the
Cloudflare Pages project uses another name.

```bash
pnpm build
pnpm preview:pages
pnpm deploy
```
