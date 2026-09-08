// packages/kit/test/nav-user.test.tsx
import { describe, expect, it } from "vitest"
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

function setup() {
  render(
    <SidebarProvider>
      <NavUser user={user} />
    </SidebarProvider>,
  )
}

describe("NavUser", () => {
  it("shows the user's name and email on the trigger", () => {
    setup()
    expect(screen.getByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
  })

  it("derives the avatar fallback from the name", () => {
    setup()
    expect(screen.getByText("AL")).toBeTruthy()
  })

  it("lists the account actions once opened", () => {
    setup()
    fireEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }))

    for (const label of ["Account", "Billing", "Notifications", "Log out"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeTruthy()
    }
  })
})
