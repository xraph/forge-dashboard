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
