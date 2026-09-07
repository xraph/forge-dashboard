import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { NavTree } from "../src/components/nav-tree"
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
    label: "@streaming",
    items: [
      { label: "Overview", href: "/@streaming" },
      {
        label: "Rooms",
        href: "/@streaming/rooms",
        children: [{ label: "Active", href: "/@streaming/rooms/active" }],
      },
    ],
  },
]

function renderTree(currentPath: string, search?: string) {
  return render(
    <SidebarProvider>
      <NavTree
        groups={groups}
        currentPath={currentPath}
        search={search}
        renderLink={(node, href) => <a href={href}>{node.label}</a>}
      />
    </SidebarProvider>,
  )
}

describe("NavTree", () => {
  it("renders the group label", () => {
    renderTree("/@streaming")
    expect(screen.getByText("@streaming")).toBeTruthy()
  })

  it("renders nested children", () => {
    renderTree("/@streaming")
    expect(screen.getByText("Active")).toBeTruthy()
  })

  it("marks the current item", () => {
    renderTree("/@streaming/rooms")
    expect(screen.getByText("Rooms").closest("a")!.getAttribute("href")).toBe(
      "/@streaming/rooms",
    )
    expect(screen.getByText("Rooms").closest("[data-active]")).toBeTruthy()
  })

  it("appends the search string to every href, children included", () => {
    renderTree("/@streaming", "?ctx.env=production")
    expect(screen.getByText("Rooms").closest("a")!.getAttribute("href")).toBe(
      "/@streaming/rooms?ctx.env=production",
    )
    expect(screen.getByText("Active").closest("a")!.getAttribute("href")).toBe(
      "/@streaming/rooms/active?ctx.env=production",
    )
  })

  it("renders no href suffix when there is no search string", () => {
    renderTree("/@streaming")
    expect(screen.getByText("Overview").closest("a")!.getAttribute("href")).toBe(
      "/@streaming",
    )
  })
})
