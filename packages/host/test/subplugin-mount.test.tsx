import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ForgeDashboardProvider, SessionProvider } from "@forge-go/dashboard-runtime"
import { definePlugin, defineSubPlugin } from "@forge-go/dashboard-plugin"
import type { ForgeSubPlugin } from "@forge-go/dashboard-plugin"
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
  routes: [{ path: "/users", element: () => <p>users page</p> }],
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
    warn.mockRestore()
  })
})
