"use client"

import { CodeBlock } from "@/components/code-block"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type ClientCommands = {
  codex: string
  claude: string
}

export function ClientCommandSwitcher({ commands }: { commands: ClientCommands }) {
  return (
    <Tabs defaultValue="codex" className="gap-3">
      <TabsList aria-label="Choose coding client">
        <TabsTrigger value="codex">Codex</TabsTrigger>
        <TabsTrigger value="claude">Claude Code</TabsTrigger>
      </TabsList>
      <TabsContent value="codex">
        <CodeBlock
          code={commands.codex}
          className="language-shell"
          syntax="cadre-command"
        />
      </TabsContent>
      <TabsContent value="claude">
        <CodeBlock
          code={commands.claude}
          className="language-shell"
          syntax="cadre-command"
        />
      </TabsContent>
    </Tabs>
  )
}
