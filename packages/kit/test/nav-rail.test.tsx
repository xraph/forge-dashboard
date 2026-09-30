import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { NavRail } from "../src/components/nav-rail"
import type { RailGroup } from "../src/components/nav-rail"
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

const users: RailItem = { id: "/@auth/users", label: "Users", href: "/@auth/users" }
const sessions: RailItem = { id: "/@auth/sessions", label: "Sessions", href: "/@auth/sessions" }
const overview: RailItem = { id: "/@auth", label: "Overview", href: "/@auth" }
const apikeys: RailItem = { id: "apikey", label: "API Keys", href: "/@auth/p/apikeys" }
const billing: RailItem = { id: "subscription", label: "Billing", href: "/@auth/p/plans" }

const groups: RailGroup[] = [
  { label: "Identity", items: [users, sessions] },
  { label: "System", items: [overview] },
]
const plugins: RailItem[] = [apikeys, billing]

function renderRail(props: Partial<React.ComponentProps<typeof NavRail>> = {}) {
  const onToggle = vi.fn()
  const view = render(
    <SidebarProvider>
      <NavRail
        switcher={<button type="button">Switch scope</button>}
        context={<button type="button">Platform / Production</button>}
        searchControl={<button type="button">Search pages</button>}
        account={<button type="button">Account menu</button>}
        groups={groups}
        plugins={plugins}
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
      "/@auth/users?env=staging",
      "/@auth/sessions?env=staging",
      "/@auth?env=staging",
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

  it("labels core groups when wide and separates them with a gap when narrow", () => {
    const wide = renderRail({ expanded: true })
    expect(within(rail()).getByText("Identity")).toBeTruthy()
    expect(within(rail()).getByText("System")).toBeTruthy()
    expect(rail().querySelector('[data-slot="rail-gap"]')).toBeNull()
    wide.unmount()
    renderRail()
    expect(within(rail()).queryByText("Identity")).toBeNull()
    expect(rail().querySelectorAll('[data-slot="rail-gap"]')).toHaveLength(1)
  })

  it("renders no heading or divider when the scope has no plugins", () => {
    renderRail({ plugins: [], expanded: true })
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

  it("makes the entry list its own containing block so sr-only labels cannot stretch the page", () => {
    renderRail()
    // jsdom cannot measure layout, so the class is the only thing a unit test can pin.
    const scroller = Array.from(rail().querySelectorAll("div")).find((el) => el.className.includes("overflow-y-auto"))
    expect(scroller).toBeTruthy()
    expect(scroller!.classList.contains("relative")).toBe(true)
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
