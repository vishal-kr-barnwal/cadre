import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import matter from "gray-matter"

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = path.resolve(docsRoot, "..")
const contentRoot = path.join(docsRoot, "content")
const navigation = readJson(path.join(docsRoot, "navigation.json"))
const expected = new Map()

for (const [sectionOrder, group] of navigation.entries()) {
  for (const [navOrder, slug] of group.slugs.entries()) {
    if (expected.has(slug)) fail(`Duplicate navigation slug: ${slug}`)
    expected.set(slug, { section: group.section, sectionOrder, navOrder })
  }
}

const files = fs.readdirSync(contentRoot).filter((file) => file.endsWith(".md")).sort()
const docs = new Map()
const orders = new Map()

for (const file of files) {
  const slug = file.replace(/\.md$/, "")
  const source = fs.readFileSync(path.join(contentRoot, file), "utf8")
  const parsed = matter(source)
  const position = expected.get(slug)

  if (!position) fail(`${file}: missing from navigation.json`)
  for (const key of ["title", "description", "section", "order"]) {
    if (parsed.data[key] === undefined || parsed.data[key] === "") {
      fail(`${file}: missing frontmatter field ${key}`)
    }
  }
  if (parsed.data.section !== position.section) {
    fail(`${file}: section ${parsed.data.section} does not match navigation section ${position.section}`)
  }
  if (!Number.isInteger(parsed.data.order)) fail(`${file}: order must be an integer`)
  if (orders.has(parsed.data.order)) {
    fail(`${file}: duplicate order ${parsed.data.order} also used by ${orders.get(parsed.data.order)}`)
  }
  orders.set(parsed.data.order, file)

  checkHeadings(file, parsed.content)
  docs.set(slug, { file, source, content: parsed.content, data: parsed.data })
}

for (const slug of expected.keys()) {
  if (!docs.has(slug)) fail(`navigation.json: missing content/${slug}.md`)
}
if (docs.size !== expected.size) {
  fail(`Navigation has ${expected.size} entries but content has ${docs.size} pages`)
}

for (const doc of docs.values()) checkLinks(doc, docs)
checkWorkflowCoverage(docs)
checkConfigurationCoverage(docs)
checkReleaseVersion(docs)

console.log(`Content check passed: ${docs.size} pages, ${orders.size} unique orders.`)

function checkHeadings(file, content) {
  const seen = new Set()
  let currentParent = "root"
  for (const match of content.matchAll(/^(#{2,3})\s+(.+)$/gm)) {
    const level = match[1].length
    const id = slugify(match[2].replace(/`/g, ""))
    if (level === 2) currentParent = id
    const scoped = level === 2 ? `root/${id}` : `${currentParent}/${id}`
    if (seen.has(scoped)) fail(`${file}: duplicate heading in the same section: ${match[2]}`)
    seen.add(scoped)
  }
}

function checkLinks(doc, docsBySlug) {
  for (const match of doc.content.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "")
    if (!raw || raw.startsWith("#") || /^(https?:|mailto:)/.test(raw)) continue
    const target = raw.split("#")[0].split("?")[0]
    if (!target) continue
    const slug = target.replace(/^\//, "").replace(/\.md$/, "").replace(/\/$/, "")
    if (!slug) continue
    if (!docsBySlug.has(slug)) fail(`${doc.file}: broken internal link ${raw}`)
  }
}

function checkWorkflowCoverage(docsBySlug) {
  const skill = readJson(path.join(repositoryRoot, "harness/skills/cadre/skill.json"))
  const reference = docsBySlug.get("workflow-reference")?.content ?? ""
  for (const workflow of skill.workflows) {
    if (!reference.includes(`## cadre-${workflow}`)) {
      fail(`workflow-reference.md: missing cadre-${workflow}`)
    }
  }
}

function checkConfigurationCoverage(docsBySlug) {
  const config = readJson(path.join(repositoryRoot, "harness/templates/config.json"))
  const reference = docsBySlug.get("configuration-reference")?.content ?? ""
  for (const key of leafPaths(config)) {
    if (!reference.includes(`\`${key}\``)) {
      fail(`configuration-reference.md: missing ${key}`)
    }
  }
}

function checkReleaseVersion(docsBySlug) {
  const packageVersion = readJson(path.join(repositoryRoot, "harness/package.json")).version
  const docsVersion = readJson(path.join(docsRoot, "package.json")).version
  const notes = docsBySlug.get("release-notes")?.content ?? ""
  if (packageVersion !== docsVersion) {
    fail(`Version mismatch: cadre-ai ${packageVersion}, docs ${docsVersion}`)
  }
  if (!notes.includes(`## ${packageVersion} -`)) {
    fail(`release-notes.md: missing current version ${packageVersion}`)
  }
}

function leafPaths(value, prefix = "") {
  const output = []
  for (const [key, child] of Object.entries(value)) {
    const current = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === "object" && !Array.isArray(child)) {
      output.push(...leafPaths(child, current))
    } else {
      output.push(current)
    }
  }
  return output
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-")
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function fail(message) {
  throw new Error(message)
}
