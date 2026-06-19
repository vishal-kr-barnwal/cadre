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

The app uses static export and deploys to Cloudflare Workers Static Assets with
Wrangler. The default deployment expects the Worker at the domain root; set
`NEXT_PUBLIC_BASE_PATH=/your-subpath` only when intentionally serving from a
subpath.

```bash
pnpm build
pnpm preview:worker
pnpm deploy
```
