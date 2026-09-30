// packages/kit/test/dashboard-shell.test.tsx
import { beforeEach, describe, expect, it } from "vitest"
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
  { id: "auth", label: "Authsome", href: "/@auth/users", kind: "scope", groups: [{ items: [{ label: "Users", href: "/@auth/users" }] }] },
  { id: "subscription", label: "Billing", href: "/@auth/plans", kind: "plugin", groups: [{ items: [{ label: "Plans", href: "/@auth/plans" }] }] },
]

function renderShell(props: Partial<React.ComponentProps<typeof DashboardShell>> = {}) {
  return render(
    <DashboardShell
      title="Plans"
      scope="Authsome"
      scopes={[{ id: "auth", label: "Authsome", namespace: "auth" }]}
      activeScopeId="auth"
      onScopeSelect={() => {}}
      context={<button type="button">Platform / Production</button>}
      searchControl={<button type="button">Search pages</button>}
      areas={areas}
      activeAreaId="subscription"
      groups={[]}
      currentPath="/@auth/plans"
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
const wrapperStyle = (c: HTMLElement) =>
  (c.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement).getAttribute("style") ?? ""

describe("DashboardShell", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("puts the switcher, context, search, entries and account in the rail, once", () => {
    renderShell()
    expect(within(rail()).getByRole("button", { name: /Authsome/ })).toBeTruthy()
    expect(within(rail()).getByRole("button", { name: "Platform / Production" })).toBeTruthy()
    expect(within(rail()).getByRole("button", { name: "Search pages" })).toBeTruthy()
    expect(within(rail()).getByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Search pages" })).toHaveLength(1)
    expect(within(rail()).getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/@auth/plans?env=staging")
    expect(within(rail()).getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page")
  })

  it("shows the active area's pages in the secondary sidebar and the page in main", () => {
    const { container } = renderShell()
    const content = container.querySelector('[data-slot="sidebar-content"]') as HTMLElement
    expect(within(content).getByRole("link", { name: "Plans" })).toBeTruthy()
    expect(within(content).queryByRole("link", { name: "Users" })).toBeNull()
    const main = container.querySelector("#dashboard-main") as HTMLElement
    expect(main.className).toContain("@container/main")
    expect(within(main).getByText("page body")).toBeTruthy()
  })

  it("offsets the secondary sidebar by the rail and follows it when it widens", () => {
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
    expect(screen.getByText("Pick an app to see its pages.")).toBeTruthy()
  })

  it("keeps the secondary sidebar icon-collapsible", () => {
    const { container } = renderShell()
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement
    expect(sidebar.getAttribute("data-collapsible")).toBe("")
    fireEvent.click(within(container.querySelector("header") as HTMLElement).getByRole("button", { name: "Toggle Sidebar" }))
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon")
  })
})
