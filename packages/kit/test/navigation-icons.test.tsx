import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { NavTree, type NavGroup } from "../src/components/nav-tree"
import { NavMain } from "../src/components/nav-main"
import { RailEntries } from "../src/components/rail-entries"
import { SidebarProvider } from "../src/components/sidebar"

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
    label: "Configuration",
    items: [
      {
        label: "Agents",
        href: "/@cortex/agents",
        children: [{ label: "Future plugin page", href: "/@custom/new-page" }],
      },
      { label: "Deployments", href: "/@ctrlplane/deployments" },
    ],
  },
]
const renderLink = (
  node: { label: string; icon?: ReactNode },
  href: string
) => (
  <a href={href}>
    {node.icon}
    <span>{node.label}</span>
  </a>
)

describe("shared navigation icons", () => {
  for (const [name, Navigation] of [
    ["flat", NavTree],
    ["nested", NavMain],
  ] as const) {
    it(`gives ${name} plugin menus icons while retaining accessible destinations`, () => {
      render(
        <SidebarProvider>
          <Navigation
            groups={groups}
            currentPath="/@custom/new-page"
            renderLink={renderLink}
          />
        </SidebarProvider>
      )
      for (const label of ["Deployments", "Future plugin page"]) {
        const link = screen.getByRole("link", { name: label })
        expect(link.querySelector("svg")).toBeTruthy()
        expect(link.textContent).toBe(label)
      }
    })
  }

  it("uses a neutral glyph for unknown rail entries without replacing their accessible name", () => {
    render(
      <SidebarProvider>
        <RailEntries
          items={[
            {
              id: "custom",
              label: "Custom destination",
              href: "/@custom/future",
            },
          ]}
          renderLink={renderLink}
        />
      </SidebarProvider>
    )
    const link = screen.getByRole("link", { name: "Custom destination" })
    const glyph = link.querySelector('[data-slot="rail-glyph"]')!
    expect(glyph.querySelector("svg")).toBeTruthy()
    expect(glyph.textContent).toBe("")
    expect(link.getAttribute("href")).toBe("/@custom/future")
  })
})
