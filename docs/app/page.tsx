import { HomePage } from "@/components/home/home-page"
import { getAllDocs } from "@/lib/docs"
import { StructuredData } from "@/components/structured-data"
import { HOME_TITLE, pageMetadata, SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/seo"

export const metadata = {
  ...pageMetadata(HOME_TITLE, SITE_DESCRIPTION, "/"),
  title: { absolute: HOME_TITLE },
}

const website = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${siteUrl()}#website`,
  name: SITE_NAME,
  alternateName: ["cadre-ai", "Cadre"],
  url: siteUrl(),
  description: SITE_DESCRIPTION,
  inLanguage: "en",
  sameAs: [
    "https://github.com/vishal-kr-barnwal/cadre",
    "https://www.npmjs.com/package/cadre-ai",
  ],
}

export default function Page() {
  return (
    <>
      <StructuredData data={website} />
      <HomePage docs={getAllDocs()} />
    </>
  )
}
