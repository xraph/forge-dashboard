// packages/kit/test/app-sidebar.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { useEffect } from "react"
import { SidebarProvider, useSidebar } from "../src/components/sidebar"
import { AppSidebar, stackSections } from "../src/components/app-sidebar"
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
  {
    id: "Identity",
    label: "Identity",
    icon: null,
    href: "/@auth/users",
    groups: [{ items: [{ label: "Users", href: "/@auth/users" }] }],
  },
  {
    id: "Billing",
    label: "Billing",
    icon: null,
    href: "/@auth/plans",
    groups: [
      { items: [{ label: "Credits", href: "/@auth/credits" }] },
      { label: "Plans", contributed: true, items: [
        { label: "Plans", href: "/@auth/plans" },
        { label: "Invoices", href: "/@auth/invoices" },
      ] },
    ],
  },
]

function renderSidebar(overrides: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  return render(
    <SidebarProvider>
      <AppSidebar
        scopes={[{ id: "auth", label: "Auth", namespace: "auth" }]}
        activeScopeId="auth"
        onScopeSelect={() => {}}
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

  it("puts the scope switcher back in the header", () => {
    const { container } = renderSidebar()
    expect(within(header(container)).getByText("@auth")).toBeTruthy()
    expect(within(header(container)).getByRole("button", { name: /Auth/ })).toBeTruthy()
  })

  it("renders no switcher when there are no scopes and no home", () => {
    const { container } = renderSidebar({ scopes: [] })
    expect(within(header(container)).queryByRole("button")).toBeNull()
  })

  it("puts the user menu in the footer", () => {
    const { container } = renderSidebar()
    const footer = container.querySelector('[data-slot="sidebar-footer"]') as HTMLElement
    expect(within(footer).getByText("Dashboard user")).toBeTruthy()
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

  it("shows only the active section's groups on desktop, with sub-plugin headings", () => {
    const { container } = renderSidebar({ sections, activeSectionId: "Billing", currentPath: "/@auth/plans" })
    const c = content(container)
    expect(within(c).queryByRole("link", { name: "Users" })).toBeNull()
    expect(within(c).getByRole("link", { name: "Credits" })).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Invoices" })).toBeTruthy()
    expect(within(c).getAllByText("Plans").length).toBe(2)
  })

  it("falls back to the first section when the active id matches none", () => {
    const { container } = renderSidebar({ sections, activeSectionId: "Nope" })
    expect(within(content(container)).getByRole("link", { name: "Users" })).toBeTruthy()
  })

  it("ignores groups when sections are given", () => {
    const { container } = renderSidebar({
      sections,
      activeSectionId: "Identity",
      groups: [{ items: [{ label: "Stale", href: "/stale" }] }],
    })
    expect(within(content(container)).queryByRole("link", { name: "Stale" })).toBeNull()
  })

  it("stacks every section in the mobile sheet", async () => {
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
            scopes={[{ id: "auth", label: "Auth", namespace: "auth" }]}
            activeScopeId="auth"
            onScopeSelect={() => {}}
            groups={[]}
            sections={sections}
            activeSectionId="Billing"
            currentPath="/@auth/plans"
            renderLink={renderLink}
            user={{ name: "Dashboard user", email: "user@example.com" }}
          />
        </SidebarProvider>,
      )
      const sheet = await screen.findByRole("dialog")
      expect(within(sheet).getByRole("link", { name: "Users" })).toBeTruthy()
      expect(within(sheet).getByRole("link", { name: "Invoices" })).toBeTruthy()
      expect(within(sheet).getByText("Billing · Plans")).toBeTruthy()
    } finally {
      Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true })
    }
  })
})

describe("stackSections", () => {
  it("labels each section's first unlabelled group with the section, and prefixes headed groups", () => {
    expect(stackSections(sections).map((g) => g.label)).toEqual(["Identity", "Billing", "Billing · Plans"])
  })

  it("labels a section whose first group is headed through the prefix alone", () => {
    const onlyHeaded: NavSection[] = [
      { id: "Billing", label: "Billing", icon: null, href: "/p", groups: [{ label: "Plans", items: [{ label: "Plans", href: "/p" }] }] },
    ]
    expect(stackSections(onlyHeaded).map((g) => g.label)).toEqual(["Billing · Plans"])
  })
})
