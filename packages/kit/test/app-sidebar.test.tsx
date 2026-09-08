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

  it("renders the back row above the switcher", () => {
    const { container } = renderSidebar({
      back: { label: "Overview", href: "/overview" },
    })
    const header = container.querySelector('[data-slot="sidebar-header"]') as HTMLElement
    const back = within(header).getByRole("link", { name: "Overview" })
    const switcher = within(header).getByText("@auth")
    // Ordering is the point of this component's header, not an incidental
    // detail: the switcher is the sidebar's anchor and the way out of a scope
    // sits above it. DOCUMENT_POSITION_FOLLOWING means switcher comes after
    // back in document order.
    expect(
      back.compareDocumentPosition(switcher) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("renders no back row when there is nothing to go back to", () => {
    renderSidebar()
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull()
  })

  it("carries the search string forward on the back row", () => {
    // Every other link the sidebar draws preserves the query string, because
    // dropping it silently swaps the data under the person. The way out of a
    // scope is not exempt.
    renderSidebar({
      back: { label: "Overview", href: "/overview" },
      search: "?ctx.org=acme",
    })
    expect(
      screen.getByRole("link", { name: "Overview" }).getAttribute("href"),
    ).toBe("/overview?ctx.org=acme")
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
