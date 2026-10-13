import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "parse5"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const output = path.join(root, "out")
const navigation = JSON.parse(fs.readFileSync(path.join(root, "navigation.json"), "utf8"))
const slugs = navigation.flatMap((group) => group.slugs)
const origin = fs.readFileSync(path.join(root, "lib/seo.ts"), "utf8")
  .match(/SITE_ORIGIN = "([^"]+)"/)?.[1]
if (!origin) throw new Error("Cannot resolve the configured canonical origin")
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""
const absolute = (route) => new URL(`${basePath}${route}`, origin).href
const failures = []
const pages = new Map()
const titles = new Set()
const descriptions = new Set()
const check = (condition, message) => { if (!condition) failures.push(message) }
const attrs = (node) => Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]))
const text = (node) => node.value ?? (node.childNodes ?? []).map(text).join("")

for (const route of ["/", ...slugs.map((slug) => `/${slug}/`)]) {
  const file = path.join(output, route, "index.html")
  if (!fs.existsSync(file)) throw new Error(`Missing export: ${file}. Run pnpm build first.`)
  const elements = []
  const walk = (node) => {
    if (node.tagName) elements.push(node)
    for (const child of node.childNodes ?? []) walk(child)
  }
  walk(parse(fs.readFileSync(file, "utf8")))
  const tagged = (tag) => elements.filter((node) => node.tagName === tag)
  const meta = (key) => tagged("meta").filter((node) => {
    const a = attrs(node)
    return a.name === key || a.property === key
  }).map((node) => attrs(node).content)
  const oneMeta = (key) => {
    const values = meta(key)
    check(values.length === 1 && Boolean(values[0]?.trim()), `${route}: expected one nonempty ${key}`)
    return values[0]
  }
  const title = tagged("title").map(text)
  check(title.length === 1 && Boolean(title[0]?.trim()), `${route}: expected one title`)
  check(!titles.has(title[0]), `${route}: duplicate title`)
  titles.add(title[0])
  const description = oneMeta("description")
  check(!descriptions.has(description), `${route}: duplicate description`)
  descriptions.add(description)
  check(tagged("h1").length === 1 && text(tagged("h1")[0]).trim(), `${route}: expected one meaningful H1`)
  check(attrs(tagged("html")[0]).lang === "en", `${route}: missing language`)
  check(tagged("main").some((node) => text(node).trim().length > 100), `${route}: missing rendered main content`)
  const canonical = tagged("link").filter((node) => attrs(node).rel === "canonical")
  check(canonical.length === 1 && attrs(canonical[0]).href === absolute(route), `${route}: incorrect canonical`)
  check(!meta("robots").some((value) => /noindex|nofollow/i.test(value)), `${route}: unexpectedly blocked from indexing`)
  check(oneMeta("og:url") === absolute(route), `${route}: Open Graph URL differs from canonical`)
  for (const key of ["og:title", "twitter:title"]) check(oneMeta(key) === title[0], `${route}: ${key} differs from title`)
  for (const key of ["og:description", "twitter:description"]) check(oneMeta(key) === description, `${route}: ${key} differs from description`)
  oneMeta("twitter:card")
  for (const key of ["og:image", "twitter:image"]) {
    const image = oneMeta(key)
    check(image === absolute("/cadre-mark.png"), `${route}: missing canonical share image`)
  }
  oneMeta("og:image:alt")
  oneMeta("twitter:image:alt")
  const data = tagged("script").filter((node) => attrs(node).type === "application/ld+json").flatMap((node) => {
    try { return [JSON.parse(text(node))] } catch { failures.push(`${route}: invalid JSON-LD`); return [] }
  })
  const article = data.find((item) => item["@type"] === (route === "/" ? "WebSite" : "TechArticle"))
  check(article?.url === absolute(route), `${route}: missing or incorrect page structured data`)
  if (route !== "/") {
    const crumbs = data.find((item) => item["@type"] === "BreadcrumbList")?.itemListElement
    check(crumbs?.at(-1)?.item === absolute(route), `${route}: incorrect breadcrumb destination`)
  }
  for (const img of tagged("img")) check("alt" in attrs(img), `${route}: image missing alt attribute`)
  pages.set(absolute(route), {
    elements,
    ids: new Set(elements.map((node) => attrs(node).id).filter(Boolean)),
  })
}

let links = 0
for (const [url, page] of pages) {
  for (const node of page.elements.filter((element) => element.tagName === "a")) {
    const href = attrs(node).href
    if (!href || /^(mailto:|tel:)/.test(href)) continue
    const target = new URL(href, url)
    if (target.origin !== new URL(origin).origin) continue
    links += 1
    let route = target.pathname
    if (basePath && route.startsWith(`${basePath}/`)) route = route.slice(basePath.length)
    if (!path.extname(route) && !route.endsWith("/")) route += "/"
    const destination = pages.get(absolute(route))
    if (destination) {
      check(!target.hash || destination.ids.has(decodeURIComponent(target.hash.slice(1))), `${url}: broken fragment ${href}`)
    } else {
      check(fs.existsSync(path.join(output, route)), `${url}: broken local link ${href}`)
    }
  }
}
const sitemap = fs.readFileSync(path.join(output, "sitemap.xml"), "utf8")
const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
check(listed.length === pages.size && new Set(listed).size === pages.size, "Sitemap count/uniqueness mismatch")
for (const url of pages.keys()) check(listed.includes(url), `Sitemap missing canonical ${url}`)
const robots = fs.readFileSync(path.join(output, "robots.txt"), "utf8")
check(/^Allow: \/$/m.test(robots) && !/^Disallow: \/$/m.test(robots), "robots.txt blocks crawling")
check(robots.includes(`Sitemap: ${absolute("/sitemap.xml")}`), "robots.txt has incorrect sitemap")
check(fs.existsSync(path.join(output, "cadre-mark.png")), "Share image absent from export")
const notFound = fs.readFileSync(path.join(output, "404.html"), "utf8")
check(/name="robots" content="[^"]*noindex/.test(notFound), "404 must remain noindex")
if (failures.length) throw new Error(`${failures.length} SEO/export failures:\n${failures.slice(0, 40).join("\n")}`)
console.log(`SEO/export check passed: ${pages.size} pages, ${links} internal links, metadata, JSON-LD, sitemap and robots.`)
