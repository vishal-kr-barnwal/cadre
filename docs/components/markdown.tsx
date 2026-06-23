import Link from "next/link"
import * as React from "react"
import ReactMarkdown from "react-markdown"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"

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

            return <pre>{children}</pre>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
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
