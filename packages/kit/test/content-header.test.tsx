import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ContentHeader } from "../src/components/content-header"

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

describe("ContentHeader", () => {
  it("renders the crumbs with the last one current", () => {
    render(
      <SidebarProvider>
        <ContentHeader crumbs={["Billing", "Plans"]} showTrigger />
      </SidebarProvider>
    )
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(within(nav).getByText("Billing")).toBeTruthy()
    expect(within(nav).getByText("Plans").getAttribute("aria-current")).toBe(
      "page"
    )
  })

  it("shows the sidebar toggle only when asked", () => {
    const { unmount } = render(
      <SidebarProvider>
        <ContentHeader crumbs={["Users"]} showTrigger />
      </SidebarProvider>
    )
    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toBeTruthy()
    unmount()
    render(
      <SidebarProvider>
        <ContentHeader crumbs={["Users"]} showTrigger={false} />
      </SidebarProvider>
    )
    expect(screen.queryByRole("button", { name: "Toggle Sidebar" })).toBeNull()
  })

  it("renders actions at the end", () => {
    render(
      <SidebarProvider>
        <ContentHeader
          crumbs={["Users"]}
          showTrigger={false}
          actions={<button type="button">Refresh</button>}
        />
      </SidebarProvider>
    )
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy()
  })
})
