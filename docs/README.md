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

The app uses static export for GitHub Pages. Set `GITHUB_PAGES=true` and
`NEXT_PUBLIC_BASE_PATH=/your-repo-name` when publishing under a project Pages
subpath.
