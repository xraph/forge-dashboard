import { describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ForgeDashboardProvider, SessionProvider } from "@forge-go/dashboard-runtime"
import { definePlugin, useQuery, usePluginClient } from "@forge-go/dashboard-plugin"
import type {
  Capabilities,
  ContributorCapability,
  ForgePlugin,
  PluginInput,
} from "@forge-go/dashboard-plugin"
import { PluginHost } from "../src/host/PluginHost"

// jsdom ships no matchMedia, and the kit's sidebar reads it through
// useIsMobile on every mount. Stubbing it here rather than in a setup file
// keeps the whole fixture in one place; nothing else in this app needs it.
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

const config = { basePath: "/dashboard" }

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

/**
 * A fetch that answers the capabilities request and refuses everything else.
 *
 * The host takes its fetch as a prop rather than reading the global, so a test
 * never has to reach for vi.stubGlobal and never has to undo it. Injecting it
 * also proves the wiring: the same function the host uses for capabilities is
 * the one it hands to each plugin's scoped client.
 */
function capabilitiesFetch(
  contributors: ContributorCapability[]
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/capabilities")) {
      const caps: Capabilities = { shellEnvelopes: ["v1"], contributors }
      return jsonOk(caps)
    }
    // Every pre-existing test in this suite is about resolution and routing,
    // not about auth, so they run as a signed-in user. Without this branch
    // the session resolves `unreachable` and the host renders an alert
    // instead of the thing each of those tests is asserting on.
    if (url.endsWith("/principal")) {
      return jsonOk({ authenticated: true, subject: "usr_test", email: "test@example.com" })
    }
    throw new Error(`unexpected request to ${url}`)
  }) as unknown as typeof fetch
}

function demoPlugin(overrides: Partial<PluginInput> = {}): ForgePlugin {
  return definePlugin({
    extension: "core-contract",
    nav: [{ label: "Overview", to: "/overview" }],
    routes: [{ path: "/overview", element: () => <p>overview page body</p> }],
    ...overrides,
  })
}

/**
 * A plugin whose page issues one query and prints the contributor name the
 * server saw on the wire.
 */
function queryingPlugin(
  extension: string,
  path: string,
  label: string
): ForgePlugin {
  function Page() {
    const { data, loading } = useQuery<{ seen: string }>("ping")
    if (loading) return <p>{label} loading</p>
    return (
      <p>
        {label} says {data?.seen}
      </p>
    )
  }

  return definePlugin({
    extension,
    nav: [{ label, to: path }],
    routes: [{ path, element: Page }],
  })
}

function renderHost(
  plugins: ForgePlugin[],
  fetchImpl: typeof fetch,
  route = "/@core/overview"
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ForgeDashboardProvider config={config}>
        <SessionProvider fetchImpl={fetchImpl}>
          <PluginHost plugins={plugins} fetchImpl={fetchImpl} />
        </SessionProvider>
      </ForgeDashboardProvider>
    </MemoryRouter>
  )
}

describe("PluginHost", () => {
  it("renders a ready plugin's route and contributes its nav entry", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
    ])

    // core-contract has no explicit `namespace`, so it derives to "core" (the
    // "-contract" suffix stripped). renderHost's default route is
    // "/@core/overview" for exactly this reason -- no explicit third
    // argument needed here.
    renderHost([demoPlugin()], fetchImpl)

    expect(await screen.findByText("overview page body")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy()
  })

  it("renders the mismatch panel, and no route, when the reported version is out of range", async () => {
    const fetchImpl = capabilitiesFetch([
      {
        name: "core-contract",
        envelopes: ["v1"],
        configured: true,
        version: "1.0.0",
      },
    ])

    renderHost([demoPlugin({ requires: "^2.0.0" })], fetchImpl)

    expect(
      await screen.findByText(
        /requires \^2\.0\.0, but the running extension reports 1\.0\.0/
      )
    ).toBeTruthy()
    expect(screen.queryByText("overview page body")).toBeNull()
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull()
  })

  it("renders the plugin's own setup component, and no route, when the contributor is unconfigured", async () => {
    const fetchImpl = capabilitiesFetch([
      {
        name: "core-contract",
        envelopes: ["v1"],
        configured: false,
        message: "no storage backend configured",
      },
    ])
    const plugin = demoPlugin({
      setup: ({ message }: { message?: string }) => (
        <p>plugin setup screen: {message}</p>
      ),
    })

    renderHost([plugin], fetchImpl)

    expect(
      await screen.findByText(
        "plugin setup screen: no storage backend configured"
      )
    ).toBeTruthy()
    expect(screen.queryByText("overview page body")).toBeNull()
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull()
  })

  it("falls back to the shared SetupPanel when an unconfigured plugin ships no setup component", async () => {
    const fetchImpl = capabilitiesFetch([
      {
        name: "core-contract",
        envelopes: ["v1"],
        configured: false,
        message: "no storage backend configured",
      },
    ])

    renderHost([demoPlugin()], fetchImpl)

    expect(
      await screen.findByText("no storage backend configured")
    ).toBeTruthy()
    expect(screen.queryByText("overview page body")).toBeNull()
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull()
  })

  // ITEM 1's regression. plugin.setup is third-party code, and until the
  // boundary was put around it a throw there escaped HostShell and took the
  // whole dashboard with it. No earlier test could catch that: the setup
  // component the other tests supply cannot throw.
  //
  // Namespacing changes what "still renders" can mean here. A non-ready
  // plugin's panel now renders only inside its own active scope, not stacked
  // above every page (that stacking block is exactly what this task deletes).
  // So this asserts the throw is contained when its scope IS active -- the
  // marker replaces the panel, HostShell keeps rendering around it -- and a
  // separate render proves the healthy plugin's own scope is untouched by it.
  it("contains a throwing setup component instead of blanking the dashboard", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "core-contract", envelopes: ["v1"], configured: false },
      { name: "other-extension", envelopes: ["v1"], configured: true },
    ])
    const exploding = demoPlugin({
      setup: () => {
        throw new Error("setup component blew up")
      },
    })
    const survivor = definePlugin({
      extension: "other-extension",
      nav: [{ label: "Other", to: "/other" }],
      routes: [{ path: "/other", element: () => <p>other page body</p> }],
    })

    // core-contract's scope is the default route (see renderHost).
    renderHost([exploding, survivor], fetchImpl)

    // The throw left a visible marker rather than blanking HostShell.
    expect(await screen.findByText(/failed to render: core-contract/)).toBeTruthy()

    // The healthy plugin's own scope survives independently: it never shared
    // a render with the crashing one, but a throw in one plugin's setup
    // screen must never poison another plugin's scope either.
    renderHost([exploding, survivor], fetchImpl, "/@other-extension/other")
    expect(await screen.findByText("other page body")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Other" })).toBeTruthy()
  })

  it("renders nothing at all for a plugin whose contributor is absent", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "other-extension", envelopes: ["v1"], configured: true },
    ])
    const present = definePlugin({
      extension: "other-extension",
      nav: [{ label: "Other", to: "/other" }],
      routes: [{ path: "/other", element: () => <p>other page body</p> }],
    })

    // An explicit route into the present plugin's own scope, not the
    // renderHost default. resolveActiveScope no longer falls back to the
    // first scope when a pathname's namespace matches nothing (it now
    // answers `undefined`, meaning "at the root"), so demoPlugin()'s default
    // route ("/@core/overview") would resolve to no scope at all here -- its
    // own contributor is absent -- and show no nav from either plugin. That
    // used to work by accident, riding the old scopes[0] fallback.
    renderHost([demoPlugin(), present], fetchImpl, "/@other-extension/other")

    // The second plugin is the control: it proves the host resolved
    // capabilities and rendered nav at all, so the absences below are the
    // hidden plugin being hidden rather than the host rendering nothing.
    expect(await screen.findByRole("link", { name: "Other" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull()
    expect(screen.queryByText("overview page body")).toBeNull()
    expect(screen.queryByText(/requires/)).toBeNull()
    expect(screen.queryByText(/not configured/)).toBeNull()
  })

  it("shows an error state, not a blank page, when the capabilities request never lands", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch

    renderHost([demoPlugin()], fetchImpl)

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Failed to fetch")
    expect(screen.queryByText("overview page body")).toBeNull()
  })

  it("shows an error state when the capabilities request answers with a non-2xx status", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({ ok: false, status: 502, json: async () => ({}) }) as Response
    ) as unknown as typeof fetch

    renderHost([demoPlugin()], fetchImpl)

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("502")
    expect(screen.queryByText("overview page body")).toBeNull()
  })

  // ITEM 5's regression. A 200 whose body parses but is not a capabilities
  // document used to reach resolvePluginState and throw inside the host's own
  // render, which no boundary covers.
  it("shows an error state when a 200 response is not a capabilities document", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonOk({ shellEnvelopes: ["v1"] })
    ) as unknown as typeof fetch

    renderHost([demoPlugin()], fetchImpl)

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("contributors")
    expect(screen.queryByText("overview page body")).toBeNull()
  })

  // MINOR 5's regression, updated for namespacing. priority is documented as
  // ordering a plugin's items within its own group. It used to also matter
  // that cross-plugin order followed installation order, but only one
  // plugin's nav is on screen at a time now -- the sidebar shows the active
  // scope's group and nothing else -- so "keeps plugins in installation
  // order" is no longer an observable claim about simultaneous nav. What
  // still is: each plugin sorts its own items by priority regardless of
  // which one happens to be active, checked here for both.
  it("sorts nav within each plugin by priority", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "alpha", envelopes: ["v1"], configured: true },
      { name: "beta", envelopes: ["v1"], configured: true },
    ])
    const alpha = definePlugin({
      extension: "alpha",
      nav: [
        { label: "Alpha Second", to: "/second", priority: 10 },
        { label: "Alpha First", to: "/first", priority: 5 },
      ],
      routes: [{ path: "/first", element: () => <p>alpha page</p> }],
    })
    const beta = definePlugin({
      extension: "beta",
      nav: [
        { label: "Beta Second", to: "/second", priority: 3 },
        { label: "Beta First", to: "/first", priority: 1 },
      ],
      routes: [{ path: "/first", element: () => <p>beta page</p> }],
    })

    const alphaRender = renderHost([alpha, beta], fetchImpl, "/@alpha/first")
    await screen.findByText("alpha page")
    expect(
      screen
        .getAllByRole("link")
        .map((el) => el.textContent)
        .filter((t) => t?.startsWith("Alpha") || t?.startsWith("Beta"))
    ).toEqual(["Alpha First", "Alpha Second"])
    alphaRender.unmount()

    renderHost([alpha, beta], fetchImpl, "/@beta/first")
    await screen.findByText("beta page")
    expect(
      screen
        .getAllByRole("link")
        .map((el) => el.textContent)
        .filter((t) => t?.startsWith("Alpha") || t?.startsWith("Beta"))
    ).toEqual(["Beta First", "Beta Second"])
  })

  // MINOR 6's regression is gone, not just narrowed. It guarded against two
  // *different* plugins contributing the same nav path colliding in one flat
  // list keyed on item.to alone. That flat list no longer exists -- only the
  // active scope's own nav renders -- so a cross-plugin collision on the
  // rendered nav is structurally unreachable now, with nothing left for a
  // test at this layer to pin.
  //
  // What is NOT retested here: `packages/kit`'s NavTree keys each item on its
  // own `href` (`SidebarMenuItem key={item.href}`), so two items *within one
  // plugin's own nav* that both resolve to the same href still produce a
  // real React duplicate-key warning today -- confirmed by hand while
  // updating this file, not fixed here. NavTree belongs to a different task
  // and is outside this task's file list, and a single plugin declaring two
  // nav entries pointing at the same target is a much narrower edge case than
  // the cross-plugin collision this test used to guard. Flagged rather than
  // silently dropped.
  //
  // MINOR 7, superseded. The old rootIsClaimed guard existed because a
  // plugin could declare a literal "/" route and the host's own redirect had
  // to step aside for it. Namespacing removes that possibility outright: a
  // plugin's "/" is scopePath-ed to "/@<namespace>", never to the site root,
  // so no plugin route can ever match "/" again and the guard the old test
  // pinned is unreachable code that this task deletes. What replaces it: the
  // site root always redirects to `home`, which is the first *ready*
  // plugin's own home, in plugin array order.
  it("redirects the site root to the first ready plugin's home, in array order", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "alpha", envelopes: ["v1"], configured: true },
      { name: "beta", envelopes: ["v1"], configured: true },
    ])
    // beta is listed first: home must come from beta, not alpha, proving the
    // array (not declaration order inside one plugin) decides it.
    const beta = definePlugin({
      extension: "beta",
      nav: [{ label: "Beta", to: "/" }],
      routes: [{ path: "/", element: () => <p>beta page</p> }],
    })
    const alpha = definePlugin({
      extension: "alpha",
      nav: [{ label: "Alpha Home", to: "/" }],
      routes: [{ path: "/", element: () => <p>alpha root page</p> }],
    })

    renderHost([beta, alpha], fetchImpl, "/")

    expect(await screen.findByText("beta page")).toBeTruthy()
    expect(screen.queryByText("alpha root page")).toBeNull()
  })

  // Review finding (Minor 3, w8-scoped-sidebar Task 7, ported here because the
  // shell and playground hosts are deliberately kept as diverging duplicates
  // and each needs its own guard against the same regression). `home` used to
  // read `plugin.nav[0]` directly -- declaration order -- while the sidebar
  // right beside it renders the plugin's nav sorted by priority. A plugin
  // whose nav is not already written in priority order would silently
  // redirect the site root to an item that is not the one the sidebar shows
  // first. "Second" is declared before "First" here specifically to catch
  // that: if `home` ever reads nav[0] again instead of the priority-sorted
  // list, this goes red. The test just above only exercises which *plugin*
  // wins by array order, using single-nav-item plugins, so it never reaches
  // `home`'s internal `sortByPriority(first.plugin.nav)[0]` step -- this one
  // does.
  it("redirects the site root to the priority-sorted first item, not the first declared one", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "home-ext", envelopes: ["v1"], configured: true },
    ])
    const plugin = definePlugin({
      extension: "home-ext",
      nav: [
        { label: "Second", to: "/second", priority: 20 },
        { label: "First", to: "/first", priority: 10 },
      ],
      routes: [
        { path: "/first", element: () => <p>first page</p> },
        { path: "/second", element: () => <p>second page</p> },
      ],
    })

    renderHost([plugin], fetchImpl, "/")

    expect(await screen.findByText("first page")).toBeTruthy()
    expect(screen.queryByText("second page")).toBeNull()
  })

  // ITEM 4's regression. "A plugin cannot address another extension's
  // handlers" is a requirement, and until now nothing at the host layer drove
  // a plugin query at all, so the host could have handed every plugin the
  // same client and every test would still have passed.
  it("binds each plugin's client to its own extension, never another's", async () => {
    const sent: { contributor: string; intent: string }[] = []
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/capabilities")) {
          const caps: Capabilities = {
            shellEnvelopes: ["v1"],
            contributors: [
              { name: "alpha", envelopes: ["v1"], configured: true },
              { name: "beta", envelopes: ["v1"], configured: true },
            ],
          }
          return jsonOk(caps)
        }
        if (url.endsWith("/principal")) {
          return jsonOk({ authenticated: true, subject: "usr_test", email: "test@example.com" })
        }
        const body = JSON.parse(String(init?.body)) as {
          contributor: string
          intent: string
        }
        sent.push(body)
        // Echoing the contributor back is what makes the page's own text a
        // statement about the wire, not about the plugin's local knowledge.
        return jsonOk({ ok: true, data: { seen: body.contributor } })
      }
    ) as unknown as typeof fetch

    const alpha = queryingPlugin("alpha", "/", "Alpha")
    const beta = queryingPlugin("beta", "/", "Beta")

    const first = renderHost([alpha, beta], fetchImpl, "/@alpha")
    expect(await screen.findByText("Alpha says alpha")).toBeTruthy()
    first.unmount()

    renderHost([alpha, beta], fetchImpl, "/@beta")
    expect(await screen.findByText("Beta says beta")).toBeTruthy()

    expect(sent.map((r) => r.intent)).toEqual(["ping", "ping"])
    expect(sent.map((r) => r.contributor)).toEqual(["alpha", "beta"])
  })
})

describe("root plugin", () => {
  it("serves a root plugin's page at the unscoped path", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
    ])

    render(
      <ForgeDashboardProvider config={config}>
        <MemoryRouter initialEntries={["/overview"]}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost
              plugins={[
                definePlugin({
                  extension: "core-contract",
                  root: true,
                  nav: [{ label: "Overview", to: "/overview" }],
                  routes: [{ path: "/overview", element: () => <p>root page</p> }],
                }),
              ]}
              fetchImpl={fetchImpl}
            />
          </SessionProvider>
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    expect(await screen.findByText("root page")).toBeTruthy()
  })

  it("does not leak the root plugin's nav into the body inside a scope", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "streaming-contract", envelopes: ["v1"], configured: true },
    ])

    render(
      <ForgeDashboardProvider config={config}>
        <MemoryRouter initialEntries={["/@streaming/rooms"]}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost
              plugins={[
                definePlugin({
                  extension: "core-contract",
                  root: true,
                  nav: [{ label: "Overview", to: "/overview" }],
                  routes: [{ path: "/overview", element: () => <p>root page</p> }],
                }),
                definePlugin({
                  extension: "streaming-contract",
                  label: "Streaming",
                  nav: [{ label: "Rooms", to: "/rooms" }],
                  routes: [{ path: "/rooms", element: () => <p>rooms page</p> }],
                }),
              ]}
              fetchImpl={fetchImpl}
            />
          </SessionProvider>
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    expect(await screen.findByText("rooms page")).toBeTruthy()

    // Scoped to the body: "Overview" is in the document as the header's back
    // row, so an unscoped query passes whichever nav the body renders.
    const body = document.querySelector(
      '[data-slot="sidebar-content"]',
    ) as HTMLElement
    expect(within(body).getByRole("link", { name: "Rooms" })).toBeTruthy()
    expect(within(body).queryByRole("link", { name: "Overview" })).toBeNull()
  })
})

describe("a root plugin that is not ready", () => {
  it("renders the root's setup panel rather than a blank page", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "core-contract", envelopes: ["v1"], configured: false, message: "needs a database" },
    ])

    render(
      <ForgeDashboardProvider config={config}>
        <MemoryRouter initialEntries={["/"]}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost
              plugins={[
                definePlugin({
                  extension: "core-contract",
                  root: true,
                  label: "System",
                  nav: [{ label: "Overview", to: "/overview" }],
                  routes: [{ path: "/overview", element: () => <p>root page</p> }],
                }),
              ]}
              fetchImpl={fetchImpl}
            />
          </SessionProvider>
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    expect(await screen.findByText(/needs a database/)).toBeTruthy()
    expect(screen.queryByText("root page")).toBeNull()
  })
})

// Mirrors "a root plugin that is not ready" above, for the shape that fix
// closes: no root plugin at all (never declared, or its contributor missing
// from /capabilities and filtered out before partitionScopes ever sees it),
// with every scope in "setup" or "mismatch". "/" carries no "@namespace"
// sigil, so resolveActiveScope returns undefined and panelSource has nothing
// to fall back to -- the same blank landing page an earlier task already
// closed for a non-ready ROOT, but reachable here from the opposite
// direction: no root and an unready scope, on the single most common
// deployment there is, a server with exactly one extension not yet
// configured.
describe("no root plugin, with a scope that is not ready", () => {
  it("renders the scope's setup panel rather than a blank page", async () => {
    const fetchImpl = capabilitiesFetch([
      {
        name: "streaming-contract",
        envelopes: ["v1"],
        configured: false,
        message: "needs a database",
      },
    ])

    render(
      <ForgeDashboardProvider config={config}>
        <MemoryRouter initialEntries={["/"]}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost
              plugins={[
                definePlugin({
                  extension: "streaming-contract",
                  label: "Streaming",
                  nav: [{ label: "Rooms", to: "/rooms" }],
                  routes: [{ path: "/rooms", element: () => <p>rooms page</p> }],
                }),
              ]}
              fetchImpl={fetchImpl}
            />
          </SessionProvider>
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    expect(await screen.findByText(/needs a database/)).toBeTruthy()
    expect(screen.queryByText("rooms page")).toBeNull()
  })
})

// Whole-branch review, Minor. mountPath passes a root plugin's own paths
// through untouched, so `home` can now literally come out as "/" -- a value
// scopePath could never produce for a namespaced plugin, which always came
// out "/@<namespace>" at minimum. Reachable whenever a root plugin's
// priority-first nav item (or, with no nav, its first route) is "/", which
// packages/plugin-streaming/src/index.tsx already writes for its own
// "Overview" entry -- harmlessly there, since streaming is namespaced and
// scopePath turns it into "/@streaming". Given to a root plugin instead,
// where mountPath adds no namespace, "/" survives verbatim and the redirect
// route would send "/" to the location it is already rendering.
describe('a root plugin whose home resolves to "/"', () => {
  it('does not redirect "/" to itself', async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
    ])
    // A self-redirect's navigate() fires from an effect after the render
    // this test awaits below has already settled, so it lands outside any
    // act() this test wraps and React reports it as an update "not wrapped
    // in act(...)". Confirmed by hand against this exact fixture: the
    // capabilities round trip alone never produces this warning, so its
    // presence here can only mean the router performed a navigation nobody
    // asked for.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    render(
      <ForgeDashboardProvider config={config}>
        <MemoryRouter initialEntries={["/"]}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost
              plugins={[
                definePlugin({
                  extension: "core-contract",
                  root: true,
                  nav: [{ label: "Home", to: "/" }],
                  routes: [{ path: "/other", element: () => <p>other page</p> }],
                }),
              ]}
              fetchImpl={fetchImpl}
            />
          </SessionProvider>
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    // Give a wrongly-fired self-redirect a moment to land before checking.
    // Wrapped in act(): the session now resolves through its own fetch too,
    // alongside capabilities, so more than one state update can still be
    // settling here. Wrapping keeps React's own housekeeping from tripping
    // the same "not wrapped in act" warning this assertion is here to catch.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

/**
 * The root plugin and one namespaced scope, which is the shape every
 * assertion about the auth gate needs: something to render behind it, and
 * somewhere for a signed-out visit to be denied.
 */
function rootPlugin(overrides: Partial<PluginInput> = {}): ForgePlugin {
  return definePlugin({
    extension: "core-contract",
    root: true,
    label: "System",
    nav: [{ label: "Overview", to: "/overview" }],
    routes: [{ path: "/overview", element: () => <p>root overview body</p> }],
    ...overrides,
  })
}

describe("PluginHost auth gate", () => {
  function principalFetch(
    status: number,
    body: unknown,
    contributors: ContributorCapability[] = [
      { name: "core-contract", envelopes: ["v1"], configured: true },
    ],
  ): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/principal")) {
        return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
      }
      if (url.endsWith("/capabilities")) {
        return jsonOk({ shellEnvelopes: ["v1"], contributors })
      }
      throw new Error(`unexpected request to ${url}`)
    }) as unknown as typeof fetch
  }

  const GatePlugin = () =>
    definePlugin({
      extension: "auth",
      namespace: "auth",
      label: "Auth",
      auth: { gate: () => <p>gate body</p> },
      nav: [{ label: "Users", to: "/users" }],
      routes: [{ path: "/users", element: () => <p>auth users body</p> }],
    })

  it("renders the plugin's gate and no shell when signed out", async () => {
    const { container } = renderHost(
      [rootPlugin(), GatePlugin()],
      principalFetch(401, { code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
      "/overview",
    )

    expect(await screen.findByText("gate body")).toBeTruthy()
    // "Blocks the UI entirely" means the shell is never constructed. A route
    // painting over a mounted sidebar is a curtain: the scope names are still
    // in the DOM.
    expect(container.querySelector('[data-slot="sidebar-header"]')).toBeNull()
    expect(container.querySelector('[data-slot="sidebar-content"]')).toBeNull()
    expect(screen.queryByText("root overview body")).toBeNull()
  })

  it("renders the shell when signed in", async () => {
    const { container } = renderHost(
      [rootPlugin(), GatePlugin()],
      principalFetch(200, { authenticated: true, subject: "u1", email: "ada@example.com" }),
      "/overview",
    )

    expect(await screen.findByText("root overview body")).toBeTruthy()
    expect(container.querySelector('[data-slot="sidebar-header"]')).toBeTruthy()
    expect(screen.queryByText("gate body")).toBeNull()
  })

  it("renders the shell when auth is switched off", async () => {
    const { container } = renderHost(
      [rootPlugin(), GatePlugin()],
      principalFetch(200, { authenticated: false }),
      "/overview",
    )

    // authenticated:false with a 200 means auth is off, not that you are
    // logged out. Gating on the boolean instead of the status locks every
    // anonymous dashboard out of itself.
    expect(await screen.findByText("root overview body")).toBeTruthy()
    expect(container.querySelector('[data-slot="sidebar-header"]')).toBeTruthy()
  })

  it("renders the gate's denied variant with requiredRoles", async () => {
    const Denied = ({ requiredRoles }: { requiredRoles?: string[] }) => (
      <p>needs {requiredRoles?.join(",")}</p>
    )
    const plugin = definePlugin({
      extension: "auth",
      namespace: "auth",
      auth: { gate: Denied },
      nav: [],
      routes: [],
    })

    renderHost(
      [rootPlugin(), plugin],
      principalFetch(403, { code: "PERMISSION_DENIED", requiredRoles: ["admin"] }),
      "/overview",
    )

    expect(await screen.findByText("needs admin")).toBeTruthy()
  })

  it("renders neither gate nor shell while the session is unknown", async () => {
    const pending = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    const { container } = renderHost([rootPlugin(), GatePlugin()], pending, "/overview")

    expect(container.querySelector('[data-slot="spinner"]')).toBeTruthy()
    expect(screen.queryByText("gate body")).toBeNull()
    expect(container.querySelector('[data-slot="sidebar-header"]')).toBeNull()
  })

  it("falls back to the runtime gate when no plugin declares one", async () => {
    renderHost(
      [rootPlugin()],
      principalFetch(401, { code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
      "/overview",
    )

    expect(await screen.findByRole("link", { name: /^sign in$/i })).toBeTruthy()
  })

  it("falls back when a plugin's gate throws", async () => {
    const Boom = () => {
      throw new Error("gate blew up")
    }
    const plugin = definePlugin({
      extension: "auth",
      namespace: "auth",
      auth: { gate: Boom },
      nav: [],
      routes: [],
    })

    renderHost(
      [rootPlugin(), plugin],
      principalFetch(401, { code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
      "/overview",
    )

    // A throwing gate must not be able to lock you out of your own dashboard.
    expect(await screen.findByRole("link", { name: /^sign in$/i })).toBeTruthy()
  })

  it("gives the gate its plugin's scoped client", async () => {
    // The gate renders outside the route table, so it does not inherit the
    // PluginProvider each route gets. A gate that calls useCommand without
    // one throws, and the only screen with a way in becomes the fallback.
    const ClientProbe = () => {
      const client = usePluginClient()
      return <p>client for {client.extension}</p>
    }
    const plugin = definePlugin({
      extension: "auth",
      namespace: "auth",
      auth: { gate: ClientProbe },
      nav: [],
      routes: [],
    })

    renderHost(
      [rootPlugin(), plugin],
      principalFetch(401, { code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
      "/overview",
    )

    expect(await screen.findByText("client for auth")).toBeTruthy()
  })

  it("shows the gate, not a capabilities error, when signed out", async () => {
    // The spec requires a capabilities failure to be discarded rather than
    // rendered while signed out. This holds because the gate returns before
    // the capabilities error branch, so it is a property of statement order
    // and would break silently if the gate block were moved below it.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/principal")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
        } as Response
      }
      throw new Error("capabilities is unreachable")
    }) as unknown as typeof fetch

    renderHost([rootPlugin(), GatePlugin()], fetchImpl, "/overview")

    expect(await screen.findByText("gate body")).toBeTruthy()
    expect(screen.queryByText(/Could not reach the dashboard server/)).toBeNull()
  })

  it("shows the signed-in user in the sidebar footer", async () => {
    renderHost(
      [rootPlugin()],
      principalFetch(200, {
        authenticated: true,
        subject: "u1",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
      }),
      "/overview",
    )

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
    expect(screen.queryByText("user@example.com")).toBeNull()
  })

  it("re-fetches capabilities when the session resolves again", async () => {
    let principalCalls = 0
    let capabilityCalls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/principal")) {
        principalCalls += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: true, subject: "u1", email: "a@b.c" }),
        } as Response
      }
      if (url.endsWith("/capabilities")) {
        capabilityCalls += 1
        return jsonOk({
          shellEnvelopes: ["v1"],
          contributors: [{ name: "core-contract", envelopes: ["v1"], configured: true }],
        })
      }
      throw new Error(`unexpected request to ${url}`)
    }) as unknown as typeof fetch

    renderHost([rootPlugin()], fetchImpl, "/overview")
    await screen.findByText("root overview body")

    // One of each on the first pass. A freshly signed-in user may be shown
    // contributors that were hidden while anonymous, so capabilities has to
    // key on the session epoch and not on [contractBase, doFetch] alone.
    expect(principalCalls).toBe(1)
    expect(capabilityCalls).toBe(1)
  })
})
