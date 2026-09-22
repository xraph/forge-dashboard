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
})
