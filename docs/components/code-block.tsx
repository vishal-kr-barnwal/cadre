"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

type CodeSyntax = "cadre-command"
type CommandTokenKind =
  | "prefix"
  | "action"
  | "option"
  | "string"
  | "argument"
  | "space"

type CommandToken = {
  kind: CommandTokenKind
  value: string
}

const commandTokenClassNames: Partial<Record<CommandTokenKind, string>> = {
  prefix: "docs-command-prefix",
  action: "docs-command-action",
  option: "docs-command-option",
  string: "docs-command-string",
  argument: "docs-command-argument",
}

export function CodeBlock({
  code,
  className,
  syntax,
}: {
  code: string
  className?: string
  syntax?: CodeSyntax
}) {
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
        <code className={className} data-syntax={syntax}>
          {syntax === "cadre-command" ? (
            <HighlightedCadreCommand code={code} />
          ) : (
            code
          )}
        </code>
      </pre>
      <span className="sr-only" aria-live="polite">
        {copied ? "Code copied to clipboard." : ""}
      </span>
    </div>
  )
}

function HighlightedCadreCommand({ code }: { code: string }) {
  return code.split("\n").map((line, lineIndex, lines) => (
    <React.Fragment key={`${lineIndex}-${line}`}>
      {tokenizeCadreCommand(line).map((token, tokenIndex) => {
        const className = commandTokenClassNames[token.kind]

        return className ? (
          <span
            key={`${tokenIndex}-${token.value}`}
            className={className}
            data-token={token.kind}
          >
            {token.value}
          </span>
        ) : (
          token.value
        )
      })}
      {lineIndex < lines.length - 1 ? "\n" : null}
    </React.Fragment>
  ))
}

function tokenizeCadreCommand(line: string): CommandToken[] {
  const command = line.match(/^(\s*)(\$cadre:|\/cadre:)([a-z][a-z0-9-]*)/i)
  if (!command) return [{ kind: "argument", value: line }]

  const tokens: CommandToken[] = []
  if (command[1]) tokens.push({ kind: "space", value: command[1] })
  tokens.push({ kind: "prefix", value: command[2] })
  tokens.push({ kind: "action", value: command[3] })

  const remainder = line.slice(command[0].length)
  const parts =
    remainder.match(
      /\s+|--?[a-z0-9][a-z0-9-]*(?:=[^\s]+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/gi
    ) ?? []

  for (const value of parts) {
    const kind: CommandTokenKind = /^\s+$/.test(value)
      ? "space"
      : /^--?/.test(value)
        ? "option"
        : /^(?:".*"|'.*')$/.test(value)
          ? "string"
          : "argument"
    tokens.push({ kind, value })
  }

  return tokens
}
