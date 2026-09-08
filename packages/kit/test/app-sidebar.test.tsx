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
    // Asserting on "@auth" text here would pass even if the `scopes.length >
    // 0` gate were deleted: `ScopeSwitcher` only renders that text once it
    // finds an active scope (scope-switcher.tsx's `active` lookup), and with
    // `scopes: []` there is never an active scope to find regardless of the
    // gate. The switcher's `SidebarMenuButton` trigger, by contrast, renders
    // unconditionally whenever `ScopeSwitcher` mounts at all, so its absence
    // is what actually proves the gate is doing something. With no `pinned`
    // and no `header` slot passed, the header renders nothing else, so a
    // plain button query is unambiguous here.
    const { container } = renderSidebar({ scopes: [] })
    const header = container.querySelector('[data-slot="sidebar-header"]') as HTMLElement
    expect(within(header).queryByRole("button")).toBeNull()
  })

  it("still renders the switcher when scopes exist", () => {
    const { container } = renderSidebar({})
    const header = container.querySelector('[data-slot="sidebar-header"]') as HTMLElement
    expect(within(header).getByText("@auth")).toBeTruthy()
  })
})
