// packages/kit/test/site-header.test.tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { SiteHeader } from "../src/components/site-header"

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

function renderHeader(title?: string) {
  return render(
    <SidebarProvider>
      <SiteHeader title={title} />
    </SidebarProvider>,
  )
}

describe("SiteHeader", () => {
  it("renders no title, and no heading at all, when none is passed", () => {
    renderHeader()
    expect(screen.queryByRole("heading")).toBeNull()
  })

  it("renders the title it is given", () => {
    renderHeader("Rooms")
    expect(screen.getByRole("heading", { name: "Rooms" })).toBeTruthy()
  })
})
