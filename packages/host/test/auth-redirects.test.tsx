import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import { AuthRoutes, SignedInRedirect } from "../src/auth/AuthRoutes"

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
  resetPassword: "auth.reset",
}

const screens = {
  signIn: () => <div data-testid="sign-in" />,
  resetPassword: () => <div data-testid="reset" />,
}

// basename on MemoryRouter, not just on AuthRoutes: that is what strips
// "/forge" off useLocation().pathname before AuthRoutes ever sees it, the same
// stripping a real BrowserRouter does in production. Without it here, every
// path in this file would carry a literal "/forge" prefix that no route
// pattern below ever declares.
function at(path: string) {
  return render(
    <MemoryRouter basename="/forge" initialEntries={[path]}>
      <AuthRoutes
        basename="/forge"
        intents={intents}
        onAuthenticated={vi.fn()}
        screens={screens}
      />
    </MemoryRouter>
  )
}

describe("AuthRoutes", () => {
  it("rule 1: renders the screen for a mounted auth path", () => {
    at("/forge/login")
    expect(screen.getByTestId("sign-in")).toBeDefined()
  })

  it("rule 1: serves a cold reset deep link", () => {
    // The case the old gate could not serve, and the reason this exists.
    at("/forge/reset-password?token=abc")
    expect(screen.getByTestId("reset")).toBeDefined()
  })

  it("rule 2: sends any other path to login", () => {
    at("/forge/apps")
    expect(screen.getByTestId("sign-in")).toBeDefined()
  })

  it("rule 2: an unmounted auth path falls back to login", () => {
    at("/forge/signup")
    expect(screen.getByTestId("sign-in")).toBeDefined()
  })
})

describe("rule 3: signed in, still on an auth path", () => {
  it("returns to the path that was attempted", () => {
    render(
      <MemoryRouter initialEntries={["/login?next=%2Fapps"]}>
        <Routes>
          <Route element={<SignedInRedirect basename="" />} path="/login" />
          <Route element={<div data-testid="apps" />} path="/apps" />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId("apps")).toBeDefined()
  })

  it("falls back to the dashboard root when next is missing", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route element={<SignedInRedirect basename="" />} path="/login" />
          <Route element={<div data-testid="root" />} path="/" />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId("root")).toBeDefined()
  })

  it("refuses an off-site next", () => {
    render(
      <MemoryRouter initialEntries={["/login?next=%2F%2Fevil.example.com"]}>
        <Routes>
          <Route element={<SignedInRedirect basename="" />} path="/login" />
          <Route element={<div data-testid="root" />} path="/" />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId("root")).toBeDefined()
  })
})
