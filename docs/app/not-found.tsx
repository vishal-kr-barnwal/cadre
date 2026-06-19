import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-semibold tracking-normal text-cadre-ink">
          Page not found
        </h1>
        <p className="text-muted-foreground">
          The Cadre documentation page you requested does not exist.
        </p>
        <Button render={<Link href="/" />}>Return home</Button>
      </div>
    </main>
  )
}
