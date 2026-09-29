import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { DashboardShell } from "../src/components/dashboard-shell"

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

function renderShell() {
  return render(
    <DashboardShell
      title="Users"
      scope="Auth"
      scopes={[{ id: "auth", label: "Auth", namespace: "auth", href: "/@auth" }]}
      home={{ id: "core-contract", label: "System", namespace: "core", href: "/overview" }}
      activeScopeId="auth"
      heading={{ label: "Auth", namespace: "auth" }}
      groups={[{ label: "Identity", items: [{ label: "Users", href: "/@auth/users" }] }]}
      currentPath="/@auth/users"
      renderLink={renderLink}
      user={{ name: "Dashboard user", email: "user@example.com" }}
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

  it("arranges rail, pane and content", () => {
    const { container } = renderShell()
    expect(screen.getByRole("navigation", { name: "Scopes" })).toBeTruthy()
    expect(container.querySelector('[data-slot="sidebar-content"]')).toBeTruthy()
    const main = container.querySelector("#dashboard-main") as HTMLElement
    expect(main.className).toContain("@container/main")
    expect(within(main).getByText("page body")).toBeTruthy()
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Users")).toBeTruthy()
  })

  it("offsets the pane by the rail's width, and follows the rail when it widens", () => {
    const { container } = renderShell()
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width-icon)")
    fireEvent.click(screen.getByRole("button", { name: "Expand scopes" }))
    expect(wrapperStyle(container)).toContain("--sidebar-offset: var(--sidebar-width)")
    expect(window.localStorage.getItem("forge-dashboard.rail")).toBe("expanded")
  })

  it("runs the pane as an icon-collapsible sidebar", () => {
    const { container } = renderShell()
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement
    expect(sidebar.getAttribute("data-variant")).toBe("sidebar")
    const header = container.querySelector("header") as HTMLElement
    fireEvent.click(within(header).getByRole("button", { name: "Toggle Sidebar" }))
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon")
  })
})
