// packages/kit/test/dashboard-shell.test.tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { DashboardShell } from "../src/components/dashboard-shell"
import type { NavArea } from "../src/components/nav-tree"

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

const areas: NavArea[] = [
  {
    id: "auth",
    label: "Authsome",
    href: "/@auth/users",
    kind: "scope",
    groups: [
      { label: "Identity", items: [{ label: "Users", href: "/@auth/users" }] },
      { label: "System", items: [{ label: "Overview", href: "/@auth" }] },
    ],
  },
  {
    id: "subscription",
    label: "Billing",
    href: "/@auth/plans",
    kind: "plugin",
    groups: [
      {
        items: [
          { label: "Plans", href: "/@auth/plans" },
          { label: "Invoices", href: "/@auth/invoices" },
        ],
      },
    ],
  },
  {
    id: "apikey",
    label: "API Keys",
    href: "/@auth/apikeys",
    kind: "plugin",
    groups: [{ items: [{ label: "API Keys", href: "/@auth/apikeys" }] }],
  },
]

function renderShell(props: Partial<React.ComponentProps<typeof DashboardShell>> = {}) {
  return render(
    <DashboardShell
      title="Users"
      scope="Authsome"
      scopes={[{ id: "auth", label: "Authsome", namespace: "auth" }]}
      activeScopeId="auth"
      onScopeSelect={() => {}}
      context={<button type="button">Platform / Production</button>}
      searchControl={<button type="button">Search pages</button>}
      areas={areas}
      activeAreaId="auth"
      groups={[]}
      currentPath="/@auth/users"
      search="?env=staging"
      renderLink={renderLink}
      user={{ name: "Ada Lovelace", email: "ada@example.com" }}
      {...props}
    >
      <p>page body</p>
    </DashboardShell>,
  )
}

const rail = () => screen.getByRole("navigation", { name: "Scope navigation" })
const breadcrumb = () =>
  within(screen.getByRole("navigation", { name: "Breadcrumb" }))
    .getAllByText(/./)
    .map((node) => node.textContent)
const railLink = (name: string) => within(rail()).getByRole("link", { name })
const wrapperStyle = (c: HTMLElement) =>
  (c.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement).getAttribute("style") ?? ""
const originalWidth = window.innerWidth

describe("DashboardShell", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true })
  })

  it("lists the scope's pages and its plugins in the rail and puts a core page in a sidebar-less card", () => {
    const { container } = renderShell()
    expect(within(rail()).getAllByRole("link").map((a) => a.lastElementChild?.textContent)).toEqual([
      "Users",
      "Overview",
      "Billing",
      "API Keys",
    ])
    expect(railLink("Users").getAttribute("href")).toBe("/@auth/users?env=staging")
    expect(railLink("Users").getAttribute("aria-current")).toBe("page")
    expect(railLink("Overview").getAttribute("aria-current")).toBeNull()
    expect(container.querySelector('[data-slot="sidebar"]')).toBeNull()
    expect(breadcrumb()).toEqual(["Authsome", "Users"])
    expect(screen.queryByRole("button", { name: "Toggle Sidebar" })).toBeNull()
    const main = container.querySelector("#dashboard-main") as HTMLElement
    expect(main.className).toContain("@container/main")
    expect(within(main).getByText("page body")).toBeTruthy()
  })

  it("keeps a core page lit on its detail routes", () => {
    renderShell({ currentPath: "/@auth/users/usr_1" })
    expect(railLink("Users").getAttribute("aria-current")).toBe("page")
    expect(railLink("Overview").getAttribute("aria-current")).toBeNull()
  })

  it("opens the secondary sidebar for a plugin with more than one page", () => {
    const { container } = renderShell({ title: "Plans", activeAreaId: "subscription", currentPath: "/@auth/plans" })
    expect(railLink("Billing").getAttribute("aria-current")).toBe("page")
    expect(railLink("Users").getAttribute("aria-current")).toBeNull()
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement
    expect(sidebar).toBeTruthy()
    const content = container.querySelector('[data-slot="sidebar-content"]') as HTMLElement
    expect(within(content).getByRole("link", { name: "Plans" })).toBeTruthy()
    expect(within(content).getByRole("link", { name: "Invoices" })).toBeTruthy()
    expect(breadcrumb()).toEqual(["Billing", "Plans"])
    expect(sidebar.getAttribute("data-collapsible")).toBe("")
    fireEvent.click(
      within(container.querySelector("header") as HTMLElement).getByRole("button", { name: "Toggle Sidebar" }),
    )
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon")
  })

  it("keeps a single-page plugin in the rail with no secondary sidebar", () => {
    const { container } = renderShell({ title: "API Keys", activeAreaId: "apikey", currentPath: "/@auth/apikeys" })
    expect(railLink("API Keys").getAttribute("aria-current")).toBe("page")
    expect(container.querySelector('[data-slot="sidebar"]')).toBeNull()
    expect(breadcrumb()).toEqual(["API Keys"])
  })

  it("shows one crumb when the plugin and its page share a name", () => {
    renderShell({ title: "API Keys", activeAreaId: "apikey", currentPath: "/@auth/apikeys" })
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getAllByText("API Keys")
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0].getAttribute("aria-current")).toBe("page")
  })

  it("puts the switcher, context, search and account in the rail, once", () => {
    renderShell()
    expect(within(rail()).getByRole("button", { name: /Authsome/ })).toBeTruthy()
    expect(within(rail()).getByRole("button", { name: "Platform / Production" })).toBeTruthy()
    expect(within(rail()).getByRole("button", { name: "Search pages" })).toBeTruthy()
    expect(within(rail()).getByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Search pages" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Platform / Production" })).toHaveLength(1)
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(1)
  })

  it("follows the rail's width with --sidebar-offset when it widens", () => {
    const { container } = renderShell()
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width-icon)")
    fireEvent.click(within(rail()).getByRole("button", { name: "Expand navigation" }))
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width)")
    expect(window.localStorage.getItem("forge-dashboard.rail")).toBe("expanded")
  })

  it("keeps the rail and its chrome for a scope with no areas", () => {
    renderShell({ areas: [], empty: { message: "Pick an app to see its pages." } })
    expect(within(rail()).queryAllByRole("link")).toHaveLength(0)
    expect(within(rail()).getByRole("button", { name: "Search pages" })).toBeTruthy()
    expect(within(rail()).getByRole("button", { name: "Platform / Production" })).toBeTruthy()
    expect(within(rail()).getByText("Ada Lovelace")).toBeTruthy()
  })

  it("drops the rail on mobile and offers the sheet's toggle even on a core page", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    renderShell()
    expect(screen.queryByRole("navigation", { name: "Scope navigation" })).toBeNull()
    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toBeTruthy()
  })
})
