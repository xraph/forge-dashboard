export interface LayoutCheckOptions {
  /** Only for an outlier page whose table is the whole workspace. */
  allowTablesOutsideSections?: boolean
}

const SECTION = '[data-slot="section"]'

function snippet(el: Element): string {
  return (el.textContent ?? "").trim().slice(0, 60)
}

function sectionName(section: Element): string {
  const heading = section.querySelector("h2")
  return heading ? snippet(heading) : (section.getAttribute("aria-label") ?? "")
}

/**
 * How a rendered page departs from the shared layout: exactly one h1, every
 * h2 and table inside a kit Section, and no Section inside another. An empty
 * list means the page follows the recipe. Framework free, so any test runner
 * (or a dev check) can call it on a container.
 */
export function layoutViolations(
  root: ParentNode,
  options: LayoutCheckOptions = {}
): string[] {
  const found: string[] = []
  const h1s = root.querySelectorAll("h1").length
  if (h1s !== 1) found.push(`expected one h1, found ${h1s}`)
  for (const h2 of Array.from(root.querySelectorAll("h2"))) {
    if (!h2.closest(SECTION))
      found.push(`h2 outside a section: "${snippet(h2)}"`)
  }
  if (!options.allowTablesOutsideSections) {
    for (const table of Array.from(root.querySelectorAll("table"))) {
      if (table.closest(SECTION)) continue
      const label =
        table.closest("[aria-label]")?.getAttribute("aria-label") ??
        snippet(table.querySelector("th") ?? table)
      found.push(`table outside a section: "${label}"`)
    }
  }
  for (const section of Array.from(root.querySelectorAll(SECTION))) {
    if (section.parentElement?.closest(SECTION)) {
      found.push(`section inside a section: "${sectionName(section)}"`)
    }
  }
  return found
}
