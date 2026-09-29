// packages/kit/test/dashboard-shell.test.tsx
import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { DashboardShell } from "../src/components/dashboard-shell"
import type { NavSection } from "../src/components/nav-tree"

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

const sections: NavSection[] = [
  { id: "Identity", label: "Identity", icon: null, href: "/@auth/users", groups: [{ items: [{ label: "Users", href: "/@auth/users" }] }] },
  { id: "Billing", label: "Billing", icon: null, href: "/@auth/plans", groups: [{ items: [{ label: "Plans", href: "/@auth/plans" }] }] },
]

function renderShell(props: Partial<React.ComponentProps<typeof DashboardShell>> = {}) {
  return render(
    <DashboardShell
      title="Users"
      scope="Auth"
      scopes={[{ id: "auth", label: "Auth", namespace: "auth" }]}
      activeScopeId="auth"
      onScopeSelect={() => {}}
      groups={[{ items: [{ label: "Users", href: "/@auth/users" }] }]}
      currentPath="/@auth/users"
      renderLink={renderLink}
      user={{ name: "Dashboard user", email: "user@example.com" }}
      {...props}
    >
      <p>page body</p>
    </DashboardShell>,
  )
}

const wrapperStyle = (c: HTMLElement) =>
  (c.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement).getAttribute("style") ?? ""

describe("DashboardShell", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("renders pane and content, and no rail, without sections", () => {
    const { container } = renderShell()
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull()
    expect(wrapperStyle(container)).toContain("--sidebar-offset: 0px")
    const main = container.querySelector("#dashboard-main") as HTMLElement
    expect(main.className).toContain("@container/main")
    expect(within(main).getByText("page body")).toBeTruthy()
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Users")).toBeTruthy()
  })

  it("renders the section rail with sections and offsets the pane by its width", () => {
    const { container } = renderShell({ sections, activeSectionId: "Billing", search: "?env=staging" })
    const rail = screen.getByRole("navigation", { name: "Sections" })
    expect(within(rail).getByRole("link", { name: "Billing" }).getAttribute("href")).toBe("/@auth/plans?env=staging")
    expect(within(rail).getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page")
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width-icon)")
    fireEvent.click(screen.getByRole("button", { name: "Expand sections" }))
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width)")
    expect(window.localStorage.getItem("forge-dashboard.rail")).toBe("expanded")
  })

  it("renders no rail for an empty sections list", () => {
    const { container } = renderShell({ sections: [] })
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull()
    expect(wrapperStyle(container)).toContain("--sidebar-offset: 0px")
  })

  it("keeps the pane icon-collapsible, whatever the caller passes", () => {
    const { container } = renderShell({ collapsible: "offcanvas" })
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement
    expect(sidebar.getAttribute("data-variant")).toBe("sidebar")
    expect(sidebar.getAttribute("data-collapsible")).toBe("")
    const siteHeader = container.querySelector("header") as HTMLElement
    fireEvent.click(within(siteHeader).getByRole("button", { name: "Toggle Sidebar" }))
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon")
  })
})
