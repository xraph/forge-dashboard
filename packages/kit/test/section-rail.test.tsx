import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { SectionRail } from "../src/components/section-rail"
import type { RailItem } from "../src/components/rail-entries"

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const renderLink = (node: { label: string; href: string; icon?: React.ReactNode }, href: string) => (
  <a href={href}>
    {node.icon}
    <span>{node.label}</span>
  </a>
)

const items: RailItem[] = [
  { id: "Identity", label: "Identity", href: "/@auth/p/users" },
  { id: "Billing", label: "Billing", href: "/@auth/p/plans" },
]

function renderRail(expanded: boolean, onToggle = vi.fn()) {
  const view = render(
    <SidebarProvider>
      <SectionRail items={items} activeId="Billing" renderLink={renderLink} search="?env=staging" expanded={expanded} onToggle={onToggle} />
    </SidebarProvider>,
  )
  return { ...view, onToggle }
}

const originalWidth = window.innerWidth

describe("SectionRail", () => {
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true })
  })

  it("is a navigation landmark named Sections with one link per section", () => {
    renderRail(false)
    const rail = screen.getByRole("navigation", { name: "Sections" })
    expect(within(rail).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/@auth/p/users?env=staging",
      "/@auth/p/plans?env=staging",
    ])
    expect(within(rail).getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page")
  })

  it("carries no user menu", () => {
    renderRail(false)
    expect(within(screen.getByRole("navigation", { name: "Sections" })).queryByRole("button", { name: /Dashboard user|Ada/ })).toBeNull()
  })

  it("is icon width when collapsed and sidebar width when expanded", () => {
    const collapsed = renderRail(false)
    const rail = screen.getByRole("navigation", { name: "Sections" })
    expect(rail.getAttribute("data-state")).toBe("collapsed")
    expect(rail.className).toContain("w-(--sidebar-width-icon)")
    collapsed.unmount()
    renderRail(true)
    const wide = screen.getByRole("navigation", { name: "Sections" })
    expect(wide.getAttribute("data-state")).toBe("expanded")
    expect(wide.className).toMatch(/(^|\s)w-\(--sidebar-width\)(\s|$)/)
  })

  it("has an edge toggle named for the direction it moves, reporting aria-expanded", () => {
    const { onToggle } = renderRail(false)
    const toggle = screen.getByRole("button", { name: "Expand sections" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("names the toggle the other way when expanded", () => {
    renderRail(true)
    expect(screen.getByRole("button", { name: "Collapse sections" }).getAttribute("aria-expanded")).toBe("true")
  })

  it("renders nothing below the mobile breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    renderRail(false)
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull()
  })
})
