import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
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

    renderHost([demoPlugin(), present], fetchImpl)

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
})
