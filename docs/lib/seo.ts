import type { Metadata } from "next"

export const SITE_NAME = "Cadre AI"
export const SITE_ORIGIN = "https://cadre-docs.pages.dev"
export const HOME_TITLE = "Cadre AI (cadre-ai) — Workflows for Codex, Claude & Zed"
export const SITE_DESCRIPTION =
  "Cadre AI (cadre-ai) is an open-source workflow harness for Codex, Claude Code and Zed, with approved plans, parallel Git worktrees and resumable delivery."

// Match next.config.ts when exporting the documentation under a base path.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""

export function siteUrl(path = "/") {
  return new URL(`${basePath}${path}`, SITE_ORIGIN).href
}

export function pageMetadata(title: string, description: string, path: string): Metadata {
  const displayTitle = path === "/" ? title : `${title} | Cadre AI Docs`
  return {
    title,
    description,
    alternates: { canonical: siteUrl(path) },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      title: displayTitle,
      description,
      url: siteUrl(path),
    },
    twitter: { card: "summary", title: displayTitle, description },
  }
}
