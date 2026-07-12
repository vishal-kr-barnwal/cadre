import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import Link from "next/link"

import { DocsShell } from "@/components/docs-shell"
import { Markdown } from "@/components/markdown"
import { InlineOnThisPage } from "@/components/on-this-page"
import {
  getAllDocs,
  getAllSlugs,
  getDocBySlug,
} from "@/lib/docs"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"

type PageProps = {
  params: Promise<{ slug: string }>
}

export const dynamicParams = false

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  try {
    const doc = getDocBySlug(slug)
    return {
      title: doc.title,
      description: doc.description,
    }
  } catch {
    return {}
  }
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params
  const docs = getAllDocs()

  if (!getAllSlugs().includes(slug)) {
    notFound()
  }

  const doc = getDocBySlug(slug)

  return (
    <DocsShell docs={docs} headings={doc.headings}>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 xl:mx-0">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={doc.sectionHref} />}>{doc.section}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{doc.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col gap-4">
          <h1 className="text-[2.55rem] leading-[1.08] font-semibold tracking-tight text-cadre-ink sm:text-5xl lg:text-[3.25rem]">
            {doc.title}
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
            {doc.description}
          </p>
        </div>

        <InlineOnThisPage headings={doc.headings} />

        <Markdown content={doc.content} />

        <Separator className="mt-8" />

        <nav aria-label="Documentation pagination" className="grid gap-5 sm:grid-cols-2">
          {doc.previous ? (
            <Link className="group flex min-h-16 items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-muted" href={doc.previous.href}>
              <ArrowLeftIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-xs text-muted-foreground">Previous</span>
                <span className="font-medium text-foreground">{doc.previous.title}</span>
              </span>
            </Link>
          ) : (
            <div />
          )}
          {doc.next ? (
            <Link className="group flex min-h-16 items-center justify-end gap-3 rounded-xl border p-4 text-right transition-colors hover:bg-muted" href={doc.next.href}>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-xs text-muted-foreground">Next</span>
                <span className="font-medium text-foreground">{doc.next.title}</span>
              </span>
              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : null}
        </nav>
      </div>
    </DocsShell>
  )
}
