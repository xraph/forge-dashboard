// packages/kit/test/scope-switcher.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ScopeSwitcher } from "../src/components/scope-switcher"
import type { ScopeOption } from "../src/components/scope-switcher"

/**
 * Raised from the vitest defaults (5s test / 10s hook) because opening a
 * base-ui Menu under jsdom is measured to take anywhere from under a second
 * to ~90s wall-clock in this environment before its floating-ui positioning
 * settles: jsdom has no ResizeObserver/IntersectionObserver, and reproduced
 * with a bare DropdownMenu outside ScopeSwitcher entirely, so it is not
 * something this component's code controls. See task-5-report.md for the
 * measurements. This does not touch what any test asserts.
 */
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

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
})
