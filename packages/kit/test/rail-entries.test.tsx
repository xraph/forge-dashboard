import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { RailEntries } from "../src/components/rail-entries"
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
  { id: "Identity", label: "Identity", href: "/@auth/p/users", icon: <svg data-testid="identity-icon" /> },
  { id: "Billing", label: "Billing", href: "/@auth/p/plans" },
]

function renderEntries(props: Partial<React.ComponentProps<typeof RailEntries>> = {}) {
  return render(
    <SidebarProvider>
      <RailEntries items={items} activeId="Billing" renderLink={renderLink} {...props} />
    </SidebarProvider>,
  )
}

describe("RailEntries", () => {
  it("renders one link per item, in order, to its href", () => {
    renderEntries()
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/@auth/p/users",
      "/@auth/p/plans",
    ])
  })

  it("keeps the query string on every link", () => {
    renderEntries({ search: "?env=staging" })
    expect(screen.getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/@auth/p/plans?env=staging")
  })

  it("marks the active item and nothing else", () => {
    renderEntries()
    const billing = screen.getByRole("link", { name: "Billing" })
    expect(billing.getAttribute("aria-current")).toBe("page")
    expect(billing.hasAttribute("data-active")).toBe(true)
    const identity = screen.getByRole("link", { name: "Identity" })
    expect(identity.getAttribute("aria-current")).toBeNull()
    expect(identity.hasAttribute("data-active")).toBe(false)
  })

  it("draws the item's icon, or an initial when there is none", () => {
    renderEntries()
    expect(screen.getByTestId("identity-icon")).toBeTruthy()
    const glyph = screen.getByRole("link", { name: "Billing" }).querySelector('[data-slot="rail-glyph"]') as HTMLElement
    expect(glyph.textContent).toBe("B")
  })

  it("hides labels from sight when collapsed and shows them when expanded", () => {
    const collapsed = renderEntries()
    expect(screen.getByRole("link", { name: "Billing" }).className).toContain("[&>span:last-child]:sr-only")
    collapsed.unmount()
    renderEntries({ expanded: true })
    const link = screen.getByRole("link", { name: "Billing" })
    expect(link.className).toContain("[&>span:last-child]:truncate")
    expect(link.className).not.toContain("sr-only")
  })
})

describe("RailEntries sizing", () => {
  it("matches a SidebarMenuButton: 32px rows and a bare 16px icon", () => {
    renderEntries()
    const link = screen.getByRole("link", { name: "Billing" })
    expect(link.className).toContain("h-8")
    expect(link.className).toContain("w-8")
    expect(link.className).not.toContain("h-10")
    const glyph = link.querySelector('[data-slot="rail-glyph"]') as HTMLElement
    expect(glyph.className).toContain("size-4")
    expect(glyph.className).not.toContain("size-8")
  })
})
