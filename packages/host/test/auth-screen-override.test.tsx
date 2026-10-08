import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ForgeDashboard } from "../src/ForgeDashboard"
import type { ForgePlugin } from "@forge-go/dashboard-plugin"

// jsdom ships no matchMedia, and the kit's sidebar reads it through
// useIsMobile on every mount (packages/kit/src/hooks/use-mobile.ts calls
// window.matchMedia directly). Same inline stub auth-deep-link.test.tsx,
// forge-dashboard.test.tsx, host.test.tsx and host-playground.test.tsx carry.
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
    },
  },
} as unknown as ForgePlugin

function contractStub() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as Request).url
    if (url.endsWith("/principal")) {
      // A 401 here, not a 200 with authenticated: false, is what resolves the
      // session to "signedOut" (see session.tsx). That is what puts PluginHost
      // on AuthRoutes instead of the ordinary shell.
      return Promise.resolve(
        Response.json({ authenticated: false }, { status: 401 })
      )
    }
    if (url.endsWith("/capabilities")) {
      return Promise.resolve(Response.json({ contributors: [] }))
    }
    return Promise.resolve(
      Response.json({ ok: true, data: { passwordEnabled: true } })
    )
  }) as unknown as typeof fetch
}

function CustomSignIn() {
  return <div data-testid="custom-sign-in">A host app's own sign-in screen</div>
}

describe("authScreens override", () => {
  it("renders the host's custom screen at /login instead of the default", async () => {
    window.history.replaceState({}, "", "/forge/login")

    render(
      <ForgeDashboard
        authScreens={{ signIn: CustomSignIn }}
        basename="/forge"
        config={{
          basePath: "/api/forge",
          shellBase: "/forge",
          authEnabled: true,
        }}
        fetchImpl={contractStub()}
        plugins={[authPlugin]}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId("custom-sign-in")).toBeDefined()
    )
    // Proof this is the override and not the default rendering alongside it:
    // the default sign-in screen's own heading must not be on the page.
    expect(screen.queryByRole("heading", { name: /^sign in$/i })).toBeNull()
  })
})
