"use client"

import * as React from "react"
import { AlertTriangleIcon } from "lucide-react"
import { useTheme } from "next-themes"

type RenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string }

const MOBILE_FLOWCHART_QUERY = "(max-width: 640px)"
const FLOWCHART_DIRECTION_PATTERN = /^(\s*(?:flowchart|graph)\s+)(TB|TD|BT|RL|LR)(\b)/im

export function MermaidDiagram({ chart }: { chart: string }) {
  const { resolvedTheme } = useTheme()
  const [useMobileDirection, setUseMobileDirection] = React.useState(false)
  const [state, setState] = React.useState<RenderState>({ status: "loading" })
  const chartSource = useMobileDirection ? toTopDownFlowchart(chart) : chart

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_FLOWCHART_QUERY)
    const updateDirection = () => setUseMobileDirection(mediaQuery.matches)

    updateDirection()
    mediaQuery.addEventListener("change", updateDirection)

    return () => {
      mediaQuery.removeEventListener("change", updateDirection)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false

    async function renderDiagram() {
      setState({ status: "loading" })

      try {
        const { default: mermaid } = await import("mermaid")
        const theme = resolvedTheme === "dark" ? "dark" : "default"

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme,
          fontFamily: "inherit",
          flowchart: {
            curve: "basis",
            htmlLabels: false,
          },
        })

        const renderId = `cadre-mermaid-${Math.random().toString(36).slice(2)}`
        const { svg } = await mermaid.render(renderId, chartSource)

        if (!cancelled) {
          setState({ status: "ready", svg })
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to render diagram.",
          })
        }
      }
    }

    void renderDiagram()

    return () => {
      cancelled = true
    }
  }, [chartSource, resolvedTheme])

  if (state.status === "ready") {
    return (
      <figure
        className="mermaid-diagram"
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }

  if (state.status === "error") {
    return (
      <figure className="mermaid-diagram mermaid-diagram-error">
        <figcaption>
          <AlertTriangleIcon />
          <span>{state.message}</span>
        </figcaption>
        <pre>
          <code>{chart}</code>
        </pre>
      </figure>
    )
  }

  return (
    <figure className="mermaid-diagram mermaid-diagram-loading" aria-busy="true">
      Rendering diagram...
    </figure>
  )
}

function toTopDownFlowchart(chart: string) {
  return chart.replace(FLOWCHART_DIRECTION_PATTERN, "$1TD$3")
}
