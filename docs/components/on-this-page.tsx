import Link from "next/link"
import { ChevronDownIcon, ListIcon } from "lucide-react"

import type { Heading } from "@/lib/docs"
import { cn } from "@/lib/utils"

export function InlineOnThisPage({ headings }: { headings: Heading[] }) {
  if (!headings.length) return null

  return (
    <details className="group rounded-xl border bg-background xl:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium marker:content-none">
        <ListIcon className="size-4 text-cadre-teal" aria-hidden="true" />
        <span>On this page</span>
        <ChevronDownIcon
          className="ml-auto size-4 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <nav aria-label="On this page" className="flex flex-col gap-2 border-t px-4 py-4">
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
    </details>
  )
}

export function OnThisPageRail({ headings }: { headings: Heading[] }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-semibold text-foreground">On this page</p>
      {headings.length ? (
        <nav aria-label="On this page" className="flex flex-col gap-2.5">
          {headings.map((heading) => (
            <Link
              key={heading.id}
              href={`#${heading.id}`}
              className={cn(
                "text-sm leading-5 text-muted-foreground transition-colors hover:text-foreground",
                heading.level === 3 && "pl-3"
              )}
            >
              {heading.text}
            </Link>
          ))}
        </nav>
      ) : (
        <p className="text-sm text-muted-foreground">No sections on this page.</p>
      )}
    </div>
  )
}
