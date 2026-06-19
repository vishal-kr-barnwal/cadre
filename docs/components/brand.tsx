import Image from "next/image"
import Link from "next/link"

import { cn } from "@/lib/utils"

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-3", className)}>
      <Image
        src="/cadre-mark.png"
        alt=""
        width={30}
        height={30}
        priority
      />
      <span className="text-sm font-semibold tracking-normal text-cadre-ink">
        Cadre
      </span>
    </Link>
  )
}
