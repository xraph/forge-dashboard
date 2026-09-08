import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useParams } from "react-router"
import { ForgeDashboardProvider } from "@forge-go/dashboard-runtime"
import { definePlugin, useQuery } from "@forge-go/dashboard-plugin"
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
        <PluginHost plugins={plugins} fetchImpl={fetchImpl} />
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
  // updating this file, not fixed here. NavTree belongs to Tasks 4/6, is
  // outside this task's file list, and a single plugin declaring two nav
  // entries pointing at the same target is a much narrower edge case than
  // the cross-plugin collision this test used to guard. Flagged rather than
  // silently dropped.
  //
  // MINOR 7, superseded. The old rootIsClaimed guard existed because a
  // plugin could declare a literal "/" route and the host's own redirect had
  // to step aside for it. Namespacing removes that possibility outright: a
  // plugin's "/" is scopePath-ed to "/@<namespace>", never to the site root,
  // so no plugin route can ever match "/" again and the guard the old test
  // pinned is unreachable code that Task 7 deletes. What replaces it: the
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

  // Review finding (Minor 3, w8-scoped-sidebar Task 7). `home` used to read
  // `plugin.nav[0]` directly -- declaration order -- while the sidebar right
  // beside it renders the plugin's nav sorted by priority. A plugin whose
  // nav is not already written in priority order would silently redirect
  // the site root to an item that is not the one the sidebar shows first.
  // "Second" is declared before "First" here specifically to catch that: if
  // `home` ever reads nav[0] again instead of the priority-sorted list, this
  // goes red.
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

  // Same review finding, the other call site. `selectScope` is reached by
  // picking a scope from the ScopeSwitcher, and it had the identical nav[0]
  // bug. It went unpinned for a while because opening a base-ui dropdown
  // under jsdom used to cost 15 to 52 seconds per interaction, which made
  // this test too slow and too flaky to keep. That turned out to be an
  // nwsapi recursion rather than anything base-ui does, and
  // packages/test-support/jsdom-setup.ts short-circuits it, so the same
  // interaction now runs in milliseconds. `selectScope` and `home` share one
  // `sortByPriority` helper, and the "site root" test above covers the helper
  // itself; what this one adds is the call site, which a future change could
  // break on its own.
  it("selects a scope by its priority-sorted first item, not its first declared one", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "gateway-contract", envelopes: ["v1"], configured: true },
    ])
    const gateway = definePlugin({
      extension: "gateway-contract",
      nav: [
        { label: "Gateway Second", to: "/second", priority: 20 },
        { label: "Gateway First", to: "/first", priority: 10 },
      ],
      routes: [
        { path: "/first", element: () => <p>gateway first page</p> },
        { path: "/second", element: () => <p>gateway second page</p> },
      ],
    })

    renderHost([demoPlugin(), gateway], fetchImpl)
    expect(await screen.findByText("overview page body")).toBeTruthy()

    fireEvent.click(
      await screen.findByRole("button", { name: /core-contract/ })
    )
    fireEvent.click(
      screen.getByRole("menuitem", { name: /gateway-contract/ })
    )

    expect(await screen.findByText("gateway first page")).toBeTruthy()
    expect(screen.queryByText("gateway second page")).toBeNull()
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

  // W5's integration case, and the first time this host has been asked to hold
  // three plugins at once. Everything before it ran with one or two, all of
  // them in the same state.
  //
  // The three states are the three the resolver can reach from a real
  // capabilities document: ready, unconfigured, and absent. Absent is the one
  // worth having in the fixture even though it asserts an absence -- a
  // contributor the server never mentions is what a shell sees whenever it was
  // built with a plugin the deployment does not run, which is the normal case
  // for a first-party set compiled in unconditionally.
  //
  // Updated for namespacing: a non-ready plugin's panel now renders only
  // inside its own active scope rather than stacking above every page, so
  // "ready" and "setup" can no longer both be asserted from one render. Two
  // renders cover it instead -- the ready scope active, then the setup scope
  // active -- and the absent plugin's total silence is checked in both,
  // because "absent" does not depend on which scope is active.
  it("resolves three plugins in three different states, one active scope at a time", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "ready-ext", envelopes: ["v1"], configured: true },
      {
        name: "setup-ext",
        envelopes: ["v1"],
        configured: false,
        message: "setup-ext has no backend configured",
      },
      // absent-ext is deliberately not here.
    ])
    const readyPlugin = definePlugin({
      extension: "ready-ext",
      nav: [
        { label: "Ready Two", to: "/two", priority: 20 },
        { label: "Ready One", to: "/one", priority: 10 },
      ],
      routes: [{ path: "/one", element: () => <p>ready page body</p> }],
    })
    const setupPlugin = definePlugin({
      extension: "setup-ext",
      nav: [{ label: "Setup Nav", to: "/" }],
      routes: [{ path: "/", element: () => <p>setup page body</p> }],
    })
    const absentPlugin = definePlugin({
      extension: "absent-ext",
      nav: [{ label: "Absent Nav", to: "/" }],
      routes: [{ path: "/", element: () => <p>absent page body</p> }],
    })

    const ready = renderHost(
      [readyPlugin, setupPlugin, absentPlugin],
      fetchImpl,
      "/@ready-ext/one"
    )

    expect(await screen.findByText("ready page body")).toBeTruthy()

    // Nav carries the active (ready) plugin's entries and nobody else's,
    // sorted within that plugin by priority.
    expect(
      screen
        .getAllByRole("link")
        .map((el) => el.textContent)
        .filter((t) => t?.startsWith("Ready"))
    ).toEqual(["Ready One", "Ready Two"])

    // The unconfigured plugin is not this scope, so neither its panel nor
    // its nav appears here.
    expect(screen.queryByText("setup-ext has no backend configured")).toBeNull()
    expect(screen.queryByText("setup page body")).toBeNull()
    expect(screen.queryByText("Setup Nav")).toBeNull()

    // The absent plugin is silent in every direction: no nav, no page, and no
    // panel explaining itself.
    expect(screen.queryByText("Absent Nav")).toBeNull()
    expect(screen.queryByText("absent page body")).toBeNull()
    expect(screen.queryByText(/absent-ext/)).toBeNull()

    ready.unmount()

    renderHost(
      [readyPlugin, setupPlugin, absentPlugin],
      fetchImpl,
      "/@setup-ext"
    )

    // Now the unconfigured plugin's own scope is active: its panel shows,
    // and the ready plugin's page and nav are gone because they belong to a
    // different scope.
    expect(
      await screen.findByText("setup-ext has no backend configured")
    ).toBeTruthy()
    expect(screen.queryByText("ready page body")).toBeNull()
    expect(screen.queryByText("Ready One")).toBeNull()
    expect(screen.queryByText("setup page body")).toBeNull()

    // Absent is still silent.
    expect(screen.queryByText("Absent Nav")).toBeNull()
    expect(screen.queryByText("absent page body")).toBeNull()
    expect(screen.queryByText(/absent-ext/)).toBeNull()
  })

  // The error boundary's whole purpose, finally exercised with real
  // neighbours. Until now one plugin threw and one plugin watched; the setup
  // path had that test and the route path had none at all.
  //
  // Namespacing removes the mechanism the old version of this test used to
  // prove isolation: nav no longer holds a cross-plugin link to click
  // through, because only the active scope's own nav renders (that stacked
  // "all plugins at once" nav is exactly what this task deletes). So each
  // neighbour is checked as its own active scope instead of three states
  // sharing one render. This still proves the same three things the old
  // comment named: the throw is contained (a marker, not a blank page), a
  // panel-only neighbour is unaffected, and a page-only neighbour is
  // unaffected -- just via three renders instead of one render plus a click.
  //
  // The click-through DISCRIMINATOR this test used to carry (delete the
  // boundary's key and a stale "failed to render" latches onto the next
  // plugin you open) still has a live regression test: "contains a throwing
  // param route on one id without latching the next id", below, which
  // navigates within a single scope and therefore still exercises a real
  // client-side <Routes> switch inside one mount.
  it("contains a throwing route without taking its neighbours down with it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    const fetchImpl = capabilitiesFetch([
      { name: "boom-ext", envelopes: ["v1"], configured: true },
      { name: "steady-ext", envelopes: ["v1"], configured: true },
      {
        name: "needy-ext",
        envelopes: ["v1"],
        configured: false,
        message: "needy-ext has no backend configured",
      },
    ])
    const boom = definePlugin({
      extension: "boom-ext",
      nav: [{ label: "Boom", to: "/boom" }],
      routes: [
        {
          path: "/boom",
          element: () => {
            throw new Error("route element blew up")
          },
        },
      ],
    })
    const steady = definePlugin({
      extension: "steady-ext",
      nav: [{ label: "Steady", to: "/steady" }],
      routes: [{ path: "/steady", element: () => <p>steady page body</p> }],
    })
    const needy = definePlugin({
      extension: "needy-ext",
      nav: [{ label: "Needy", to: "/" }],
      routes: [{ path: "/", element: () => <p>needy page body</p> }],
    })
    const plugins = [boom, steady, needy]

    // The throw is contained and leaves a marker rather than an empty gap.
    const boomRender = renderHost(plugins, fetchImpl, "/@boom-ext/boom")
    expect(await screen.findByText(/failed to render: boom-ext/)).toBeTruthy()
    boomRender.unmount()

    // The panel-only neighbour is unaffected: its own scope still shows its
    // setup panel, not any trace of boom's crash.
    const needyRender = renderHost(plugins, fetchImpl, "/@needy-ext")
    expect(
      await screen.findByText("needy-ext has no backend configured")
    ).toBeTruthy()
    expect(screen.queryByText(/failed to render/)).toBeNull()
    needyRender.unmount()

    // The page-only neighbour is unaffected: its own scope still renders its
    // page normally.
    renderHost(plugins, fetchImpl, "/@steady-ext/steady")
    expect(await screen.findByText("steady page body")).toBeTruthy()
    expect(screen.queryByText(/failed to render/)).toBeNull()

    spy.mockRestore()
  })

  // ITEM 1's regression. The boundary above is keyed
  // `${plugin.extension}:${route.path}`, and route.path is the pattern
  // (`/users/:id`), not the resolved location. Every id served by that one
  // route shares a single <Route> element and therefore a single boundary
  // instance, so a throw on one id latches "failed to render" for every id
  // that follows -- the same bug the route-vs-route test above already
  // covers one level up, just one level down at the param level.
  //
  // DISCRIMINATOR: keying on route.path (the pattern) instead of the
  // resolved pathname leaves this red, because navigating from /users/1 to
  // /users/2 does not change the key and React keeps the crashed instance.
  it("contains a throwing param route on one id without latching the next id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})

    const fetchImpl = capabilitiesFetch([
      { name: "detail-ext", envelopes: ["v1"], configured: true },
    ])
    function Detail() {
      const { id } = useParams()
      if (id === "1") {
        throw new Error("user 1 blew up")
      }
      return <p>user detail: {id}</p>
    }
    const detail = definePlugin({
      extension: "detail-ext",
      nav: [
        { label: "User 1", to: "/users/1" },
        { label: "User 2", to: "/users/2" },
      ],
      routes: [{ path: "/users/:id", element: Detail }],
    })

    renderHost([detail], fetchImpl, "/@detail-ext/users/1")

    expect(await screen.findByText(/failed to render: detail-ext/)).toBeTruthy()

    const link = screen.getByRole("link", { name: "User 2" })
    fireEvent.click(link)

    expect(await screen.findByText("user detail: 2")).toBeTruthy()
    expect(screen.queryByText(/failed to render/)).toBeNull()

    spy.mockRestore()
  })

  // Superseded by namespacing. Two plugins used to be able to declare the
  // literal same route path and silently collide, with the first one in the
  // plugins array winning and the second one's page becoming unreachable.
  // That is exactly the failure mode namespacing removes: every plugin's
  // routes are mounted under its own "@namespace", so the same relative path
  // declared by two different plugins never collides at all -- each is
  // reachable at its own scoped URL. Pinned as the replacement behaviour: no
  // collision, no silent winner, both pages render at their own address.
  it("mounts two plugins' identical relative path independently, with no collision", async () => {
    const messages: string[] = []
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        messages.push(args.map(String).join(" "))
      })
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((...args: unknown[]) => {
        messages.push(args.map(String).join(" "))
      })

    const fetchImpl = capabilitiesFetch([
      { name: "alpha", envelopes: ["v1"], configured: true },
      { name: "beta", envelopes: ["v1"], configured: true },
    ])
    const alpha = definePlugin({
      extension: "alpha",
      nav: [{ label: "Alpha Shared", to: "/shared" }],
      routes: [{ path: "/shared", element: () => <p>alpha owns it</p> }],
    })
    const beta = definePlugin({
      extension: "beta",
      nav: [{ label: "Beta Shared", to: "/shared" }],
      routes: [{ path: "/shared", element: () => <p>beta owns it</p> }],
    })
    const plugins = [alpha, beta]

    const alphaRender = renderHost(plugins, fetchImpl, "/@alpha/shared")
    expect(await screen.findByText("alpha owns it")).toBeTruthy()
    expect(screen.queryByText("beta owns it")).toBeNull()
    alphaRender.unmount()

    renderHost(plugins, fetchImpl, "/@beta/shared")
    expect(await screen.findByText("beta owns it")).toBeTruthy()
    expect(screen.queryByText("alpha owns it")).toBeNull()

    errorSpy.mockRestore()
    warnSpy.mockRestore()
    // Silent in the sense that matters now: no duplicate-key complaint from
    // React, no route warning from react-router, nothing from the host --
    // because there was never a collision to warn about.
    expect(messages).toEqual([])
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
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    expect(await screen.findByText("root page")).toBeTruthy()
  })

  it("keeps the root plugin's nav visible while inside a scope", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "core-contract", envelopes: ["v1"], configured: true },
      { name: "streaming-contract", envelopes: ["v1"], configured: true },
    ])

    render(
      <ForgeDashboardProvider config={config}>
        <MemoryRouter initialEntries={["/@streaming/rooms"]}>
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
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    expect(await screen.findByText("rooms page")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy()
  })
})

describe("scoped routing", () => {
  it("resolves a deep plugin URL to its own scope", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "streaming-contract", envelopes: ["v1"], configured: true },
    ])

    render(
      <ForgeDashboardProvider config={config}>
        <MemoryRouter initialEntries={["/@streaming/rooms"]}>
          <PluginHost
            plugins={[
              definePlugin({
                extension: "streaming-contract",
                label: "Streaming",
                nav: [
                  { label: "Overview", to: "/" },
                  { label: "Rooms", to: "/rooms" },
                ],
                routes: [
                  { path: "/", element: () => <p>streaming home</p> },
                  { path: "/rooms", element: () => <p>rooms page</p> },
                ],
              }),
            ]}
            fetchImpl={fetchImpl}
          />
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    expect(await screen.findByText("rooms page")).toBeTruthy()
    expect(screen.getByText("Streaming")).toBeTruthy()
    expect(screen.getByText("@streaming")).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Rooms" }).closest("[data-active]"),
    ).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Rooms" })).toBeTruthy()
  })

  it("renders no pill nav above the content", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "streaming-contract", envelopes: ["v1"], configured: true },
    ])

    render(
      <ForgeDashboardProvider config={config}>
        <MemoryRouter initialEntries={["/@streaming/rooms"]}>
          <PluginHost
            plugins={[
              definePlugin({
                extension: "streaming-contract",
                nav: [{ label: "Rooms", to: "/rooms" }],
                routes: [{ path: "/rooms", element: () => <p>rooms page</p> }],
              }),
            ]}
            fetchImpl={fetchImpl}
          />
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    await screen.findByText("rooms page")
    expect(screen.queryByLabelText("Plugin pages")).toBeNull()
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
        </MemoryRouter>
      </ForgeDashboardProvider>,
    )

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    // Give a wrongly-fired self-redirect a moment to land before checking.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
