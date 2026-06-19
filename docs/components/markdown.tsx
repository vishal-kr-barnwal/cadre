import Link from "next/link"
import ReactMarkdown from "react-markdown"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"

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
