import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ScopeEntries, scopeDescription } from "../src/components/scope-entries"
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

// The same shape the host's renderLink produces: icon first, label in a span.
const renderLink = (node: { label: string; href: string; icon?: React.ReactNode }, href: string) => (
  <a href={href}>
    {node.icon}
    <span>{node.label}</span>
  </a>
)

const home: ScopeOption = { id: "core-contract", label: "System", namespace: "core", href: "/overview" }
const scopes: ScopeOption[] = [
  { id: "auth", label: "Auth", namespace: "auth", href: "/@auth" },
  { id: "gateway-contract", label: "Gateway", namespace: "gateway", href: "/@gateway/first", badge: "setup" },
]

describe("scopeDescription", () => {
  it("names the state after the label", () => {
    expect(scopeDescription({ label: "Auth" })).toBe("Auth")
    expect(scopeDescription({ label: "Gateway", badge: "setup" })).toBe("Gateway (needs setup)")
    expect(scopeDescription({ label: "Gateway", badge: "mismatch" })).toBe("Gateway (version mismatch)")
  })
})

describe("ScopeEntries rail", () => {
  function renderRail(activeScopeId?: string, expanded = false) {
    return render(
      <SidebarProvider>
        <ScopeEntries
          presentation="rail"
          home={home}
          scopes={scopes}
          activeScopeId={activeScopeId}
          renderLink={renderLink}
          expanded={expanded}
        />
      </SidebarProvider>,
    )
  }

  it("renders home first, then every scope, each as a link to its href", () => {
    renderRail("auth")
    const links = screen.getAllByRole("link")
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/overview", "/@auth", "/@gateway/first"])
  })

  it("marks the active scope and nothing else", () => {
    renderRail("auth")
    const active = screen.getByRole("link", { name: "Auth" })
    expect(active.getAttribute("aria-current")).toBe("page")
    expect(active.hasAttribute("data-active")).toBe(true)
    expect(screen.getByRole("link", { name: "System" }).hasAttribute("data-active")).toBe(false)
    expect(screen.getByRole("link", { name: "System" }).getAttribute("aria-current")).toBeNull()
  })

  it("marks home when no scope is active", () => {
    renderRail(undefined)
    expect(screen.getByRole("link", { name: "System" }).getAttribute("aria-current")).toBe("page")
  })

  it("puts the state in the accessible name and a dot on the glyph", () => {
    renderRail("auth")
    const gateway = screen.getByRole("link", { name: "Gateway (needs setup)" })
    const dot = gateway.querySelector('[data-slot="scope-badge"]') as HTMLElement
    expect(dot.getAttribute("data-badge")).toBe("setup")
    expect(screen.getByRole("link", { name: "Auth" }).querySelector('[data-slot="scope-badge"]')).toBeNull()
  })

  it("draws an initial when a scope has no icon, by code point", () => {
    render(
      <SidebarProvider>
        <ScopeEntries
          presentation="rail"
          scopes={[{ id: "x", label: "🚀 Rockets", namespace: "x", href: "/@x" }]}
          renderLink={renderLink}
        />
      </SidebarProvider>,
    )
    const glyph = screen.getByRole("link").querySelector('[data-slot="scope-glyph"]') as HTMLElement
    expect(glyph.textContent).toBe("🚀")
  })

  it("hides labels from sight when collapsed and shows them when expanded", () => {
    const collapsed = renderRail("auth")
    expect(screen.getByRole("link", { name: "Auth" }).className).toContain("[&>span:last-child]:sr-only")
    collapsed.unmount()
    renderRail("auth", true)
    expect(screen.getByRole("link", { name: "Auth" }).className).toContain("[&>span:last-child]:truncate")
    expect(screen.getByRole("link", { name: "Auth" }).className).not.toContain("sr-only")
  })
})

describe("ScopeEntries rows", () => {
  it("renders the same entries as sidebar menu rows", () => {
    const { container } = render(
      <SidebarProvider>
        <ScopeEntries presentation="rows" home={home} scopes={scopes} activeScopeId="gateway-contract" renderLink={renderLink} />
      </SidebarProvider>,
    )
    const menu = container.querySelector('[data-slot="scope-rows"]') as HTMLElement
    expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "SSystem",
      "AAuth",
      "GGateway (needs setup)",
    ])
    expect(within(menu).getByRole("link", { name: "Gateway (needs setup)" }).hasAttribute("data-active")).toBe(true)
    expect(within(menu).getByRole("link", { name: "Gateway (needs setup)" }).getAttribute("aria-current")).toBe("page")
    expect(within(menu).getByRole("link", { name: "Auth" }).getAttribute("aria-current")).toBeNull()
  })
})
