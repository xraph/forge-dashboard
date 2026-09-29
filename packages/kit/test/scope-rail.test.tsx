import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ScopeRail } from "../src/components/scope-rail"
import type { ScopeOption } from "../src/components/scope-entries"

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

const home: ScopeOption = { id: "core-contract", label: "System", namespace: "core", href: "/overview" }
const scopes: ScopeOption[] = [{ id: "auth", label: "Auth", namespace: "auth", href: "/@auth" }]
const user = { name: "Ada Lovelace", email: "ada@example.com" }

function renderRail(expanded: boolean, onToggle = vi.fn()) {
  const view = render(
    <SidebarProvider>
      <ScopeRail
        home={home}
        scopes={scopes}
        activeScopeId="auth"
        renderLink={renderLink}
        expanded={expanded}
        onToggle={onToggle}
        user={user}
      />
    </SidebarProvider>,
  )
  return { ...view, onToggle }
}

const originalWidth = window.innerWidth

describe("ScopeRail", () => {
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalWidth, configurable: true })
  })

  it("is a navigation landmark named Scopes with the entries and the user menu", () => {
    renderRail(false)
    const rail = screen.getByRole("navigation", { name: "Scopes" })
    expect(within(rail).getByRole("link", { name: "System" })).toBeTruthy()
    expect(within(rail).getByRole("link", { name: "Auth" }).getAttribute("aria-current")).toBe("page")
    expect(within(rail).getByText("Ada Lovelace")).toBeTruthy()
  })

  it("exposes the collapsed state the way the sidebar does, so NavUser shrinks to its avatar", () => {
    renderRail(false)
    const rail = screen.getByRole("navigation", { name: "Scopes" })
    expect(rail.getAttribute("data-collapsible")).toBe("icon")
    expect(rail.getAttribute("data-state")).toBe("collapsed")
    expect(rail.className).toContain("w-(--sidebar-width-icon)")
  })

  it("widens when expanded", () => {
    renderRail(true)
    const rail = screen.getByRole("navigation", { name: "Scopes" })
    expect(rail.getAttribute("data-collapsible")).toBe("")
    expect(rail.getAttribute("data-state")).toBe("expanded")
    expect(rail.className).toContain("w-(--sidebar-width)")
  })

  it("has an edge toggle that reports its state and calls back", () => {
    const { onToggle } = renderRail(false)
    const toggle = screen.getByRole("button", { name: "Expand scopes" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("names the toggle for the other direction when expanded", () => {
    renderRail(true)
    expect(screen.getByRole("button", { name: "Collapse scopes" }).getAttribute("aria-expanded")).toBe("true")
  })

  it("renders nothing below the mobile breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true })
    renderRail(false)
    expect(screen.queryByRole("navigation", { name: "Scopes" })).toBeNull()
  })
})
