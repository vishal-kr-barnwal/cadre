import navigation from "@/navigation.json"

export type DocSection =
  | "Start Here"
  | "User Guide"
  | "Operations"
  | "Contributor Guide"
  | "Reference"

export const DOC_NAVIGATION = navigation as Array<{
  section: DocSection
  slugs: string[]
}>

export const DOC_SECTIONS = DOC_NAVIGATION.map(({ section }) => section)

export const DOC_SLUGS = DOC_NAVIGATION.flatMap(({ slugs }) => slugs)

export function getNavigationPosition(slug: string) {
  for (const [sectionOrder, group] of DOC_NAVIGATION.entries()) {
    const navOrder = group.slugs.findIndex((candidate) => candidate === slug)
    if (navOrder !== -1) {
      return { section: group.section, sectionOrder, navOrder }
    }
  }

  return null
}
