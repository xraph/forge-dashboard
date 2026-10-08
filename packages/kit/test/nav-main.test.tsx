import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { NavMain } from "../src/components/nav-main"
import type { NavGroup } from "../src/components/nav-tree"

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

const groups: NavGroup[] = [
  {
    label: "Platform",
    items: [
      {
        label: "Observe",
        href: "/metrics",
        children: [
          { label: "Metrics", href: "/metrics" },
          { label: "Traces", href: "/traces" },
        ],
      },
    ],
  },
]
const props = {
  groups,
  currentPath: "/traces",
  search: "?env=production",
  renderLink: (node: { label: string }, href: string) => (
    <a href={href}>{node.label}</a>
  ),
}

describe("NavMain", () => {
  it("opens the active branch and preserves context on nested links", () => {
    render(
      <SidebarProvider>
        <NavMain {...props} />
      </SidebarProvider>
    )
    expect(
      screen
        .getByRole("button", { name: "Observe" })
        .getAttribute("aria-expanded")
    ).toBe("true")
    expect(
      screen.getByRole("link", { name: "Traces" }).getAttribute("href")
    ).toBe("/traces?env=production")
    fireEvent.click(screen.getByRole("button", { name: "Observe" }))
    expect(
      screen
        .getByRole("button", { name: "Observe" })
        .getAttribute("aria-expanded")
    ).toBe("false")
  })

  it("keeps nested destinations reachable from the icon rail", () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <NavMain {...props} />
      </SidebarProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Observe" }))
    expect(
      screen.getByRole("menuitem", { name: "Traces" }).getAttribute("href")
    ).toBe("/traces?env=production")
  })

  it("reveals a newly active branch after external navigation", () => {
    const view = render(
      <SidebarProvider>
        <NavMain {...props} currentPath="/elsewhere" />
      </SidebarProvider>
    )
    expect(
      screen
        .getByRole("button", { name: "Observe" })
        .getAttribute("aria-expanded")
    ).toBe("false")
    view.rerender(
      <SidebarProvider>
        <NavMain {...props} />
      </SidebarProvider>
    )
    expect(
      screen
        .getByRole("button", { name: "Observe" })
        .getAttribute("aria-expanded")
    ).toBe("true")
  })
})

it("keeps a branch's own destination reachable when it differs from its children", () => {
  render(
    <SidebarProvider>
      <NavMain
        {...props}
        groups={[
          {
            label: "Manage",
            items: [
              {
                label: "Settings",
                href: "/settings",
                children: [{ label: "Team", href: "/settings/team" }],
              },
            ],
          },
        ]}
        currentPath="/settings/team"
      />
    </SidebarProvider>
  )
  expect(
    screen.getByRole("link", { name: "Settings" }).getAttribute("href")
  ).toBe("/settings?env=production")
  expect(screen.getByRole("link", { name: "Team" }).getAttribute("href")).toBe(
    "/settings/team?env=production"
  )
})

it("keeps the closest section active on a detail route", () => {
  render(
    <SidebarProvider>
      <NavMain
        {...props}
        currentPath="/@auth/app/users/u1"
        groups={[
          {
            label: "Identity",
            items: [
              { label: "Overview", href: "/@auth/app" },
              { label: "Users", href: "/@auth/app/users" },
            ],
          },
        ]}
      />
    </SidebarProvider>
  )
  expect(
    screen.getByRole("link", { name: "Users" }).hasAttribute("data-active")
  ).toBe(true)
  expect(
    screen.getByRole("link", { name: "Overview" }).hasAttribute("data-active")
  ).toBe(false)
})
