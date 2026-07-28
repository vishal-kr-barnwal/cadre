import Link from "next/link"
import { ArrowRightIcon, BookOpenIcon, GitBranchIcon, Layers3Icon, LifeBuoyIcon, MenuIcon, ShieldCheckIcon, WorkflowIcon } from "lucide-react"

import { Brand } from "@/components/brand"
import { WorkflowVisual } from "@/components/home/workflow-visual"
import { SearchCommand } from "@/components/search-command"
import { ThemeSwitcher } from "@/components/theme-switcher"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { DocMeta } from "@/lib/docs"

const featureCards = [
  {
    title: "Human approval gates",
    description:
      "Artifacts, commits, integrations, verification, and lifecycle changes stay proposals until you approve them.",
    icon: WorkflowIcon,
  },
  {
    title: "Resumable delivery",
    description:
      "Project, track, operation, and execution journals reconcile repository and Git state after interruptions.",
    icon: ShieldCheckIcon,
  },
  {
    title: "Safe parallel execution",
    description:
      "Dependency-ready workers use isolated worktrees while the main agent owns scheduling, integration, and approval.",
    icon: GitBranchIcon,
  },
]

const quickLinks = [
  { title: "Getting Started", href: "/getting-started", icon: BookOpenIcon },
  { title: "Architecture", href: "/architecture", icon: Layers3Icon },
  { title: "Parallel Execution", href: "/parallel-execution", icon: GitBranchIcon },
  { title: "Troubleshooting", href: "/troubleshooting", icon: LifeBuoyIcon },
]

export function HomePage({ docs }: { docs: DocMeta[] }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-[68px] max-w-screen-2xl items-center gap-5 px-4 sm:px-6 lg:px-8">
          <Brand />
          <nav className="hidden items-center gap-7 text-sm font-medium text-foreground xl:flex">
            <Link className="hover:text-foreground" href="/overview">
              Docs
            </Link>
            <Link className="hover:text-foreground" href="/getting-started">
              Getting Started
            </Link>
            <Link className="hover:text-cadre-teal" href="/architecture">
              Contributor Guide
            </Link>
            <Link className="hover:text-foreground" href="https://github.com/vishal-kr-barnwal/cadre">
              GitHub
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SearchCommand docs={docs} mode="responsive" />
            <ThemeSwitcher />
            <Button className="hidden bg-cadre-teal text-white hover:bg-cadre-teal/90 xl:inline-flex" render={<Link href="/getting-started" />}>Install</Button>
            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-lg"
                    className="size-11 xl:hidden"
                    aria-label="Open site navigation"
                  />
                }
              >
                <MenuIcon />
              </SheetTrigger>
              <SheetContent side="right" className="w-[min(90vw,22rem)] p-0">
                <SheetHeader className="border-b">
                  <SheetTitle>Cadre documentation</SheetTitle>
                  <SheetDescription>Choose a guide or reference section.</SheetDescription>
                </SheetHeader>
                <nav className="flex flex-col gap-2 p-4 text-sm">
                  <Link className="rounded-lg px-3 py-3 hover:bg-muted" href="/overview">Docs overview</Link>
                  <Link className="rounded-lg px-3 py-3 hover:bg-muted" href="/getting-started">Getting Started</Link>
                  <Link className="rounded-lg px-3 py-3 hover:bg-muted" href="/operations">Operations</Link>
                  <Link className="rounded-lg px-3 py-3 hover:bg-muted" href="/architecture">Contributor Guide</Link>
                  <Link className="rounded-lg px-3 py-3 hover:bg-muted" href="/workflow-reference">Reference</Link>
                  <Link className="rounded-lg px-3 py-3 hover:bg-muted" href="https://github.com/vishal-kr-barnwal/cadre">GitHub</Link>
                </nav>
              </SheetContent>
            </Sheet>
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
                Cadre is a human-governed, Git-aware delivery harness for Codex and
                Claude Code, combining approved project context, spec-first tracks,
                resumable execution, review gates, and safe parallel worktrees.
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
              {["Claude Code", "OpenAI Codex", "versioned MCP runtime"].map((label) => (
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
              Durable delivery without hidden workflow state.
            </h2>
            <p className="text-muted-foreground">
              The docs follow the actual create-to-archive lifecycle: context,
              planning, implementation, verification, review, learning, and recovery.
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
                Start with installation and the first track, then go deeper into
                lifecycle rules, parallel execution, MCP tools, and recovery.
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
                  <CardTitle>{doc.navTitle}</CardTitle>
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
