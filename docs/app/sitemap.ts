import type { MetadataRoute } from "next"

import { getAllDocs } from "@/lib/docs"
import { siteUrl } from "@/lib/seo"

export const dynamic = "force-static"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: siteUrl() },
    ...getAllDocs().map((doc) => ({ url: siteUrl(`${doc.href}/`) })),
  ]
}
