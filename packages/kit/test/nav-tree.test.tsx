import { describe, expect, it, vi } from "vitest"
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
        children: [
          {
            label: "Active",
            href: "/@streaming/rooms/active",
            icon: <span data-testid="active-icon" />,
          },
        ],
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
        renderLink={(_node, href) => <a href={href} />}
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

  it("renders a child's icon", () => {
    renderTree("/@streaming")
    expect(screen.getByTestId("active-icon")).toBeTruthy()
  })

  it("renders no href suffix when there is no search string", () => {
    renderTree("/@streaming")
    expect(screen.getByText("Overview").closest("a")!.getAttribute("href")).toBe(
      "/@streaming",
    )
  })
})

// A single plugin may reasonably declare two labels for one destination, and
// nothing in definePlugin rejects it. Both entries then map through
// scopePath() to the same href, so keying a row on its href alone hands React
// two siblings with one key.
const duplicateGroups: NavGroup[] = [
  {
    label: "@streaming",
    items: [
      { label: "Overview", href: "/@streaming" },
      { label: "Rooms", href: "/@streaming/rooms" },
      { label: "Live rooms", href: "/@streaming/rooms" },
      {
        label: "Archive",
        href: "/@streaming/archive",
        children: [
          { label: "Recent", href: "/@streaming/archive/all" },
          { label: "Everything", href: "/@streaming/archive/all" },
        ],
      },
    ],
  },
]

function renderDuplicates(currentPath: string) {
  const messages: string[] = []
  const spy = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      messages.push(args.map(String).join(" "))
    })
  try {
    render(
      <SidebarProvider>
        <NavTree
          groups={duplicateGroups}
          currentPath={currentPath}
          renderLink={(_node, href) => <a href={href} />}
        />
      </SidebarProvider>,
    )
  } finally {
    spy.mockRestore()
  }
  return messages.join("\n")
}

describe("NavTree with two items sharing an href", () => {
  it("logs no duplicate-key warning for sibling items", () => {
    expect(renderDuplicates("/@streaming")).not.toContain("the same key")
  })

  it("logs no duplicate-key warning for sibling children", () => {
    expect(renderDuplicates("/@streaming/archive")).not.toContain(
      "the same key",
    )
  })

  it("renders both items that share an href", () => {
    renderDuplicates("/@streaming")
    expect(screen.getByText("Rooms")).toBeTruthy()
    expect(screen.getByText("Live rooms")).toBeTruthy()
  })

  it("marks only the item matching currentPath, not its href twin", () => {
    renderDuplicates("/@streaming")
    expect(screen.getByText("Overview").closest("[data-active]")).toBeTruthy()
    expect(screen.getByText("Rooms").closest("[data-active]")).toBeNull()
    expect(screen.getByText("Live rooms").closest("[data-active]")).toBeNull()
  })
})
