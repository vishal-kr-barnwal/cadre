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
  mode?: "full" | "icon"
  className?: string
  enableShortcut?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()

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
          className
        )}
        aria-label="Search docs"
        onClick={() => setOpen(true)}
      >
        <SearchIcon data-icon={mode === "full" ? "inline-start" : "only"} />
        {mode === "full" ? <span>Search docs</span> : <span className="sr-only">Search docs</span>}
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search Cadre docs"
        description="Find guides, workflow references, and architecture pages."
        className="max-w-xl"
      >
        <Command>
          <CommandInput placeholder="Search Cadre docs..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Documentation">
              {docs.map((doc) => (
                <CommandItem
                  key={doc.slug}
                  value={`${doc.title} ${doc.description} ${doc.section}`}
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
