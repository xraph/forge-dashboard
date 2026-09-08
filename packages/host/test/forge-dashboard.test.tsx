import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import { ForgeDashboard } from "../src/ForgeDashboard"

// jsdom ships no matchMedia, and the kit's sidebar reads it through
// useIsMobile on every mount (packages/kit/src/hooks/use-mobile.ts calls
// window.matchMedia directly). jsdom-setup.ts (wired in via vitest.config.ts)
// only patches Element.prototype.matches for top-layer pseudo-classes -- it
// does not stub matchMedia -- so this needs the same inline stub host.test.tsx
// and host-playground.test.tsx already carry.
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

const rootPlugin = definePlugin({
  extension: "probe-contract",
  root: true,
  label: "Probe",
  nav: [{ label: "Home", to: "/home" }],
  // `element` is typed ComponentType (packages/plugin/src/types.ts) and read
  // as `const Page = route.element` in PluginHost, i.e. it must be a
  // component, not a pre-instantiated JSX element. Every other test file in
  // this package uses the `() => <p>...</p>` factory form for exactly that
  // reason.
  routes: [{ path: "/home", element: () => <div>probe home</div> }],
})

// The real shape, from packages/plugin/src/resolve.ts: Capabilities is
// { shellEnvelopes, contributors }, and each ContributorCapability is
// { name, envelopes, configured }. `configured` is always on the wire and is
// what separates a ready contributor from one still in setup.
const capabilities: Capabilities = {
  shellEnvelopes: ["v1"],
  contributors: [
    { name: "probe-contract", envelopes: ["v1"], configured: true },
  ],
}

// Only the capabilities request is stubbed. Anything else throws, so a page
// that quietly fetches something this test did not anticipate fails loudly
// instead of silently rendering against undefined. This mirrors the stub in
// packages/host/test/host.test.tsx.
function stubFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/capabilities")) {
      return new Response(JSON.stringify(capabilities), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    throw new Error(`unexpected request to ${url}`)
  }) as unknown as typeof fetch
}

describe("ForgeDashboard", () => {
  it("mounts a root plugin's page under the given basename", async () => {
    window.history.pushState({}, "", "/admin/home")

    render(
      <ForgeDashboard
        config={{ basePath: "/admin", contractBase: "/api/forge/dashboard/v1" }}
        basename="/admin"
        plugins={[rootPlugin]}
        fetchImpl={stubFetch()}
      />
    )

    expect(await screen.findByText("probe home")).toBeDefined()
  })
})
