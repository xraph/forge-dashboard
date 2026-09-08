// packages/kit/test/nav-user.test.tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SidebarProvider } from "../src/components/sidebar"
import { NavUser } from "../src/components/nav-user"

/**
 * NavUser drives the same base-ui Menu primitives as ScopeSwitcher, so this
 * file's real job is to keep a second consumer of `dropdown-menu.tsx` honest
 * about the jsdom top-layer recursion documented in
 * packages/test-support/jsdom-setup.ts. Without that shared setup these
 * assertions still pass, but the file takes minutes instead of milliseconds.
 * If this suite ever gets slow again, look there first.
 */

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

const user = { name: "Ada Lovelace", email: "ada@example.com" }

function renderNavUser(overrides: Partial<React.ComponentProps<typeof NavUser>> = {}) {
  return render(
    <SidebarProvider>
      <NavUser user={user} {...overrides} />
    </SidebarProvider>,
  )
}

describe("NavUser", () => {
  it("shows the user's name and email on the trigger", () => {
    renderNavUser()
    expect(screen.getByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
  })

  it("derives the avatar fallback from the name", () => {
    renderNavUser()
    expect(screen.getByText("AL")).toBeTruthy()
  })

  it("lists the account actions once opened", () => {
    renderNavUser({ onSignOut: () => {} })
    fireEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }))

    for (const label of ["Account", "Billing", "Notifications", "Log out"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy()
    }
  })

  it("renders no sign-out item without a handler", () => {
    renderNavUser()
    fireEvent.click(screen.getByRole("button"))
    expect(screen.queryByText("Log out")).toBeNull()
  })

  it("calls the handler when sign-out is chosen", () => {
    const onSignOut = vi.fn()
    renderNavUser({ onSignOut })
    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(screen.getByText("Log out"))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
