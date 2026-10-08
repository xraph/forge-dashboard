import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import type { CSSProperties } from "react"
import { Sidebar, SidebarProvider } from "../src/components/sidebar"

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

describe("Sidebar offset", () => {
  it("defaults the offset to zero so a bare provider keeps the sidebar at the left edge", () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar>body</Sidebar>
      </SidebarProvider>
    )
    const wrapper = container.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement
    expect(wrapper.getAttribute("style")).toContain("--sidebar-offset: 0px")
    const sidebar = container.querySelector(
      '[data-slot="sidebar-container"]'
    ) as HTMLElement
    expect(sidebar.className).toContain(
      "data-[side=left]:left-(--sidebar-offset)"
    )
    expect(sidebar.className).toContain(
      "data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-offset)-var(--sidebar-width))]"
    )
    expect(sidebar.className).not.toContain("data-[side=left]:left-0 ")
  })

  it("takes an offset from the provider's style", () => {
    const { container } = render(
      <SidebarProvider style={{ "--sidebar-offset": "3rem" } as CSSProperties}>
        <Sidebar>body</Sidebar>
      </SidebarProvider>
    )
    const wrapper = container.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement
    expect(wrapper.getAttribute("style")).toContain("--sidebar-offset: 3rem")
  })
})
