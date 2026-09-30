// packages/kit/test/app-sidebar.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { useEffect } from "react"
import { SidebarProvider, useSidebar } from "../src/components/sidebar"
import { AppSidebar, stackAreas } from "../src/components/app-sidebar"
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
      { label: "Catalog", items: [{ label: "Plans", href: "/@auth/plans" }] },
      { label: "Revenue", items: [{ label: "Invoices", href: "/@auth/invoices" }] },
    ],
  },
]

function renderSidebar(overrides: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  return render(
    <SidebarProvider>
      <AppSidebar
        collapsible="icon"
        navigationLayout="collapsible"
        areas={areas}
        activeAreaId="subscription"
        groups={[]}
        currentPath="/@auth/plans"
        renderLink={renderLink}
        {...overrides}
      />
    </SidebarProvider>,
  )
}

const header = (c: HTMLElement) => c.querySelector('[data-slot="sidebar-header"]') as HTMLElement
const content = (c: HTMLElement) => c.querySelector('[data-slot="sidebar-content"]') as HTMLElement

describe("AppSidebar", () => {
  it("names the active area and shows only its pages, under section labels", () => {
    const { container } = renderSidebar()
    expect(within(header(container)).getByText("Billing")).toBeTruthy()
    const c = content(container)
    expect(within(c).getByRole("button", { name: "Collapse Catalog" })).toBeTruthy()
    expect(within(c).getByRole("button", { name: "Collapse Revenue" })).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Plans" })).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Invoices" })).toBeTruthy()
    expect(within(c).queryByRole("link", { name: "Users" })).toBeNull()
  })

  it("falls back to the first area when the active id matches none", () => {
    const { container } = renderSidebar({ activeAreaId: "nope" })
    expect(within(content(container)).getByRole("link", { name: "Users" })).toBeTruthy()
  })

  it("renders plain groups when there are no areas", () => {
    const { container } = renderSidebar({
      areas: undefined,
      groups: [{ label: "Authorization", items: [{ label: "Roles", href: "/@warden/roles" }] }],
      currentPath: "/@warden/roles",
    })
    const c = content(container)
    expect(within(c).getByRole("button", { name: "Collapse Authorization" })).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Roles" })).toBeTruthy()
    expect(header(container).textContent).toBe("")
  })

  it("renders no label for an unlabelled group", () => {
    const { container } = renderSidebar({
      areas: undefined,
      groups: [{ items: [{ label: "Rooms", href: "/@streaming/rooms" }] }],
      currentPath: "/@streaming/rooms",
    })
    expect(within(content(container)).queryByRole("button")).toBeNull()
  })

  it("renders the empty notice with a link that keeps the query string", () => {
    const { container } = renderSidebar({
      areas: [],
      search: "?env=staging",
      empty: { message: "This extension needs configuring.", href: "/@auth", label: "Open setup" },
    })
    const c = content(container)
    expect(within(c).getByText("This extension needs configuring.")).toBeTruthy()
    expect(within(c).getByRole("link", { name: "Open setup" }).getAttribute("href")).toBe("/@auth?env=staging")
  })

  it("keeps mobile chrome out of the desktop sidebar", () => {
    renderSidebar({
      mobileHeader: <button type="button">Switch scope</button>,
      mobileFooter: <button type="button">Account menu</button>,
    })
    expect(screen.queryByRole("button", { name: "Switch scope" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull()
  })

  it("stacks every area in the mobile sheet with its chrome", async () => {
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
            navigationLayout="collapsible"
            areas={areas}
            activeAreaId="subscription"
            groups={[]}
            currentPath="/@auth/plans"
            renderLink={renderLink}
            mobileHeader={<button type="button">Switch scope</button>}
            mobileFooter={<button type="button">Account menu</button>}
          />
        </SidebarProvider>,
      )
      const sheet = await screen.findByRole("dialog")
      expect(within(sheet).getByRole("button", { name: "Switch scope" })).toBeTruthy()
      expect(within(sheet).getByRole("button", { name: "Account menu" })).toBeTruthy()
      expect(within(sheet).getByRole("link", { name: "Users" })).toBeTruthy()
      expect(within(sheet).getByRole("link", { name: "Invoices" })).toBeTruthy()
      expect(within(sheet).getByRole("button", { name: "Collapse Billing · Catalog" })).toBeTruthy()
    } finally {
      Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true })
    }
  })
})

describe("stackAreas", () => {
  it("prefixes every labelled group with its area, and labels an area's unlabelled first group with the area", () => {
    const withLoose: NavArea[] = [
      { id: "x", label: "Streaming", href: "/r", kind: "scope", groups: [{ items: [{ label: "Rooms", href: "/r" }] }] },
      ...areas,
    ]
    expect(stackAreas(withLoose).map((g) => g.label)).toEqual([
      "Streaming",
      "Authsome · Identity",
      "Authsome · System",
      "Billing · Catalog",
      "Billing · Revenue",
    ])
  })
})
