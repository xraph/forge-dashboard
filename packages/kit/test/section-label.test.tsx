import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Sidebar, SidebarProvider } from "../src/components/sidebar"
import { SectionLabel } from "../src/components/section-label"

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

function renderLabel() {
  return render(
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SectionLabel>Billing</SectionLabel>
      </Sidebar>
    </SidebarProvider>
  )
}

describe("SectionLabel", () => {
  it("is a button named for collapsing while the sidebar is open", () => {
    renderLabel()
    const label = screen.getByRole("button", { name: "Collapse Billing" })
    expect(label.getAttribute("aria-expanded")).toBe("true")
    expect(label.textContent).toBe("Billing")
  })

  it("toggles the sidebar and renames itself", () => {
    const { container } = renderLabel()
    fireEvent.click(screen.getByRole("button", { name: "Collapse Billing" }))
    const sidebar = container.querySelector(
      '[data-slot="sidebar"]'
    ) as HTMLElement
    expect(sidebar.getAttribute("data-collapsible")).toBe("icon")
    expect(
      screen
        .getByRole("button", { name: "Expand Billing" })
        .getAttribute("aria-expanded")
    ).toBe("false")
  })

  it("carries the vertical classes for icon mode", () => {
    renderLabel()
    const cls = screen.getByRole("button", {
      name: "Collapse Billing",
    }).className
    expect(cls).toContain(
      "group-data-[collapsible=icon]:[writing-mode:vertical-rl]"
    )
    expect(cls).toContain("group-data-[collapsible=icon]:rotate-180")
  })
})
