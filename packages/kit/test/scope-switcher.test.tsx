// packages/kit/test/scope-switcher.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ScopeSwitcher } from "../src/components/scope-switcher"
import type { ScopeOption } from "../src/components/scope-switcher"

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

const scopes: ScopeOption[] = [
  { id: "core-contract", label: "System", namespace: "system" },
  { id: "auth", label: "Auth", namespace: "auth" },
  { id: "gateway-contract", label: "Gateway", namespace: "gateway", badge: "setup" },
]

function setup(activeId?: string) {
  const onSelect = vi.fn()
  render(
    <SidebarProvider>
      <ScopeSwitcher scopes={scopes} activeId={activeId} onSelect={onSelect} />
    </SidebarProvider>,
  )
  return onSelect
}

describe("ScopeSwitcher", () => {
  it("shows the active scope's label and namespace", () => {
    setup("auth")
    expect(screen.getByText("Auth")).toBeTruthy()
    expect(screen.getByText("@auth")).toBeTruthy()
  })

  it("falls back when nothing is active yet", () => {
    render(
      <SidebarProvider>
        <ScopeSwitcher scopes={[]} onSelect={() => {}} fallbackLabel="Dashboard" />
      </SidebarProvider>,
    )
    expect(screen.getByText("Dashboard")).toBeTruthy()
  })

  it("lists every scope once opened", () => {
    setup("auth")
    fireEvent.click(screen.getByRole("button", { name: /Auth/ }))
    expect(screen.getByText("System")).toBeTruthy()
    expect(screen.getByText("Gateway")).toBeTruthy()
  })

  it("shows a badge on a scope that is not ready", () => {
    setup("auth")
    fireEvent.click(screen.getByRole("button", { name: /Auth/ }))
    expect(screen.getByText("setup")).toBeTruthy()
  })

  it("calls onSelect with the chosen scope id", () => {
    const onSelect = setup("auth")
    fireEvent.click(screen.getByRole("button", { name: /Auth/ }))
    fireEvent.click(screen.getByText("System"))
    expect(onSelect).toHaveBeenCalledWith("core-contract")
  })

  it("marks the active scope inside the opened dropdown", () => {
    setup("auth")
    fireEvent.click(screen.getByRole("button", { name: /Auth/ }))

    // "Auth" appears twice: once in the trigger, once in the menu list. The
    // menu item is the one with a menuitem role.
    const activeItem = screen.getByRole("menuitem", { name: /Auth/ })
    const inactiveItem = screen.getByRole("menuitem", { name: /System/ })

    expect(activeItem.getAttribute("data-active")).not.toBeNull()
    expect(inactiveItem.getAttribute("data-active")).toBeNull()
  })
})

describe("ScopeSwitcher glyph", () => {
  // The tile is asserted through data-slot rather than its Tailwind classes.
  // A class assertion pins the palette and breaks on any restyle; the
  // structural claim ("the active scope's icon is wrapped in the tile") is
  // what the design actually requires and it survives a repaint.
  it("wraps the active scope's icon in a glyph tile", () => {
    const { container } = render(
      <SidebarProvider>
        <ScopeSwitcher
          scopes={[
            {
              id: "auth",
              label: "Auth",
              namespace: "auth",
              icon: <svg data-testid="auth-icon" />,
            },
          ]}
          activeId="auth"
          onSelect={() => {}}
        />
      </SidebarProvider>,
    )
    const glyph = container.querySelector('[data-slot="scope-glyph"]')
    expect(glyph).toBeTruthy()
    expect(glyph?.querySelector('[data-testid="auth-icon"]')).toBeTruthy()
  })

  it("renders no glyph tile for a scope that declares no icon", () => {
    // An empty accent-filled square is worse than no square: it reads as a
    // missing image rather than as a scope that simply has no icon.
    const { container } = render(
      <SidebarProvider>
        <ScopeSwitcher
          scopes={[{ id: "auth", label: "Auth", namespace: "auth" }]}
          activeId="auth"
          onSelect={() => {}}
        />
      </SidebarProvider>,
    )
    expect(container.querySelector('[data-slot="scope-glyph"]')).toBeNull()
  })

  it("gives every icon-bearing row in the dropdown its own tile", () => {
    // Only the active/inactive paint differs between rows, and paint is not
    // asserted here. What matters structurally is that a row's icon is tiled
    // the same way the trigger's is, so the list reads as the same object the
    // trigger names.
    const { container } = render(
      <SidebarProvider>
        <ScopeSwitcher
          scopes={[
            { id: "auth", label: "Auth", namespace: "auth", icon: <svg /> },
            { id: "streaming", label: "Streaming", namespace: "streaming", icon: <svg /> },
            { id: "bare", label: "Bare", namespace: "bare" },
          ]}
          activeId="auth"
          onSelect={() => {}}
        />
      </SidebarProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: /Auth/ }))

    // Three tiles: the trigger's, plus one for each of the two rows that
    // declared an icon. "Bare" contributes none.
    expect(container.ownerDocument.querySelectorAll('[data-slot="scope-glyph"]')).toHaveLength(3)
  })
})
