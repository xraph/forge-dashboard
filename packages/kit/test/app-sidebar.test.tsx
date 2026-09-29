// packages/kit/test/app-sidebar.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { useEffect } from "react"
import { SidebarProvider, useSidebar } from "../src/components/sidebar"
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

const renderLink = (node: { label: string; href: string; icon?: React.ReactNode }, href: string) => (
  <a href={href}>
    {node.icon}
    <span>{node.label}</span>
  </a>
)

function renderSidebar(overrides: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  return render(
    <SidebarProvider>
      <AppSidebar
        scopes={[{ id: "auth", label: "Auth", namespace: "auth", href: "/@auth" }]}
        home={{ id: "core-contract", label: "System", namespace: "core", href: "/overview" }}
        activeScopeId="auth"
        heading={{ label: "Auth", namespace: "auth" }}
        groups={[{ label: "Identity", items: [{ label: "Users", href: "/@auth/users" }] }]}
        currentPath="/@auth/users"
        renderLink={renderLink}
        user={{ name: "Dashboard user", email: "user@example.com" }}
        {...overrides}
      />
    </SidebarProvider>,
  )
}

const header = (c: HTMLElement) => c.querySelector('[data-slot="sidebar-header"]') as HTMLElement
const content = (c: HTMLElement) => c.querySelector('[data-slot="sidebar-content"]') as HTMLElement

describe("AppSidebar", () => {
  it("renders contributed nav", () => {
    renderSidebar()
    expect(screen.getByRole("link", { name: "Users" })).toBeTruthy()
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

  it("names the active scope in a heading that is not a control", () => {
    const { container } = renderSidebar()
    const h = header(container)
    const heading = h.querySelector('[data-slot="scope-heading"]') as HTMLElement
    expect(within(heading).getByText("Auth")).toBeTruthy()
    expect(within(heading).getByText("@auth")).toBeTruthy()
    expect(within(h).queryByRole("button")).toBeNull()
    expect(within(h).queryByRole("link")).toBeNull()
  })

  it("renders no heading and no namespace line when none is given", () => {
    const { container } = renderSidebar({ heading: undefined })
    expect(header(container).querySelector('[data-slot="scope-heading"]')).toBeNull()
    const withoutNamespace = renderSidebar({ heading: { label: "System" } })
    expect(within(header(withoutNamespace.container)).queryByText(/^@/)).toBeNull()
  })

  it("renders the empty notice with a link that carries the search string", () => {
    const { container } = renderSidebar({
      groups: [],
      search: "?env=staging",
      empty: { message: "This extension needs configuring.", href: "/@auth", label: "Open setup" },
    })
    const c = content(container)
    expect(within(c).getByText("This extension needs configuring.")).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Open setup" }).getAttribute("href")).toBe("/@auth?env=staging")
  })

  it("renders a message-only empty notice without a link", () => {
    const { container } = renderSidebar({ groups: [], empty: { message: "Pick an app to see its pages." } })
    const c = content(container)
    expect(within(c).getByText("Pick an app to see its pages.")).toBeTruthy()
    expect(within(c).queryByRole("link")).toBeNull()
  })

  it("keeps scope rows and the user menu out of the desktop pane", () => {
    const { container } = renderSidebar()
    expect(container.querySelector('[data-slot="scope-rows"]')).toBeNull()
    expect(container.querySelector('[data-slot="sidebar-footer"]')).toBeNull()
    expect(screen.queryByText("Dashboard user")).toBeNull()
  })

  it("lists the scopes and the user menu in the mobile sheet", async () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    try {
      function OpenSheet() {
        const { setOpenMobile } = useSidebar()
        useEffect(() => setOpenMobile(true), [setOpenMobile])
        return null
      }
      render(
        <SidebarProvider>
          <OpenSheet />
          <AppSidebar
            scopes={[{ id: "auth", label: "Auth", namespace: "auth", href: "/@auth" }]}
            home={{ id: "core-contract", label: "System", namespace: "core", href: "/overview" }}
            activeScopeId="auth"
            heading={{ label: "Auth", namespace: "auth" }}
            groups={[{ label: "Identity", items: [{ label: "Users", href: "/@auth/users" }] }]}
            currentPath="/@auth/users"
            renderLink={renderLink}
            user={{ name: "Dashboard user", email: "user@example.com" }}
          />
        </SidebarProvider>,
      )
      const rows = (await screen.findByRole("dialog")).querySelector('[data-slot="scope-rows"]') as HTMLElement
      expect(within(rows).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/overview", "/@auth"])
      expect(screen.getAllByText("Dashboard user").length).toBeGreaterThan(0)
    } finally {
      Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true })
    }
  })
})
