import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ForgeDashboardProvider, SessionProvider } from "@forge-go/dashboard-runtime"
import { definePlugin, defineSubPlugin, PluginSlot } from "@forge-go/dashboard-plugin"
import type { ContributorCapability, ForgeSubPlugin } from "@forge-go/dashboard-plugin"
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

const auth = definePlugin({
  extension: "auth",
  namespace: "auth",
  label: "Auth",
  nav: [{ label: "Users", to: "/users", group: "Identity" }],
  routes: [
    { path: "/users", element: () => <p>users page</p> },
    {
      path: "/overview",
      element: () => (
        <div>
          <p>overview page</p>
          <PluginSlot name="overview.widgets" />
        </div>
      ),
    },
  ],
})

const orgs = defineSubPlugin({
  extension: "organization",
  host: "auth",
  label: "Organizations",
  nav: [{ label: "Organizations", to: "/organizations", group: "Identity" }],
  routes: [{ path: "/organizations", element: () => <p>orgs page</p> }],
})

function capabilities(names: string[]) {
  return {
    shellEnvelopes: ["v1"],
    contributors: names.map((name) => ({
      name,
      envelopes: ["v1"],
      configured: true,
    })),
  }
}

function renderHostWith(subPlugins: ForgeSubPlugin[], contributors: string[], path: string) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(capabilities(contributors)),
  } as unknown as Response)

  return render(
    <ForgeDashboardProvider config={{ basePath: "/dashboard" }}>
      <MemoryRouter initialEntries={[path]}>
        {/*
          PluginHost reads useSession(), which throws outside a
          SessionProvider. Every other host test wraps it this way; the same
          fetchImpl answers both /principal and /capabilities here because
          the capabilities-shaped body has no `authenticated` field, which
          resolves the session to "anonymous" rather than "signedIn" -- a
          status PluginHost treats the same as signed-in for rendering.
        */}
        <SessionProvider fetchImpl={fetchImpl}>
          <PluginHost plugins={[auth]} subPlugins={subPlugins} fetchImpl={fetchImpl} />
        </SessionProvider>
      </MemoryRouter>
    </ForgeDashboardProvider>,
  )
}

function renderHost(contributors: string[], path: string) {
  return renderHostWith([orgs], contributors, path)
}

// For the tests that need one contributor "present but not configured" and
// another "ready" in the same capabilities response, which `capabilities()`
// above cannot express since it hardcodes `configured: true` for everyone
// named.
function renderHostWithCapabilities(
  subPlugins: ForgeSubPlugin[],
  contributors: ContributorCapability[],
  path: string,
) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({ shellEnvelopes: ["v1"], contributors }),
  } as unknown as Response)

  return render(
    <ForgeDashboardProvider config={{ basePath: "/dashboard" }}>
      <MemoryRouter initialEntries={[path]}>
        <SessionProvider fetchImpl={fetchImpl}>
          <PluginHost plugins={[auth]} subPlugins={subPlugins} fetchImpl={fetchImpl} />
        </SessionProvider>
      </MemoryRouter>
    </ForgeDashboardProvider>,
  )
}

describe("sub-plugin mounting", () => {
  it("mounts a ready sub-plugin's route under its host's namespace", async () => {
    renderHost(["auth", "organization"], "/@auth/organizations")
    await waitFor(() => expect(screen.getByText("orgs page")).toBeTruthy())
  })

  it("shows the sub-plugin's nav entry alongside the host's", async () => {
    renderHost(["auth", "organization"], "/@auth/users")
    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(screen.getByRole("link", { name: /Organizations/ })).toBeTruthy()
  })

  it("renders nothing at all for a sub-plugin the server never mentioned", async () => {
    renderHost(["auth"], "/@auth/users")
    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(screen.queryByRole("link", { name: /Organizations/ })).toBeNull()
  })

  it("does not mount a sub-plugin's route when its contributor is absent", async () => {
    renderHost(["auth"], "/@auth/organizations")
    await waitFor(() =>
      expect(screen.queryByText("Loading dashboard capabilities…")).toBeNull(),
    )
    expect(screen.queryByText("orgs page")).toBeNull()
  })

  it("renders nothing for a sub-plugin whose host is absent", async () => {
    renderHost(["organization"], "/@auth/organizations")
    await waitFor(() =>
      expect(screen.queryByText("Loading dashboard capabilities…")).toBeNull(),
    )
    expect(screen.queryByText("orgs page")).toBeNull()
  })
})

const setupSub = defineSubPlugin({
  extension: "billing",
  host: "auth",
  label: "Billing",
  nav: [{ label: "Billing", to: "/billing" }],
  routes: [{ path: "/billing", element: () => <p>billing page</p> }],
  contributions: {
    "overview.widgets": [{ id: "billing-widget", render: () => <p>billing widget</p> }],
  },
})

describe("setup-state and not-ready sub-plugins", () => {
  it("mounts a setup-state sub-plugin's route but contributes none of its slots", async () => {
    const caps: ContributorCapability[] = [
      { name: "auth", envelopes: ["v1"], configured: true },
      { name: "billing", envelopes: ["v1"], configured: false },
    ]

    // The route still mounts: somebody following a link or a bookmark to
    // billing's own page lands on a panel explaining why, not a blank page.
    const setupRoute = renderHostWithCapabilities([setupSub], caps, "/@auth/billing")
    await waitFor(() =>
      expect(screen.getByText("This extension is not configured yet.")).toBeTruthy(),
    )
    setupRoute.unmount()

    // But it contributes nothing to anybody else's page: a widget reading
    // "needs configuring" on the auth overview would be noise, not
    // information.
    renderHostWithCapabilities([setupSub], caps, "/@auth/overview")
    await waitFor(() => expect(screen.getByText("overview page")).toBeTruthy())
    expect(screen.queryByText("billing widget")).toBeNull()
  })

  it("renders nothing for a sub-plugin whose host is present but not ready", async () => {
    renderHostWithCapabilities(
      [orgs],
      [
        { name: "auth", envelopes: ["v1"], configured: false },
        { name: "organization", envelopes: ["v1"], configured: true },
      ],
      "/@auth/organizations",
    )
    await waitFor(() =>
      expect(screen.queryByText("Loading dashboard capabilities…")).toBeNull(),
    )
    expect(screen.queryByText("orgs page")).toBeNull()
    expect(screen.queryByRole("link", { name: /Organizations/ })).toBeNull()
  })
})

const collidingA = defineSubPlugin({
  extension: "aaa-plugin",
  host: "auth",
  routes: [{ path: "/shared", element: () => <p>from aaa</p> }],
})

const collidingB = defineSubPlugin({
  extension: "zzz-plugin",
  host: "auth",
  routes: [{ path: "/shared", element: () => <p>from zzz</p> }],
})

describe("route collisions between sub-plugins", () => {
  it("mounts one page, not both, and picks the same winner regardless of array order", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const first = renderHostWith([collidingA, collidingB], ["auth", "aaa-plugin", "zzz-plugin"], "/@auth/shared")
    await waitFor(() => expect(screen.getByText("from aaa")).toBeTruthy())
    expect(screen.queryByText("from zzz")).toBeNull()
    first.unmount()

    // Same two sub-plugins, opposite declaration order. The winner must not move.
    const second = renderHostWith([collidingB, collidingA], ["auth", "aaa-plugin", "zzz-plugin"], "/@auth/shared")
    await waitFor(() => expect(screen.getByText("from aaa")).toBeTruthy())
    second.unmount()

    warn.mockRestore()
  })

  it("says which page it dropped rather than failing silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    renderHostWith([collidingA, collidingB], ["auth", "aaa-plugin", "zzz-plugin"], "/@auth/shared")
    await waitFor(() => expect(screen.getByText("from aaa")).toBeTruthy())

    expect(warn).toHaveBeenCalled()
    const message = warn.mock.calls.flat().join(" ")
    expect(message).toContain("zzz-plugin")
    expect(message).toContain("/@auth/shared")
    warn.mockRestore()
  })

  it("lets the host's own route win over a sub-plugin claiming the same path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const clash = defineSubPlugin({
      extension: "clashing",
      host: "auth",
      routes: [{ path: "/users", element: () => <p>sub-plugin users</p> }],
    })
    renderHostWith([clash], ["auth", "clashing"], "/@auth/users")
    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())
    expect(screen.queryByText("sub-plugin users")).toBeNull()

    // Not just "the sub-plugin's page never rendered" -- react-router would
    // produce that same result on its own by matching the host's route
    // first, with dropCollidingRoutes never invoked at all. The warning is
    // what proves this path actually went through the collision decision
    // rather than an accidental tie.
    expect(warn).toHaveBeenCalled()
    const message = warn.mock.calls.flat().join(" ")
    expect(message).toContain("clashing")
    expect(message).toContain("/@auth/users")
    warn.mockRestore()
  })

  it("hides the nav entry of a sub-plugin whose route lost a collision", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const navA = defineSubPlugin({
      extension: "aaa-plugin",
      host: "auth",
      nav: [{ label: "Shared A", to: "/shared" }],
      routes: [{ path: "/shared", element: () => <p>from aaa</p> }],
    })
    const navB = defineSubPlugin({
      extension: "zzz-plugin",
      host: "auth",
      nav: [{ label: "Shared B", to: "/shared" }],
      routes: [{ path: "/shared", element: () => <p>from zzz</p> }],
    })

    renderHostWith([navA, navB], ["auth", "aaa-plugin", "zzz-plugin"], "/@auth/users")
    await waitFor(() => expect(screen.getByText("users page")).toBeTruthy())

    // The winner keeps its entry; the loser must not advertise a link that
    // would open somebody else's page.
    expect(screen.getByRole("link", { name: /Shared A/ })).toBeTruthy()
    expect(screen.queryByRole("link", { name: /Shared B/ })).toBeNull()
    warn.mockRestore()
  })
})
