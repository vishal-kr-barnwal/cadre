import Link from "next/link"
import * as React from "react"
import ReactMarkdown from "react-markdown"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"

import { ClientCommandSwitcher } from "@/components/client-command-switcher"
import { CodeBlock } from "@/components/code-block"
import { MermaidDiagram } from "@/components/mermaid-diagram"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function Markdown({ content }: { content: string }) {
  return (
    <article className="docs-prose max-w-3xl">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={{
          a: ({ href = "", children }) => {
            if (href.startsWith("http")) {
              return (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              )
            }

            return <Link href={normalizeHref(href)}>{children}</Link>
          },
          blockquote: ({ children }) => (
            <Alert>
              <AlertTitle>Note</AlertTitle>
              <AlertDescription>{children}</AlertDescription>
            </Alert>
          ),
          img: ({ src = "", alt = "" }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={normalizeAssetSrc(String(src))} alt={alt} />
          ),
          pre: ({ children }) => {
            const child = getOnlyElement(children)

            if (child?.props.className?.includes("language-mermaid")) {
              return <MermaidDiagram chart={String(child.props.children).trim()} />
            }

            const code = child ? textContent(child.props.children).replace(/\n$/, "") : ""
            const clientCommands = parseClientCommands(code)

            if (clientCommands) {
              return <ClientCommandSwitcher commands={clientCommands} />
            }

            return <CodeBlock code={code} className={child?.props.className} />
          },
          table: ({ children }) => <ResponsiveTable>{children}</ResponsiveTable>,
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}

function parseClientCommands(code: string) {
  const lines = code.split("\n")
  const codexMarker = lines.findIndex((line) => line.trim() === "# Codex")
  const claudeMarker = lines.findIndex((line) => line.trim() === "# Claude Code")

  if (codexMarker >= 0 && claudeMarker > codexMarker) {
    const codex = trimBlankLines(lines.slice(codexMarker + 1, claudeMarker)).join("\n")
    const claude = trimBlankLines(lines.slice(claudeMarker + 1)).join("\n")
    return codex && claude ? { codex, claude } : null
  }

  const commands = lines.map((line) => line.trim()).filter(Boolean)
  const codex = commands.filter((line) => line.startsWith("$cadre:"))
  const claude = commands.filter((line) => line.startsWith("/cadre:"))

  if (codex.length === 0 || claude.length === 0 || codex.length + claude.length !== commands.length) {
    return null
  }

  return { codex: codex.join("\n"), claude: claude.join("\n") }
}

function trimBlankLines(lines: string[]) {
  let start = 0
  let end = lines.length

  while (start < end && lines[start].trim() === "") start += 1
  while (end > start && lines[end - 1].trim() === "") end -= 1

  return lines.slice(start, end)
}

function ResponsiveTable({ children }: { children: React.ReactNode }) {
  const sections = React.Children.toArray(children)
  const head = sections.find((section) => isTag(section, "thead"))
  const headRow = head ? React.Children.toArray(head.props.children).find((row) => isTag(row, "tr")) : null
  const headers = headRow
    ? React.Children.toArray(headRow.props.children)
        .filter((cell) => isTag(cell, "th"))
        .map((cell) => textContent(cell.props.children))
    : []

  const enhanced = React.Children.map(children, (section) => {
    if (!isTag(section, "tbody")) return section

    const rows = React.Children.map(section.props.children, (row) => {
      if (!isTag(row, "tr")) return row

      const cells = React.Children.map(row.props.children, (cell, index) => {
        if (!isTag(cell, "td")) return cell
        return React.cloneElement(
          cell as React.ReactElement<Record<string, unknown>>,
          { "data-label": headers[index] ?? "Value" }
        )
      })

      return React.cloneElement(row, undefined, cells)
    })

    return React.cloneElement(section, undefined, rows)
  })

  return (
    <div className="docs-table-wrap" role="region" aria-label="Scrollable table" tabIndex={0}>
      <table>{enhanced}</table>
    </div>
  )
}

function normalizeHref(href: string) {
  if (!href) return href
  if (href.startsWith("#") || href.startsWith("/")) return href.replace(/\.md(?=#|$)/, "")
  return `/${href.replace(/\.md(?=#|$)/, "")}`
}

function normalizeAssetSrc(src: string) {
  if (!src.startsWith("/")) return src
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""
  return `${basePath}${src}`
}

function getOnlyElement(children: React.ReactNode) {
  const items = React.Children.toArray(children)
  if (items.length !== 1 || !React.isValidElement(items[0])) return null
  return items[0] as React.ReactElement<{
    className?: string
    children?: React.ReactNode
  }>
}

function isTag(
  value: React.ReactNode,
  tag: string
): value is React.ReactElement<{ children?: React.ReactNode }> {
  return React.isValidElement(value) && value.type === tag
}

function textContent(value: React.ReactNode): string {
  return React.Children.toArray(value)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child)
      return React.isValidElement<{ children?: React.ReactNode }>(child)
        ? textContent(child.props.children)
        : ""
    })
    .join("")
}
