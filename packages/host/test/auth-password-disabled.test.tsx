import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"

vi.mock("@forge-go/dashboard-plugin", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@forge-go/dashboard-plugin"
  )
  return {
    ...actual,
    useQuery: () => ({
      data: { passwordEnabled: false },
      loading: false,
      error: undefined,
      refetch: vi.fn(),
    }),
    useCommand: () => ({ execute: vi.fn(), loading: false, error: undefined }),
  }
})

const { defaultAuthScreens } = await import("../src/auth/screens")

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
}

describe("sign-in with password login disabled", () => {
  it("offers no password field when the config says passwordEnabled is false", () => {
    const SignIn = defaultAuthScreens.signIn
    render(
      <MemoryRouter>
        <SignIn
          basename="/forge"
          intents={intents}
          next="/forge"
          onAuthenticated={vi.fn()}
        />
      </MemoryRouter>
    )
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeDefined()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })
})
