import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { NavRail } from "../src/components/nav-rail"
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
  { id: "auth", label: "Authsome", href: "/@auth/p/users" },
  { id: "apikey", label: "API Keys", href: "/@auth/p/apikeys" },
  { id: "subscription", label: "Billing", href: "/@auth/p/plans" },
]

function renderRail(props: Partial<React.ComponentProps<typeof NavRail>> = {}) {
  const onToggle = vi.fn()
  const view = render(
    <SidebarProvider>
      <NavRail
        switcher={<button type="button">Switch scope</button>}
        context={<button type="button">Platform / Production</button>}
        searchControl={<button type="button">Search pages</button>}
        account={<button type="button">Account menu</button>}
        items={items}
        activeId="subscription"
        renderLink={renderLink}
        search="?env=staging"
        expanded={false}
        onToggle={onToggle}
        {...props}
      />
    </SidebarProvider>,
  )
  return { ...view, onToggle }
}

const rail = () => screen.getByRole("navigation", { name: "Scope navigation" })
const originalWidth = window.innerWidth

describe("NavRail", () => {
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true })
  })

  it("puts switcher, context and search above the entries and the account at the foot", () => {
    renderRail()
    const order = within(rail())
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t && !/navigation/.test(t))
    expect(order).toEqual(["Switch scope", "Platform / Production", "Search pages", "Account menu"])
    const account = within(rail()).getByRole("button", { name: "Account menu" })
    const lastLink = within(rail()).getAllByRole("link").at(-1)!
    expect(lastLink.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("links every entry with the query string and marks the active one", () => {
    renderRail()
    const links = within(rail()).getAllByRole("link")
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/@auth/p/users?env=staging",
      "/@auth/p/apikeys?env=staging",
      "/@auth/p/plans?env=staging",
    ])
    expect(within(rail()).getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page")
  })

  it("heads the plugin entries with Plugins when wide, and not when narrow", () => {
    const narrow = renderRail()
    expect(within(rail()).queryByText("Plugins")).toBeNull()
    expect(rail().querySelector('[data-slot="rail-divider"]')).toBeTruthy()
    narrow.unmount()
    renderRail({ expanded: true })
    expect(within(rail()).getByText("Plugins")).toBeTruthy()
  })

  it("renders no heading or divider when the scope has no plugins", () => {
    renderRail({ items: items.slice(0, 1), expanded: true })
    expect(within(rail()).queryByText("Plugins")).toBeNull()
    expect(rail().querySelector('[data-slot="rail-divider"]')).toBeNull()
  })

  it("marks itself collapsed so SidebarMenuButton children shrink, and widens", () => {
    const narrow = renderRail()
    expect(rail().getAttribute("data-collapsible")).toBe("icon")
    expect(rail().className).toContain("w-(--sidebar-width-icon)")
    narrow.unmount()
    renderRail({ expanded: true })
    expect(rail().getAttribute("data-collapsible")).toBe("")
    expect(rail().className).toMatch(/(^|\s)w-\(--sidebar-width\)(\s|$)/)
  })

  it("has an edge toggle named for the way it moves", () => {
    const { onToggle } = renderRail()
    const toggle = within(rail()).getByRole("button", { name: "Expand navigation" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("renders nothing below the mobile breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    renderRail()
    expect(screen.queryByRole("navigation", { name: "Scope navigation" })).toBeNull()
  })
})
