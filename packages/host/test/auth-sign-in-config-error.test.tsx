import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"

// sign-in.tsx used to read config.data and config.loading but never
// config.error, so a failed auth.config read rendered a title and nothing
// else: no error, no explanation, no way out. This file's mock pins that one
// state down, the same way auth-setup-precedence.test.tsx and
// auth-sign-in-loading.test.tsx each pin their own.
const refetch = vi.fn()

vi.mock("@forge-go/dashboard-plugin", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@forge-go/dashboard-plugin"
  )
  return {
    ...actual,
    useQuery: () => ({
      data: undefined,
      loading: false,
      error: { code: "TRANSPORT", message: "boom" },
      refetch,
    }),
    useCommand: () => ({ execute: vi.fn(), loading: false, error: undefined }),
  }
})

const { defaultAuthScreens } = await import("../src/auth/screens")

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
}

describe("sign-in when auth.config fails", () => {
  it("surfaces the error and offers a retry, instead of an empty screen", () => {
    const SignIn = defaultAuthScreens.signIn
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <SignIn
          basename="/forge"
          intents={intents}
          next="/forge"
          onAuthenticated={vi.fn()}
        />
      </MemoryRouter>
    )

    expect(screen.getByRole("alert").textContent).toContain("boom")
    expect(screen.queryByLabelText(/password/i)).toBeNull()

    const retry = screen.getByRole("button", { name: /retry/i })
    fireEvent.click(retry)
    expect(refetch).toHaveBeenCalled()
  })
})
