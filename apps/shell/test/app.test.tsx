import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { Capabilities } from "@forge-go/dashboard-plugin"

// jsdom ships no matchMedia, and the kit's sidebar reads it through
// useIsMobile on every mount.
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

// The mount this test is about. It is deliberately NOT the default: with
// BasePath "/dashboard" the Go handler serves the shell at "/dashboard/ui"
// and injects that as shellBase, and a router that ignores it reads
// "/dashboard/ui" as the route to match.
const BASE_PATH = "/dashboard"
const SHELL_BASE = "/dashboard/ui"
const CONTRACT_BASE = "/dashboard/api/dashboard/v1"

const OVERVIEW = {
  overallHealth: "healthy",
  totalServices: 7,
  healthyServices: 7,
  totalMetrics: 42,
  uptimeSeconds: 3720,
  version: "1.2.3",
  environment: "production",
}

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

/** Answers capabilities and the core plugin's one query, refuses the rest. */
function serverFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/capabilities")) {
      const caps: Capabilities = {
        shellEnvelopes: ["v1"],
        contributors: [
          { name: "core-contract", envelopes: ["v1"], configured: true },
        ],
      }
      return jsonOk(caps)
    }
    if (url === CONTRACT_BASE) {
      return jsonOk({ ok: true, data: OVERVIEW })
    }
    throw new Error(`unexpected request to ${url}`)
  }) as unknown as typeof fetch
}

// App reads window.__FORGE_DASHBOARD__ at module scope, exactly as it does in
// the browser -- the bootstrap <script> the Go handler injects runs before the
// bundle. So the global has to be in place before the import, which means a
// dynamic one.
let App: () => React.ReactElement

beforeAll(async () => {
  window.__FORGE_DASHBOARD__ = {
    basePath: BASE_PATH,
    contractBase: CONTRACT_BASE,
    shellBase: SHELL_BASE,
    authEnabled: false,
    loginPath: `${BASE_PATH}/login`,
  }
  window.history.replaceState({}, "", SHELL_BASE)
  App = (await import("../src/App")).App
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * The regression W3 shipped and W4 nearly shipped again: <BrowserRouter> with
 * no basename. Every other test in this repo mounts PluginHost inside a
 * MemoryRouter starting at "/overview", which is only true of `pnpm dev`,
 * where Vite serves the SPA from the site root. In production the shell
 * answers at {BasePath}/ui, nothing matches "/overview", and the content pane
 * comes up empty under a sidebar and header that look perfectly healthy.
 *
 * App itself was rendered by no test at all until this one.
 */
describe("App at a non-default mount", () => {
  it("renders the overview page, with data, at the injected shellBase", async () => {
    vi.stubGlobal("fetch", serverFetch())

    render(<App />)

    // "/dashboard/ui" under basename "/dashboard/ui" is the router's "/", the
    // host redirects that to the core plugin's "/overview", and the page then
    // resolves its query. All three have to work for a value to appear.
    expect(await screen.findByText("healthy")).toBeTruthy()
    expect(screen.getByText("1h 2m")).toBeTruthy()
    expect(screen.getByText("production")).toBeTruthy()
  })

  it("resolves nav hrefs inside the mount, not at the site root", async () => {
    vi.stubGlobal("fetch", serverFetch())

    render(<App />)

    const link = await screen.findByRole("link", { name: "Overview" })
    // The exact probe run against the built artifact in the browser: the href
    // read "/overview" -- absolute from the site root, outside the dashboard
    // mount, so it 404s from the Go app on refresh or on a shared link.
    expect(link.getAttribute("href")).toBe("/dashboard/ui/overview")
  })
})
