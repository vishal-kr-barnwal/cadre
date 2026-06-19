import { HomePage } from "@/components/home/home-page"
import { getAllDocs } from "@/lib/docs"

export default function Page() {
  return <HomePage docs={getAllDocs()} />
}
