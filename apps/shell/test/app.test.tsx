import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import type {
  Capabilities,
  ContributorCapability,
} from "@forge-go/dashboard-plugin"
import { ThemeProvider } from "../src/components/theme-provider"

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

/**
 * Answers capabilities and the core plugin's one query, refuses the rest.
 *
 * Only core-contract is reported, so the streaming and authsome plugins the
 * shell now compiles in resolve to hidden. That is the deployment these two
 * tests are about -- a server running the dashboard extension and nothing
 * else -- and it is worth keeping as the default fixture: the first-party set
 * is compiled in unconditionally, so "the plugin is absent" is the common
 * case, not the exotic one.
 */
function serverFetch(
  contributors: ContributorCapability[] = [
    { name: "core-contract", envelopes: ["v1"], configured: true },
  ]
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/capabilities")) {
      const caps: Capabilities = { shellEnvelopes: ["v1"], contributors }
      return jsonOk(caps)
    }
    // ForgeDashboard resolves the session before it builds any chrome, so
    // every test through it needs an answer here. Without one the session
    // resolves `unreachable` and the shell renders an alert rather than the
    // page each of these tests is asserting on. Signed in, because these
    // tests are about mounting and routing rather than about auth.
    if (url.endsWith("/principal")) {
      return jsonOk({
        authenticated: true,
        subject: "usr_shell_test",
        displayName: "Shell test user",
        email: "shell@example.com",
      })
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
    // getAllByText, not getByText: the core overview renders uptime twice,
    // once as a stat card and once in a description list. That is the core
    // plugin's business and not this test's, which only needs the value to
    // have reached the page through the real fetch and the real router.
    expect(screen.getAllByText("1h 2m").length).toBeGreaterThan(0)
    expect(screen.getByText("production")).toBeTruthy()
  })

  it("resolves nav hrefs inside the mount, not at the site root", async () => {
    vi.stubGlobal("fetch", serverFetch())

    render(<App />)

    const link = await screen.findByRole("link", { name: "Overview" })
    // The exact probe run against the built artifact in the browser: the href
    // used to read "/overview" -- absolute from the site root, outside the
    // dashboard mount, so it 404s from the Go app on refresh or on a shared
    // link. Core is now the root plugin, so its href carries no "@namespace"
    // segment of its own, but it is still resolved relative to the mount:
    // that is what this assertion is actually pinning -- mount-prefixed, not
    // site-root-absolute -- regardless of whether the plugin behind it has a
    // namespace.
    expect(link.getAttribute("href")).toBe("/dashboard/ui/overview")
  })

  /**
   * The shell wires three plugins, and the only place that is true is App.tsx.
   * host.test.tsx builds its own plugins, so it would stay green if the array
   * in App.tsx were emptied tomorrow.
   *
   * The three join keys are the assertion underneath the labels. They are Go
   * contributor names, not package names -- "streaming" and "authsome" --
   * and getting one wrong resolves that plugin to hidden with nothing logged.
   * A capabilities document naming all three is the only fixture that can tell
   * the difference between a plugin that is wired and a plugin that is silent.
   *
   * Namespacing changes how this has to be checked. There is no more pill nav
   * holding every plugin's links at once -- the sidebar shows only the active
   * scope's own group -- so "all three are wired" is now three visits, one
   * per scope, each confirming that scope's own nav renders with hrefs scoped
   * under both its namespace and the shellBase mount.
   */
  it("compiles in all three plugins, each reachable at its own @namespace", async () => {
    vi.stubGlobal(
      "fetch",
      serverFetch([
        { name: "core-contract", envelopes: ["v1"], configured: true },
        { name: "streaming", envelopes: ["v1"], configured: true },
        { name: "authsome", envelopes: ["v1"], configured: true },
      ])
    )

    // core is the root plugin and first in the plugins array, so the site
    // root redirects to its own page by default -- no explicit navigation
    // needed for it. Unlike streaming and auth below, its href carries no
    // "@namespace" segment (root plugins do not get one); this assertion
    // proves it is still wired and reachable at the mount, not that it is
    // namespaced.
    const core = render(<App />)
    const overviewLink = await screen.findByRole("link", { name: "Overview" })
    expect(overviewLink.getAttribute("href")).toBe("/dashboard/ui/overview")
    core.unmount()

    window.history.replaceState({}, "", `${SHELL_BASE}/@streaming`)
    const streaming = render(<App />)
    // Scoped to the active scope's own nav group (SidebarContent), not the
    // whole page. core's pinned nav lives in SidebarHeader and stays visible
    // in every scope -- including this one, whose own nav happens to declare
    // an item also labelled "Overview" -- so an unscoped query here would
    // find two "Overview" links (ambiguous) and the link list below would
    // pick up the pinned entry this part of the test is not about.
    // The session resolves before the shell is built, so the sidebar does not
    // exist on the first frame: the host renders a bare spinner until
    // /principal answers. Querying synchronously here hands `within` a null
    // container. Wait for the chrome, then scope to it.
    const streamingNav = await waitFor(() => {
      const nav = streaming.container.querySelector(
        '[data-slot="sidebar-content"]'
      )
      if (!nav) throw new Error("sidebar-content not rendered yet")
      return nav as HTMLElement
    })
    await within(streamingNav).findByRole("link", { name: "Overview" })
    let links = within(streamingNav).getAllByRole("link")
    // The whole streaming nav, in order, not a subset. This assertion caught
    // three pages that landed in the plugin while nothing here noticed,
    // because a per-package test run never renders the shell.
    expect(links.map((a) => a.textContent)).toEqual([
      "Overview",
      "Rooms",
      "Connections",
      "Channels",
      "Presence",
      "Configuration",
    ])
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard/ui/@streaming",
      "/dashboard/ui/@streaming/rooms",
      "/dashboard/ui/@streaming/connections",
      "/dashboard/ui/@streaming/channels",
      "/dashboard/ui/@streaming/presence",
      "/dashboard/ui/@streaming/config",
    ])

    // core's pinned nav stays visible while inside this scope, against the
    // real plugin set App.tsx wires -- not just the synthetic plugins
    // host.test.tsx builds.
    const streamingHeader = streaming.container.querySelector(
      '[data-slot="sidebar-header"]'
    ) as HTMLElement
    expect(
      within(streamingHeader).getByRole("link", { name: "Overview" })
    ).toBeTruthy()

    streaming.unmount()

    // /@authsome/<app>/users, not /@authsome/users. Authsome declares a path-routed
    // context dimension now, so the first segment after the namespace is the
    // APP, and every page lives under it. The old URL still resolves: it just
    // means app "users" with no page, which is why this entry point had to
    // move rather than merely being tidied.
    //
    // Not /@authsome/login either. Sign-in is the gate, not a page: authsome
    // dropped it from both nav and routes.
    window.history.replaceState({}, "", `${SHELL_BASE}/@authsome/platform/users`)
    const auth = render(<App />)
    const authNav = await waitFor(() => {
      const nav = auth.container.querySelector('[data-slot="sidebar-content"]')
      if (!nav) throw new Error("sidebar-content not rendered yet")
      return nav as HTMLElement
    })
    await within(authNav).findByRole("link", { name: "Users" })
    links = within(authNav).getAllByRole("link")
    // Every auth nav entry, in the order the sidebar groups them. The list is
    // long and it is written out anyway: the point of this assertion is that
    // a page appearing or vanishing fails here, and a subset check would let
    // either through.
    expect(links.map((a) => a.textContent)).toEqual([
      "Users",
      "Sessions",
      "Devices",
      "Roles",
      "Apps",
      "Environments",
      "Webhooks",
      "Signup forms",
      "Settings",
      "Credentials",
      "Features",
      "Overview",
      "Plugins",
    ])
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard/ui/@authsome/platform/users",
      "/dashboard/ui/@authsome/platform/sessions",
      "/dashboard/ui/@authsome/platform/devices",
      "/dashboard/ui/@authsome/platform/roles",
      "/dashboard/ui/@authsome/platform/apps",
      "/dashboard/ui/@authsome/platform/environments",
      "/dashboard/ui/@authsome/platform/webhooks",
      "/dashboard/ui/@authsome/platform/signup-forms",
      "/dashboard/ui/@authsome/platform/settings",
      "/dashboard/ui/@authsome/platform/credentials",
      "/dashboard/ui/@authsome/platform/features",
      "/dashboard/ui/@authsome/platform",
      "/dashboard/ui/@authsome/platform/plugins",
    ])

    // The way out of a scope is a single back row above the switcher, which
    // replaced the root plugin's pinned nav. It carries the root's first nav
    // item, so it is still labelled "Overview" and it still lives in the
    // header, but it is one row rather than a whole nav tree.
    const authHeader = auth.container.querySelector(
      '[data-slot="sidebar-header"]'
    ) as HTMLElement
    expect(
      within(authHeader).getByRole("link", { name: "Overview" })
    ).toBeTruthy()
  })
})

describe("relay in the shell", () => {
  it("mounts at @relay, lists its endpoints, and reads them from the relay contributor", async () => {
    const intents: string[] = []
    const base = serverFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "relay", envelopes: ["v1"], configured: true },
    ])
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === CONTRACT_BASE && init?.body) {
          const req = JSON.parse(String(init.body)) as {
            contributor?: string
            intent?: string
          }
          if (req.contributor === "relay") {
            intents.push(req.intent ?? "")
            return jsonOk({
              ok: true,
              data: {
                endpoints: [
                  {
                    id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2x",
                    tenantId: "acme",
                    url: "https://acme.example/hook",
                    eventTypes: ["invoice.*"],
                    enabled: true,
                    rateLimit: 0,
                    signed: true,
                    createdAt: "2026-09-01T00:00:00Z",
                    updatedAt: "2026-09-01T00:00:00Z",
                  },
                ],
              },
            })
          }
        }
        return base(input, init)
      })
    )

    window.history.replaceState({}, "", `${SHELL_BASE}/@relay/endpoints`)
    // Wrapped here because App reads useTheme. The older tests in this file
    // render App bare and fail on main for that reason; this one should not
    // depend on how that gets fixed.
    const relay = render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    )
    const nav = await waitFor(() => {
      const el = relay.container.querySelector('[data-slot="sidebar-content"]')
      if (!el) throw new Error("sidebar-content not rendered yet")
      return el as HTMLElement
    })
    await within(nav).findByRole("link", { name: "Endpoints" })
    const links = within(nav).getAllByRole("link")
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard/ui/@relay/endpoints",
    ])
    // The row's link goes to the detail page inside the same scope.
    const row = await screen.findByRole("link", {
      name: "https://acme.example/hook",
    })
    expect(row.getAttribute("href")).toBe(
      "/dashboard/ui/@relay/endpoints/ep_01hq2k3m4n5p6q7r8s9t0v1w2x"
    )
    expect(intents).toContain("endpoints.list")
  })
})

describe("chronicle in the shell", () => {
  it("mounts at @chronicle, groups its nav, and lands on the chain without verifying anything", async () => {
    const intents: string[] = []
    const base = serverFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "chronicle", envelopes: ["v1"], configured: true },
    ])
    const stream = {
      id: "stream_own",
      appId: "app_forge",
      headHash: "9f2c4e1a7b3d5f60",
      headSeq: 12431,
      scheme: "chronicle/v4",
      schemeSince: 1,
      coverageCeiling: "unkeyed",
      checkpointingConfigured: false,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === CONTRACT_BASE && init?.body) {
          const req = JSON.parse(String(init.body)) as {
            contributor?: string
            intent?: string
          }
          if (req.contributor === "chronicle") {
            intents.push(req.intent ?? "")
            if (req.intent === "streams.mine") {
              return jsonOk({ ok: true, data: { stream } })
            }
            if (req.intent === "streams.list") {
              return jsonOk({
                ok: true,
                data: { streams: [stream], total: 1, hasMore: false },
              })
            }
          }
        }
        return base(input, init)
      })
    )

    window.history.replaceState({}, "", `${SHELL_BASE}/@chronicle`)
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    )
    // The scope's pages are in the rail, one labelled list per nav group.
    const rail = await screen.findByRole("navigation", {
      name: "Scope navigation",
    })
    await within(rail).findByRole("link", { name: "Chain" })
    const groups = Array.from(
      rail.querySelectorAll<HTMLElement>('[data-slot="rail-entries"]')
    )
    expect(groups.map((ul) => ul.getAttribute("aria-label"))).toEqual([
      "Integrity",
      "Log",
      "Compliance",
      "Retention",
      "Settings",
    ])
    expect(
      groups.flatMap((ul) =>
        within(ul)
          .getAllByRole("link")
          .map((a) => a.getAttribute("href"))
      )
    ).toEqual([
      "/dashboard/ui/@chronicle/chain",
      "/dashboard/ui/@chronicle/checkpoints",
      "/dashboard/ui/@chronicle/events",
      "/dashboard/ui/@chronicle/activity",
      "/dashboard/ui/@chronicle/reports",
      "/dashboard/ui/@chronicle/erasures",
      "/dashboard/ui/@chronicle/retention",
      "/dashboard/ui/@chronicle/archives",
      "/dashboard/ui/@chronicle/settings",
    ])
    // The landing route is the chain, read from the chronicle contributor.
    await screen.findByRole("heading", { name: "Chain" })
    await screen.findByText("chronicle/v4")
    expect(intents).toContain("streams.mine")
    // Verification is an operator's act, so landing on the page runs none.
    expect(intents).not.toContain("verify.run")
  })
})

describe("authsome's routed app segment", () => {
  /**
   * The app is a path segment now, so a URL names one. These two pin the
   * halves that a stale test hid: the first segment after the namespace is
   * the app and every page sits under it, and a URL with no segment at all
   * has no pages to offer.
   */
  it("builds every nav href under the app in the URL", async () => {
    vi.stubGlobal("fetch", serverFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "authsome", envelopes: ["v1"], configured: true },
    ]))
    window.history.replaceState({}, "", `${SHELL_BASE}/@authsome/acme/users`)
    const { container } = render(<App />)

    const nav = await waitFor(() => {
      const el = container.querySelector('[data-slot="sidebar-content"]')
      if (!el) throw new Error("sidebar-content not rendered yet")
      return el as HTMLElement
    })
    await within(nav).findByRole("link", { name: "Users" })

    // Not one link outside the app. A single href that forgot the segment
    // would land somebody in another app's page and look perfectly ordinary.
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/dashboard\/ui\/@authsome\/acme(\/|$)/)
    }
  })

  it("offers no pages at all when the URL names no app", async () => {
    vi.stubGlobal("fetch", serverFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "authsome", envelopes: ["v1"], configured: true },
    ]))
    window.history.replaceState({}, "", `${SHELL_BASE}/@authsome`)
    const { container } = render(<App />)
    await waitFor(() => expect(screen.getAllByRole("link").length).toBeGreaterThan(0))

    const nav = container.querySelector('[data-slot="sidebar-content"]') as HTMLElement
    // Thirty-seven links that would each answer about an app nobody picked
    // is worse than none.
    expect(within(nav).queryByRole("link", { name: "Users" })).toBeNull()
    expect(within(nav).queryByRole("link", { name: "Sessions" })).toBeNull()
  })
})

describe("the authsome sub-plugins the shell mounts", () => {
  /**
   * The shell passes all twenty-four to `ForgeDashboard`. None of them is
   * meant to appear unless the capabilities response names its own Go
   * contributor, and that gating is the entire reason the set can be compiled
   * in unconditionally. So both halves are asserted: absent stays absent, and
   * present actually mounts.
   *
   * Without the second half, a shell that forgot to pass `subPlugins` at all
   * would pass every other test in this file, because "renders nothing" is
   * exactly what a correctly gated sub-plugin does.
   */
  it("renders none of them when no sub-plugin contributor is reported", async () => {
    const fetchImpl = serverFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "authsome", envelopes: ["v1"], configured: true },
    ])
    vi.stubGlobal("fetch", fetchImpl)
    window.history.replaceState({}, "", `${SHELL_BASE}/@authsome/platform/users`)
    const { container } = render(<App />)
    await waitFor(() => expect(screen.getAllByRole("link").length).toBeGreaterThan(0))

    expect(within(container).queryByRole("link", { name: "Waitlist" })).toBeNull()
    expect(within(container).queryByRole("link", { name: /^Organizations?$/ })).toBeNull()
    expect(within(container).queryByRole("link", { name: "MFA" })).toBeNull()
  })

  it("mounts one as soon as its own contributor is reported", async () => {
    const fetchImpl = serverFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "authsome", envelopes: ["v1"], configured: true },
      { name: "waitlist", envelopes: ["v1"], configured: true },
      { name: "mfa", envelopes: ["v1"], configured: true },
    ])
    vi.stubGlobal("fetch", fetchImpl)
    // Under an app. Authsome's nav, sub-plugins included, only renders once
    // the URL names one, so a test landing at the bare namespace would see
    // nothing and could not tell that from a sub-plugin that never mounted.
    window.history.replaceState({}, "", `${SHELL_BASE}/@authsome/platform/users`)
    const { container } = render(<App />)

    // A data sub-plugin and a settings-only one, because they reach the
    // sidebar by different routes: one declares its own intents, the other
    // declares none and reads settings through its host.
    await waitFor(() =>
      expect(within(container).getByRole("link", { name: "Waitlist" })).toBeTruthy()
    )
    expect(within(container).getByRole("link", { name: "MFA" })).toBeTruthy()
    // Still gated: organization was not reported, so it is still absent.
    expect(within(container).queryByRole("link", { name: /^Organizations?$/ })).toBeNull()
  })
})
