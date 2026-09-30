import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { ScopeGridSwitcher } from "../src/components/scope-grid-switcher"

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

const scopes = [
  { id: "auth", label: "Authsome", namespace: "auth", icon: <svg data-testid="auth-icon" /> },
  { id: "warden", label: "Warden", namespace: "warden" },
  { id: "vault", label: "Vault", namespace: "vault", badge: "setup" },
]

function open(activeId = "auth") {
  const onSelect = vi.fn()
  const onHome = vi.fn()
  render(
    <SidebarProvider>
      <ScopeGridSwitcher
        scopes={scopes}
        activeId={activeId}
        onSelect={onSelect}
        home={{ label: "Forge", onSelect: onHome }}
      />
    </SidebarProvider>,
  )
  fireEvent.click(screen.getByRole("button", { name: /Authsome/ }))
  return { onSelect, onHome }
}

describe("ScopeGridSwitcher", () => {
  it("lays the scopes out three to a row, with home above them", async () => {
    open()
    const grid = (await screen.findByRole("menu")).querySelector('[data-slot="scope-grid"]') as HTMLElement
    expect(grid.className).toContain("grid-cols-3")
    expect(within(grid).getAllByRole("menuitem")).toHaveLength(3)
    expect(screen.getByRole("menuitem", { name: "Forge" })).toBeTruthy()
  })

  it("always draws an icon: the scope's own, or its initial", async () => {
    open()
    const warden = await screen.findByRole("menuitem", { name: /Warden/ })
    expect((warden.querySelector('[data-slot="scope-tile"]') as HTMLElement).textContent).toBe("W")
    const auth = screen.getByRole("menuitem", { name: /Authsome/ })
    expect(within(auth).getByTestId("auth-icon")).toBeTruthy()
  })

  it("marks the active scope and names a badge for screen readers", async () => {
    open()
    const auth = await screen.findByRole("menuitem", { name: /Authsome/ })
    expect(auth.getAttribute("aria-current")).toBe("true")
    expect(screen.getByRole("menuitem", { name: /Vault.*setup/ })).toBeTruthy()
  })

  it("selects a scope", async () => {
    const { onSelect } = open()
    fireEvent.click(await screen.findByRole("menuitem", { name: /Warden/ }))
    expect(onSelect).toHaveBeenCalledWith("warden")
  })

  it("draws an initial on the trigger when the active scope has no icon", () => {
    render(
      <SidebarProvider>
        <ScopeGridSwitcher scopes={scopes} activeId="warden" onSelect={() => {}} />
      </SidebarProvider>,
    )
    const trigger = screen.getByRole("button", { name: /Warden/ })
    expect((trigger.querySelector('[data-slot="scope-tile"]') as HTMLElement).textContent).toBe("W")
  })
})
