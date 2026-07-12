import fs from "node:fs"
import path from "node:path"

import matter from "gray-matter"

import { DOC_NAVIGATION, getNavigationPosition, type DocSection } from "@/lib/navigation"

const contentDir = path.join(process.cwd(), "content")

export type DocFrontmatter = {
  title: string
  navTitle?: string
  description: string
  section: DocSection
  order: number
}

export type Heading = {
  id: string
  text: string
  level: number
}

export type DocMeta = DocFrontmatter & {
  slug: string
  href: string
  sectionOrder: number
  navOrder: number
  searchText: string
  sectionHref: string
  navTitle: string
}

export type DocPage = DocMeta & {
  content: string
  headings: Heading[]
  previous: DocMeta | null
  next: DocMeta | null
}

export function getAllDocs(): DocMeta[] {
  const docs = fs
    .readdirSync(contentDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const slug = file.replace(/\.md$/, "")
      const source = fs.readFileSync(path.join(contentDir, file), "utf8")
      const parsed = matter(source)
      const data = parsed.data as Partial<DocFrontmatter>
      const position = getNavigationPosition(slug)

      if (!position) {
        throw new Error(`Document is missing from the navigation registry: ${slug}`)
      }

      const title = data.title ?? titleFromSlug(slug)
      const sectionGroup = DOC_NAVIGATION[position.sectionOrder]

      return {
        slug,
        href: `/${slug}`,
        title,
        navTitle: data.navTitle ?? title,
        description: data.description ?? "",
        section: position.section,
        order: Number(data.order ?? 999),
        sectionOrder: position.sectionOrder,
        navOrder: position.navOrder,
        searchText: createSearchText(parsed.content),
        sectionHref: `/${sectionGroup.slugs[0]}`,
      }
    })
    .sort(
      (a, b) =>
        a.sectionOrder - b.sectionOrder ||
        a.navOrder - b.navOrder ||
        a.title.localeCompare(b.title)
    )

  const expectedCount = DOC_NAVIGATION.reduce((count, group) => count + group.slugs.length, 0)
  if (docs.length !== expectedCount) {
    throw new Error(
      `Navigation registry contains ${expectedCount} entries but ${docs.length} Markdown documents were found.`
    )
  }

  return docs
}

export function getDocBySlug(slug: string): DocPage {
  const file = path.join(contentDir, `${slug}.md`)
  const source = fs.readFileSync(file, "utf8")
  const parsed = matter(source)
  const data = parsed.data as Partial<DocFrontmatter>
  const docs = getAllDocs()
  const index = docs.findIndex((doc) => doc.slug === slug)
  const current = docs[index]

  if (!current) {
    throw new Error(`Unknown document slug: ${slug}`)
  }

  return {
    ...current,
    title: data.title ?? current.title,
    navTitle: data.navTitle ?? current.navTitle,
    description: data.description ?? current.description,
    section: current.section,
    order: Number(data.order ?? current.order),
    content: stripTopLevelTitle(parsed.content),
    headings: extractHeadings(parsed.content),
    previous: index > 0 ? docs[index - 1] : null,
    next: index < docs.length - 1 ? docs[index + 1] : null,
  }
}

export function getDocsBySection(docs = getAllDocs()) {
  return docs.reduce<Partial<Record<DocSection, DocMeta[]>>>((acc, doc) => {
    const sectionDocs = acc[doc.section] ?? []
    sectionDocs.push(doc)
    acc[doc.section] = sectionDocs
    return acc
  }, {})
}

function createSearchText(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|{}[\]-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function getAllSlugs() {
  return getAllDocs().map((doc) => doc.slug)
}

function extractHeadings(content: string): Heading[] {
  const headingPattern = /^(#{2,3})\s+(.+)$/gm
  const headings: Heading[] = []
  const seen = new Map<string, number>()
  let match: RegExpExecArray | null

  while ((match = headingPattern.exec(content))) {
    const text = match[2].replace(/`/g, "").trim()
    const base = slugify(text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({
      id: count ? `${base}-${count}` : base,
      text,
      level: match[1].length,
    })
  }

  return headings
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

function stripTopLevelTitle(content: string) {
  return content.replace(/^\s*#\s+.+\n+/, "")
}
