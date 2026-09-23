import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import {
  ForgeDashboardProvider,
  SessionProvider,
} from "@forge-go/dashboard-runtime"
import { PluginLink, definePlugin } from "@forge-go/dashboard-plugin"
import { PluginHost } from "../src/host/PluginHost"

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

// A plugin with no routed context dimension: nothing in its URL after the
// namespace is a context segment. Its pages live one level down, the way
// relay's /endpoints and streaming's /rooms do.
const plugin = definePlugin({
  extension: "relay",
  namespace: "relay",
  label: "Relay",
  nav: [{ label: "Endpoints", to: "/endpoints" }],
  routes: [
    {
      path: "/endpoints",
      element: () => <PluginLink to="/endpoints/ep_1">first endpoint</PluginLink>,
    },
  ],
})

function renderAt(path: string) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        shellEnvelopes: ["v1"],
        contributors: [{ name: "relay", envelopes: ["v1"], configured: true }],
      }),
  } as unknown as Response)

  return render(
    <ForgeDashboardProvider config={{ basePath: "/dashboard" }}>
      <MemoryRouter initialEntries={[path]}>
        <SessionProvider fetchImpl={fetchImpl}>
          <PluginHost plugins={[plugin]} fetchImpl={fetchImpl} />
        </SessionProvider>
      </MemoryRouter>
    </ForgeDashboardProvider>
  )
}

describe("PluginLink inside a scope with no routed dimension", () => {
  // The host used to read the first segment after the namespace as a context
  // segment for every plugin, so a link written on /@relay/endpoints came out
  // as /@relay/endpoints/endpoints/ep_1. Only a plugin that declares a routed
  // path dimension has a segment there.
  it("resolves against the scope root, not the page it is written on", async () => {
    renderAt("/@relay/endpoints")
    const link = await screen.findByRole("link", { name: "first endpoint" })
    expect(link.getAttribute("href")).toBe("/@relay/endpoints/ep_1")
  })
})
