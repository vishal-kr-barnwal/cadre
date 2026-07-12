"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = React.useState(false)

  async function copyCode() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="docs-code-block">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="docs-code-copy"
        aria-label={copied ? "Code copied" : "Copy code"}
        onClick={copyCode}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <pre>
        <code className={className}>{code}</code>
      </pre>
      <span className="sr-only" aria-live="polite">
        {copied ? "Code copied to clipboard." : ""}
      </span>
    </div>
  )
}
