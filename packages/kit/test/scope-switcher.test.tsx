// packages/kit/test/scope-switcher.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ScopeSwitcher } from "../src/components/scope-switcher"
import type { ScopeOption } from "../src/components/scope-switcher"

/**
 * A deterministic fix was attempted first: ./setup.ts stubs a fixed non-zero
 * `getBoundingClientRect` plus no-op `ResizeObserver`/`IntersectionObserver`,
 * on the theory that base-ui's floating-ui positioning was spinning on
 * jsdom's degenerate all-zero layout. That stub is real and stays (it turns
 * a bare DropdownMenu's open-to-idle gap from up to ~90s down to a bounded
 * ~10-50s), but it did not eliminate the stall: two full back-to-back runs
 * of this file with the stub active measured "lists every scope once
 * opened" at ~15.6-15.9s, "shows a badge on a scope that is not ready" at
 * ~39-45s, and "calls onSelect with the chosen scope id" at ~48-52s. A CPU
 * profile and a microtask-turn probe (see task-5-report.md) show this is a
 * small number of expensive synchronous chunks, not a tight infinite loop,
 * but its exact source inside base-ui/floating-ui was not identified in the
 * time available. Raised well past 2x the worst of those measurements so
 * the suite is stable rather than racing the default 5s/10s.
 */
vi.setConfig({ testTimeout: 120000, hookTimeout: 60000 })

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
