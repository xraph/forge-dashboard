import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"

vi.mock("@forge-go/dashboard-plugin", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@forge-go/dashboard-plugin",
  )
  return {
    ...actual,
    useQuery: () => ({ data: { pending: true }, loading: false, error: undefined }),
    useCommand: () => ({ execute: vi.fn(), loading: false, error: undefined }),
  }
})

const { defaultAuthScreens } = await import("../src/auth/screens")

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
  setupStatus: "auth.setupStatus",
  completeSetup: "auth.setup",
}

describe("setup precedence", () => {
  it("sends a first-run server from login to setup", () => {
    const SignIn = defaultAuthScreens.signIn
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route
            element={
              <SignIn
                basename="/forge"
                intents={intents}
                next="/forge"
                onAuthenticated={vi.fn()}
              />
            }
            path="/login"
          />
          <Route element={<div data-testid="setup" />} path="/setup" />
        </Routes>
      </MemoryRouter>,
    )
    // Navigate renders nothing itself, so the assertion is that the router
    // landed on the setup route.
    expect(screen.getByTestId("setup")).toBeDefined()
  })

  // Critical 2 regression: a provider that declares setupStatus without
  // completeSetup used to still trigger the redirect, straight at a /setup
  // route authRoutesFor never mounts for that same provider. That is not a
  // dead end, it is a loop: /setup falls through to the catch-all, which
  // sends the visitor to /login, whose SetupRedirect fires again. The mocked
  // useQuery above answers `pending: true` unconditionally, so if this screen
  // were still gating on `intents.setupStatus` alone, this test would try to
  // redirect to a route this render tree does not even provide and the
  // sign-in form would never appear.
  it("does not redirect to setup when completeSetup is missing, even though setupStatus is declared", () => {
    const SignIn = defaultAuthScreens.signIn
    const mismatchedIntents: AuthIntents = {
      config: "auth.config",
      signIn: "auth.login",
      setupStatus: "auth.setupStatus",
    }
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route
            element={
              <SignIn
                basename="/forge"
                intents={mismatchedIntents}
                next="/forge"
                onAuthenticated={vi.fn()}
              />
            }
            path="/login"
          />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeDefined()
  })
})
