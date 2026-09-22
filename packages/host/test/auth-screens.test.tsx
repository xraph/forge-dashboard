import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import { defaultAuthScreens } from "../src/auth/screens"
import type { AuthScreenProps } from "../src/auth/routes"

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
  forgotPassword: "auth.forgot",
}

const props = {
  intents,
  basename: "/forge",
  next: "/forge",
  onAuthenticated: vi.fn(),
}

vi.mock("@forge-go/dashboard-plugin", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@forge-go/dashboard-plugin",
  )
  return {
    ...actual,
    useQuery: () => ({
      data: { passwordEnabled: true, brand: "Platform" },
      loading: false,
      error: undefined,
      refetch: vi.fn(),
    }),
    useCommand: () => ({
      execute: vi.fn(async () => ({ ok: true })),
      loading: false,
      error: undefined,
    }),
  }
})

function mount(Screen: React.ComponentType<AuthScreenProps>, initialEntries = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Screen {...props} />
    </MemoryRouter>,
  )
}

describe("default auth screens", () => {
  it("sign-in renders an email and password form under the brand", () => {
    mount(defaultAuthScreens.signIn)
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeDefined()
    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByLabelText(/password/i)).toBeDefined()
    expect(screen.getByText("Platform")).toBeDefined()
  })

  it("sign-in links to forgot-password under the basename", () => {
    mount(defaultAuthScreens.signIn)
    expect(
      screen.getByRole("link", { name: /forgot/i }).getAttribute("href"),
    ).toBe("/forge/forgot-password")
  })

  it("forgot-password asks for an email and links back", () => {
    mount(defaultAuthScreens.forgotPassword)
    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByRole("link", { name: /back to sign in/i }).getAttribute("href"))
      .toBe("/forge/login")
  })

  it("reset-password asks for a new password twice", () => {
    // Needs a token in the URL: the screen treats a tokenless link as
    // incomplete and renders that state instead of the form, on purpose.
    mount(defaultAuthScreens.resetPassword, ["/reset-password?token=abc123"])
    expect(screen.getByLabelText(/new password/i)).toBeDefined()
    expect(screen.getByLabelText(/confirm/i)).toBeDefined()
  })

  it("reset-password refuses to collect a password with no token", () => {
    mount(defaultAuthScreens.resetPassword, ["/reset-password"])
    expect(screen.getByRole("heading", { name: /link is incomplete/i })).toBeDefined()
    expect(screen.queryByLabelText(/new password/i)).toBeNull()
  })
})
