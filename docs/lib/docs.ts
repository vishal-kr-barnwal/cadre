import fs from "node:fs"
import path from "node:path"

import matter from "gray-matter"

const contentDir = path.join(process.cwd(), "content")

export type DocFrontmatter = {
  title: string
  description: string
  section: string
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
}

export type DocPage = DocMeta & {
  content: string
  headings: Heading[]
  previous: DocMeta | null
  next: DocMeta | null
}

export function getAllDocs(): DocMeta[] {
  return fs
    .readdirSync(contentDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const slug = file.replace(/\.md$/, "")
      const source = fs.readFileSync(path.join(contentDir, file), "utf8")
      const parsed = matter(source)
      const data = parsed.data as Partial<DocFrontmatter>

      return {
        slug,
        href: `/${slug}`,
        title: data.title ?? titleFromSlug(slug),
        description: data.description ?? "",
        section: data.section ?? "Docs",
        order: Number(data.order ?? 999),
      }
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
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
    description: data.description ?? current.description,
    section: data.section ?? current.section,
    order: Number(data.order ?? current.order),
    content: stripTopLevelTitle(parsed.content),
    headings: extractHeadings(parsed.content),
    previous: index > 0 ? docs[index - 1] : null,
    next: index < docs.length - 1 ? docs[index + 1] : null,
  }
}

export function getDocsBySection(docs = getAllDocs()) {
  return docs.reduce<Record<string, DocMeta[]>>((acc, doc) => {
    acc[doc.section] ??= []
    acc[doc.section].push(doc)
    return acc
  }, {})
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
