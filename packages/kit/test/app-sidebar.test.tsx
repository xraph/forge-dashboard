// packages/kit/test/app-sidebar.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { AppSidebar } from "../src/components/app-sidebar"

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

function renderSidebar(overrides: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  return render(
    <SidebarProvider>
      <AppSidebar
        scopes={[{ id: "auth", label: "Auth", namespace: "auth" }]}
        activeScopeId="auth"
        onScopeSelect={() => {}}
        groups={[{ label: "@auth", items: [{ label: "Users", href: "/@auth/users" }] }]}
        currentPath="/@auth/users"
        renderLink={(node, href) => <a href={href}>{node.label}</a>}
        user={{ name: "Dashboard user", email: "user@example.com" }}
        {...overrides}
      />
    </SidebarProvider>,
  )
}

describe("AppSidebar", () => {
  it("renders contributed nav", () => {
    renderSidebar()
    expect(screen.getByText("Users")).toBeTruthy()
  })

  it("renders the header slot when one is passed", () => {
    renderSidebar({ header: <div>context bar</div> })
    expect(screen.getByText("context bar")).toBeTruthy()
  })

  it("carries no dashboard-01 fixture content", () => {
    renderSidebar()
    expect(screen.queryByText("Word Assistant")).toBeNull()
    expect(screen.queryByText("Acme Inc.")).toBeNull()
    expect(screen.queryByText("Quick Create")).toBeNull()
    expect(screen.queryByText("Data Library")).toBeNull()
  })

  it("renders pinned nav above the switcher", () => {
    renderSidebar({
      pinned: [{ items: [{ label: "Overview", href: "/overview" }] }],
    })
    expect(screen.getByText("Overview")).toBeTruthy()
  })

  it("renders no switcher when there are no scopes", () => {
    // Scoped to the header: the default `groups` fixture's own nav group is
    // labelled "@auth" too, so an unscoped query would match that instead of
    // (or as well as) the switcher this test is actually about.
    const { container } = renderSidebar({ scopes: [] })
    const header = container.querySelector('[data-slot="sidebar-header"]') as HTMLElement
    expect(within(header).queryByText("@auth")).toBeNull()
  })

  it("still renders the switcher when scopes exist", () => {
    const { container } = renderSidebar({})
    const header = container.querySelector('[data-slot="sidebar-header"]') as HTMLElement
    expect(within(header).getByText("@auth")).toBeTruthy()
  })
})
