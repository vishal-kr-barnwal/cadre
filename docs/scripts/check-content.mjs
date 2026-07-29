import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import matter from "gray-matter"

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = path.resolve(docsRoot, "..")
const harnessRoot = path.join(repositoryRoot, "harness")
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
checkMcpCoverage(docs)
checkReleaseVersion(docs)
checkCurrentModel(docs)

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
  const skillRoot = path.join(harnessRoot, "skills")
  const workflows = fs.readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort()
  const reference = docsBySlug.get("workflow-reference")?.content ?? ""

  if (workflows.length !== 10) {
    fail(`Expected 10 current workflow skills, found ${workflows.length}: ${workflows.join(", ")}`)
  }
  for (const workflow of workflows) {
    if (!reference.includes(`## ${workflow}\n`)) {
      fail(`workflow-reference.md: missing ${workflow}`)
    }
  }
}

function checkMcpCoverage(docsBySlug) {
  const source = fs.readFileSync(path.join(harnessRoot, "src/mcp/server.ts"), "utf8")
  const tools = [...source.matchAll(/registerTool\("([a-z_]+)"/g)].map((match) => match[1])
  const reference = docsBySlug.get("mcp-reference")?.content ?? ""

  if (tools.length !== 36) {
    fail(`Expected 36 current MCP tools, found ${tools.length}`)
  }
  for (const tool of tools) {
    if (!reference.includes(`## ${tool}\n`)) {
      fail(`mcp-reference.md: missing ${tool}`)
    }
  }
}

function checkReleaseVersion(docsBySlug) {
  const packageVersion = readJson(path.join(harnessRoot, "package.json")).version
  const runtimeSource = fs.readFileSync(path.join(harnessRoot, "src/domain/version.ts"), "utf8")
  const runtimeVersion = runtimeSource.match(/CADRE_RUNTIME_VERSION = "([^"]+)"/)?.[1]
  const docsVersion = readJson(path.join(docsRoot, "package.json")).version
  const notes = docsBySlug.get("release-notes")?.content ?? ""

  if (packageVersion !== runtimeVersion || packageVersion !== docsVersion) {
    fail(`Version mismatch: package=${packageVersion}, runtime=${runtimeVersion}, docs=${docsVersion}`)
  }
  if (!notes.includes(`## ${packageVersion} -`)) {
    fail(`release-notes.md: missing current version ${packageVersion}`)
  }
}

function checkCurrentModel(docsBySlug) {
  requireText(docsBySlug, "overview", ".cadre/")
  requireText(docsBySlug, "getting-started", "cadre-ai install")
  requireText(docsBySlug, "getting-started", "enabledMcpjsonServers")
  requireText(docsBySlug, "getting-started", "mcp__cadre__*")
  for (const workflow of ["create", "track", "implement", "review", "archive"]) {
    requireText(docsBySlug, "quickstart", `$cadre:${workflow}`)
    requireText(docsBySlug, "quickstart", `/cadre:${workflow}`)
  }
  requireText(docsBySlug, "team-and-polyrepo", "Coming Soon")

  const liveEntryPoints = ["overview", "getting-started", "quickstart"]
    .map((slug) => docsBySlug.get(slug)?.content ?? "")
    .join("\n")
  for (const retired of ["$cadre:setup", "/cadre:setup", "cadre install", "cadre/newtrack"]) {
    if (liveEntryPoints.includes(retired)) {
      fail(`Start Here pages contain retired current-usage text: ${retired}`)
    }
  }
}

function requireText(docsBySlug, slug, text) {
  if (!(docsBySlug.get(slug)?.content ?? "").includes(text)) {
    fail(`${slug}.md: missing required current-model text ${text}`)
  }
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
