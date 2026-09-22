import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"

// Every other auth-screen test mocks useQuery with loading: false, so the
// `config.loading && !config.data` branch in sign-in.tsx has never actually
// run under a test. This file's mock is its own, the same way
// auth-setup-precedence.test.tsx's is, so this one state can be pinned
// without disturbing what every other test asserts.
vi.mock("@forge-go/dashboard-plugin", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@forge-go/dashboard-plugin",
  )
  return {
    ...actual,
    useQuery: () => ({ data: undefined, loading: true, error: undefined, refetch: vi.fn() }),
    useCommand: () => ({ execute: vi.fn(), loading: false, error: undefined }),
  }
})

const { defaultAuthScreens } = await import("../src/auth/screens")

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
}

describe("sign-in while auth.config is still loading", () => {
  it("shows the spinner and offers no password field yet", () => {
    const SignIn = defaultAuthScreens.signIn
    const { container } = render(
      <MemoryRouter initialEntries={["/login"]}>
        <SignIn basename="/forge" intents={intents} next="/forge" onAuthenticated={vi.fn()} />
      </MemoryRouter>,
    )

    expect(container.querySelector('[data-slot="spinner"]')).toBeTruthy()
    expect(screen.queryByLabelText(/email/i)).toBeNull()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })
})
