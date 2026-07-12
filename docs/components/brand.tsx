import Link from "next/link"

import { cn } from "@/lib/utils"

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex min-h-11 items-center", className)}>
      <span className="text-2xl font-semibold tracking-tight text-cadre-teal">
        Cadre
      </span>
    </Link>
  )
}
