"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ExternalLinkIcon, MenuIcon } from "lucide-react"

import { Brand } from "@/components/brand"
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
import { cn } from "@/lib/utils"

type DocsShellProps = {
  docs: DocMeta[]
  headings?: Heading[]
  children: React.ReactNode
}

export function DocsShell({ docs, headings = [], children }: DocsShellProps) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open documentation navigation"
                />
              }
            >
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0" showCloseButton>
              <SheetHeader className="border-b">
                <SheetTitle className="sr-only">Documentation navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  Browse Cadre documentation pages.
                </SheetDescription>
                <Brand />
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-73px)] p-4">
                <DocsNav docs={docs} pathname={pathname} />
              </ScrollArea>
            </SheetContent>
          </Sheet>

          <Brand />

          <nav className="hidden items-center gap-5 text-sm font-medium text-muted-foreground md:flex">
            <Link className="hover:text-foreground" href="/overview">
              Docs
            </Link>
            <Link className="hover:text-foreground" href="/getting-started">
              Getting Started
            </Link>
            <Link className="hover:text-foreground" href="/architecture">
              Architecture
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <SearchCommand docs={docs} className="hidden sm:inline-flex" />
            <SearchCommand
              docs={docs}
              mode="icon"
              className="sm:hidden"
              enableShortcut={false}
            />
            <Button variant="ghost" size="icon" render={<Link href="https://github.com/vishal-kr-barnwal/Cadre" />}>
              <ExternalLinkIcon />
              <span className="sr-only">GitHub</span>
            </Button>
            <Button className="hidden sm:inline-flex" render={<Link href="/getting-started" />}>
              Install
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_220px]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] border-r lg:block">
          <ScrollArea className="h-full px-5 py-8">
            <DocsNav docs={docs} pathname={pathname} />
          </ScrollArea>
        </aside>

        <main className="min-w-0 px-4 py-10 sm:px-6 lg:px-10">{children}</main>

        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] border-l xl:block">
          <ScrollArea className="h-full px-5 py-8">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium text-foreground">On this page</p>
              {headings.length ? (
                <nav className="flex flex-col gap-2">
                  {headings.map((heading) => (
                    <Link
                      key={heading.id}
                      href={`#${heading.id}`}
                      className={cn(
                        "text-sm text-muted-foreground hover:text-foreground",
                        heading.level === 3 && "pl-3"
                      )}
                    >
                      {heading.text}
                    </Link>
                  ))}
                </nav>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a documentation page to see its sections.
                </p>
              )}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  )
}

function DocsNav({ docs, pathname }: { docs: DocMeta[]; pathname: string }) {
  const sections = docs.reduce<Record<string, DocMeta[]>>((acc, doc) => {
    acc[doc.section] ??= []
    acc[doc.section].push(doc)
    return acc
  }, {})

  return (
    <nav className="flex flex-col gap-6">
      {Object.entries(sections).map(([section, items]) => (
        <div key={section} className="flex flex-col gap-2">
          <p className="px-2 text-xs font-semibold tracking-normal text-muted-foreground">
            {section}
          </p>
          <div className="flex flex-col gap-1">
            {items.map((item) => {
              const active = pathname === item.href || pathname === `${item.href}/`
              return (
                <Link
                  key={item.slug}
                  href={item.href}
                  className={cn(
                    "rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-cadre-teal-soft font-medium text-cadre-ink"
                  )}
                >
                  {item.title}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
