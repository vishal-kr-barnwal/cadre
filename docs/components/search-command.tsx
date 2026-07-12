"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { FileTextIcon, SearchIcon } from "lucide-react"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import type { DocMeta } from "@/lib/docs"
import { cn } from "@/lib/utils"

export function SearchCommand({
  docs,
  mode = "full",
  className,
  enableShortcut = true,
}: {
  docs: DocMeta[]
  mode?: "full" | "icon" | "responsive"
  className?: string
  enableShortcut?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const router = useRouter()
  const filteredDocs = React.useMemo(() => {
    const terms = normalizeSearchValue(query).split(/\s+/).filter(Boolean)
    if (!terms.length) return docs
    return docs.filter((doc) => {
      const haystack = normalizeSearchValue(
        `${doc.title} ${doc.navTitle} ${doc.description} ${doc.section} ${doc.searchText}`
      )
      return terms.every((term) => haystack.includes(term))
    })
  }, [docs, query])

  React.useEffect(() => {
    if (!enableShortcut) return

    const down = (event: KeyboardEvent) => {
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || event.key === "/") {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [enableShortcut])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={mode === "icon" ? "icon" : "default"}
        className={cn(
          mode === "full" && "w-52 justify-start text-muted-foreground",
          mode === "responsive" && "size-11 text-muted-foreground xl:h-9 xl:w-64 xl:justify-start",
          className
        )}
        aria-label="Search docs"
        onClick={() => setOpen(true)}
      >
        <SearchIcon data-icon={mode === "icon" ? "only" : "inline-start"} />
        {mode === "full" ? <span>Search docs</span> : null}
        {mode === "responsive" ? <span className="hidden xl:inline">Search docs</span> : null}
        {mode === "icon" ? <span className="sr-only">Search docs</span> : null}
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) setQuery("")
        }}
        title="Search Cadre docs"
        description="Find guides, workflow references, and architecture pages."
        className="max-w-xl"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search Cadre docs..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Documentation">
              {filteredDocs.map((doc) => (
                <CommandItem
                  key={doc.slug}
                  value={doc.slug}
                  onSelect={() => {
                    setOpen(false)
                    router.push(doc.href)
                  }}
                >
                  <FileTextIcon data-icon="inline-start" />
                  <div className="flex min-w-0 flex-col">
                    <span>{doc.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {doc.description}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

function normalizeSearchValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}
