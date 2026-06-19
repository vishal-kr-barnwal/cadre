import Link from "next/link"
import { ArrowRightIcon, BookOpenIcon, BoxesIcon, GitBranchIcon, Layers3Icon, LifeBuoyIcon, ShieldCheckIcon, WorkflowIcon } from "lucide-react"

import { Brand } from "@/components/brand"
import { WorkflowVisual } from "@/components/home/workflow-visual"
import { SearchCommand } from "@/components/search-command"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { DocMeta } from "@/lib/docs"

const featureCards = [
  {
    title: "Packet-owned workflows",
    description:
      "Agents call deterministic Cadre packets instead of editing plans, metadata, Beads, or review state by hand.",
    icon: WorkflowIcon,
  },
  {
    title: "Durable task memory",
    description:
      "Beads keeps the task graph, dependencies, notes, blockers, and handoffs available across sessions.",
    icon: BoxesIcon,
  },
  {
    title: "Team-scale delivery",
    description:
      "Ownership, advisory leases, review queues, provider evidence, and mono/polyrepo publication stay coordinated.",
    icon: ShieldCheckIcon,
  },
]

const quickLinks = [
  { title: "Getting Started", href: "/getting-started", icon: BookOpenIcon },
  { title: "Architecture", href: "/architecture", icon: Layers3Icon },
  { title: "Team + Polyrepo", href: "/team-and-polyrepo", icon: GitBranchIcon },
  { title: "Troubleshooting", href: "/troubleshooting", icon: LifeBuoyIcon },
]

export function HomePage({ docs }: { docs: DocMeta[] }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-5 px-4 sm:px-6 lg:px-8">
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
            <Link className="hover:text-foreground" href="https://github.com/vishal-kr-barnwal/Cadre">
              GitHub
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
            <Button render={<Link href="/getting-started" />}>Install</Button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_0.86fr] lg:px-8">
          <div className="flex max-w-3xl flex-col gap-8">
            <div className="flex flex-col gap-5">
              <h1 className="max-w-3xl text-5xl leading-[1.03] font-semibold tracking-normal text-cadre-ink sm:text-6xl lg:text-7xl">
                Cadre
              </h1>
              <p className="text-2xl leading-snug font-medium text-cadre-ink sm:text-3xl">
                Measure twice, code once.
              </p>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                Cadre is a context-driven development harness for AI coding agents,
                combining spec-first tracks, Beads-backed task memory, review gates,
                team boards, parallel worker orchestration, and mono/polyrepo delivery.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" render={<Link href="/getting-started" />}>
                Get started
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <Button size="lg" variant="outline" render={<Link href="/architecture" />}>
                Read the architecture
              </Button>
            </div>
            <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
              {["Claude Code", "OpenAI Codex", "Beads memory"].map((label) => (
                <div key={label} className="rounded-xl border bg-card px-4 py-3 text-sm font-medium text-cadre-ink">
                  {label}
                </div>
              ))}
            </div>
          </div>
          <WorkflowVisual />
        </section>

        <Separator />

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mb-10 flex max-w-3xl flex-col gap-3">
            <h2 className="text-3xl font-semibold tracking-normal text-cadre-ink">
              A workflow layer agents can actually operate.
            </h2>
            <p className="text-muted-foreground">
              The docs are organized around how Cadre works in practice: setup,
              planning, implementation, review, delivery, teams, and internals.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {featureCards.map((feature) => {
              const Icon = feature.icon
              return (
                <Card key={feature.title}>
                  <CardHeader>
                    <Icon className="text-cadre-teal" />
                    <CardTitle>{feature.title}</CardTitle>
                    <CardDescription>{feature.description}</CardDescription>
                  </CardHeader>
                </Card>
              )
            })}
          </div>
        </section>

        <section className="border-y bg-muted/35">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-semibold tracking-normal text-cadre-ink">
                Documentation map
              </h2>
              <p className="text-muted-foreground">
                Start with the workflow guide, then go deeper into architecture,
                team-scale operation, parallel execution, and support.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {quickLinks.map((link) => {
                const Icon = link.icon
                return (
                  <Card key={link.title} size="sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Icon className="text-cadre-amber" />
                        {link.title}
                      </CardTitle>
                    </CardHeader>
                    <CardFooter>
                      <Button variant="ghost" size="sm" render={<Link href={link.href} />}>
                        Open guide
                        <ArrowRightIcon data-icon="inline-end" />
                      </Button>
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="text-3xl font-semibold tracking-normal text-cadre-ink">
                All guides
              </h2>
              <p className="text-muted-foreground">
                Markdown-backed pages rendered by the Next.js docs shell.
              </p>
            </div>
            <Badge variant="secondary">{docs.length} pages</Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {docs.map((doc) => (
              <Card key={doc.slug} size="sm">
                <CardHeader>
                  <Badge variant="outline">{doc.section}</Badge>
                  <CardTitle>{doc.title}</CardTitle>
                  <CardDescription>{doc.description}</CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button variant="outline" size="sm" render={<Link href={doc.href} />}>
                    Read
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
