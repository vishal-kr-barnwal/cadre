import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import Link from "next/link"

import { DocsShell } from "@/components/docs-shell"
import { Markdown } from "@/components/markdown"
import {
  getAllDocs,
  getAllSlugs,
  getDocBySlug,
} from "@/lib/docs"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
      <div className="flex max-w-4xl flex-col gap-8">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{doc.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col gap-4">
          <Badge variant="secondary" className="w-fit">
            {doc.section}
          </Badge>
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl leading-tight font-semibold tracking-normal text-cadre-ink sm:text-5xl">
              {doc.title}
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
              {doc.description}
            </p>
          </div>
        </div>

        <Separator />

        <Markdown content={doc.content} />

        <Separator className="mt-8" />

        <div className="grid gap-4 sm:grid-cols-2">
          {doc.previous ? (
            <Card>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">Previous</p>
                <Button variant="outline" className="justify-start" render={<Link href={doc.previous.href} />}>
                  <ArrowLeftIcon data-icon="inline-start" />
                  {doc.previous.title}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div />
          )}
          {doc.next ? (
            <Card>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">Next</p>
                <Button variant="outline" className="justify-start" render={<Link href={doc.next.href} />}>
                  {doc.next.title}
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </DocsShell>
  )
}
