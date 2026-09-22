import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ForgeDashboard } from "../src/ForgeDashboard"
import type { ForgePlugin } from "@forge-go/dashboard-plugin"

// jsdom ships no matchMedia, and the kit's sidebar reads it through
// useIsMobile on every mount (packages/kit/src/hooks/use-mobile.ts calls
// window.matchMedia directly). Same inline stub forge-dashboard.test.tsx,
// host.test.tsx and host-playground.test.tsx already carry.
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

const authPlugin = {
  extension: "auth",
  namespace: "auth",
  label: "Auth",
  nav: [],
  routes: [],
  context: [],
  auth: {
    intents: {
      config: "auth.config",
      signIn: "auth.login",
      resetPassword: "auth.resetPassword",
    },
  },
} as unknown as ForgePlugin

function contractStub() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as Request).url
    if (url.endsWith("/principal")) {
      // A visitor with no session gets a 401 here, not a 200 with
      // authenticated: false. packages/runtime/src/session.tsx's /principal
      // effect only reaches SessionState "signedOut" on status 401; a 200
      // with authenticated: false resolves to "anonymous" instead, which
      // PluginHost renders as the ordinary dashboard shell rather than
      // AuthRoutes, and the reset screen never mounts.
      return Promise.resolve(Response.json({ authenticated: false }, { status: 401 }))
    }
    if (url.endsWith("/capabilities")) {
      return Promise.resolve(Response.json({ contributors: [] }))
    }
    return Promise.resolve(Response.json({ ok: true, data: { passwordEnabled: true } }))
  }) as unknown as typeof fetch
}

describe("a cold password-reset deep link", () => {
  it("renders the reset screen for a visitor with no session", async () => {
    window.history.replaceState({}, "", "/forge/reset-password?token=abc")

    render(
      <ForgeDashboard
        basename="/forge"
        config={{ basePath: "/api/forge", shellBase: "/forge", authEnabled: true }}
        fetchImpl={contractStub()}
        plugins={[authPlugin]}
      />,
    )

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /choose a new password/i })).toBeDefined(),
    )
    // Not bounced to sign-in, which is what the old gate did with this URL.
    expect(screen.queryByRole("heading", { name: /^sign in$/i })).toBeNull()
  })
})
