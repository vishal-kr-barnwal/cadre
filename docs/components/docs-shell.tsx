"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MenuIcon } from "lucide-react"

import { Brand } from "@/components/brand"
import { OnThisPageRail } from "@/components/on-this-page"
import { SearchCommand } from "@/components/search-command"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { DocMeta, Heading } from "@/lib/docs"
import { DOC_NAVIGATION } from "@/lib/navigation"
import { cn } from "@/lib/utils"

type DocsShellProps = {
  docs: DocMeta[]
  headings?: Heading[]
  children: React.ReactNode
}

export function DocsShell({ docs, headings = [], children }: DocsShellProps) {
  const pathname = usePathname()
  const [navigationOpen, setNavigationOpen] = React.useState(false)

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
        <div className="mx-auto flex h-[68px] max-w-screen-2xl items-center gap-5 px-4 sm:px-6 lg:px-8">
          <Brand />

          <nav className="hidden items-center gap-7 text-sm font-medium text-foreground xl:flex">
            <Link className="transition-colors hover:text-cadre-teal" href="/overview">
              Docs
            </Link>
            <Link className="transition-colors hover:text-cadre-teal" href="/getting-started">
              Getting Started
            </Link>
            <Link className="transition-colors hover:text-cadre-teal" href="/architecture">
              Contributor Guide
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <SearchCommand docs={docs} mode="responsive" />

            <Button className="hidden bg-cadre-teal text-white hover:bg-cadre-teal/90 xl:inline-flex" render={<Link href="/getting-started" />}>
              Install
            </Button>

          <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="size-11 xl:hidden"
                  aria-label="Open documentation navigation"
                />
              }
            >
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(90vw,22rem)] p-0" showCloseButton>
              <SheetHeader className="border-b">
                <SheetTitle className="sr-only">Documentation navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  Browse Cadre documentation pages.
                </SheetDescription>
                <Brand />
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-73px)] p-4">
                <DocsNav
                  docs={docs}
                  pathname={pathname}
                  onNavigate={() => setNavigationOpen(false)}
                />
              </ScrollArea>
            </SheetContent>
          </Sheet>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-screen-2xl grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_240px]">
        <aside className="sticky top-[68px] hidden h-[calc(100vh-68px)] border-r xl:block">
          <ScrollArea className="h-full px-4 py-8">
            <DocsNav docs={docs} pathname={pathname} />
          </ScrollArea>
        </aside>

        <main className="min-w-0 px-4 py-9 sm:px-8 lg:px-12 xl:px-14 xl:py-11">{children}</main>

        <aside className="sticky top-[68px] hidden h-[calc(100vh-68px)] border-l xl:block">
          <ScrollArea className="h-full px-6 py-9">
            <OnThisPageRail headings={headings} />
          </ScrollArea>
        </aside>
      </div>
    </div>
  )
}

function DocsNav({
  docs,
  pathname,
  onNavigate,
}: {
  docs: DocMeta[]
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Documentation" className="flex flex-col gap-7">
      {DOC_NAVIGATION.map((group) => {
        const items = group.slugs
          .map((slug) => docs.find((doc) => doc.slug === slug))
          .filter((doc): doc is DocMeta => Boolean(doc))

        return (
          <div key={group.section} className="flex flex-col gap-2">
          <p className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {group.section}
          </p>
          <div className="flex flex-col gap-1">
            {items.map((item) => {
              const active = pathname === item.href || pathname === `${item.href}/`
              return (
                <Link
                  key={item.slug}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "min-h-9 rounded-lg border-l-2 border-transparent px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "border-cadre-teal bg-cadre-teal-soft font-medium text-cadre-ink"
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {item.navTitle}
                </Link>
              )
            })}
          </div>
          </div>
        )
      })}
    </nav>
  )
}
