import { ArchiveIcon, CheckCircle2Icon, GitPullRequestIcon, NetworkIcon, PencilRulerIcon, ShieldCheckIcon } from "lucide-react"

const steps = [
  { label: "Setup", icon: PencilRulerIcon },
  { label: "Track", icon: NetworkIcon },
  { label: "Implement", icon: GitPullRequestIcon },
  { label: "Review", icon: ShieldCheckIcon },
  { label: "Ship / Land", icon: CheckCircle2Icon },
  { label: "Archive", icon: ArchiveIcon },
]

export function WorkflowVisual() {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-5 flex items-center justify-between border-b pb-4">
        <div>
          <p className="text-sm font-medium text-foreground">Packet-owned workflow</p>
          <p className="text-xs text-muted-foreground">Cadre MCP coordinates every state change.</p>
        </div>
        <div className="h-2 w-16 rounded-full bg-cadre-teal" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {steps.map((step, index) => {
          const Icon = step.icon
          return (
            <div key={step.label} className="relative rounded-xl border bg-background p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  0{index + 1}
                </span>
                <Icon className="text-cadre-teal" />
              </div>
              <p className="text-sm font-semibold text-cadre-ink">{step.label}</p>
              {index < steps.length - 1 && (
                <span className="absolute -right-2 top-1/2 hidden h-px w-4 bg-border sm:block" />
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 text-center text-xs font-medium text-muted-foreground">
        <div className="rounded-lg bg-cadre-teal-soft px-3 py-2 text-cadre-ink">MCP</div>
        <div className="rounded-lg bg-cadre-amber-soft px-3 py-2 text-cadre-ink">Events</div>
        <div className="rounded-lg bg-muted px-3 py-2 text-cadre-ink">LSP</div>
      </div>
    </div>
  )
}
