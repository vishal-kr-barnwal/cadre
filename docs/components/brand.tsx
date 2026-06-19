import Image from "next/image"
import Link from "next/link"

import { cn } from "@/lib/utils"

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-3", className)}>
      <Image
        src="/cadre-logo.png"
        alt="Cadre"
        width={132}
        height={40}
        priority
      />
    </Link>
  )
}
