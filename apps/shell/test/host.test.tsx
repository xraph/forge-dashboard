import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ForgeDashboardProvider } from "@forge/dashboard-runtime"
import { definePlugin, useQuery } from "@forge/dashboard-plugin"
import type {
  Capabilities,
  ContributorCapability,
  ForgePlugin,
  PluginInput,
} from "@forge/dashboard-plugin"
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
  route = "/overview"
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

    renderHost([exploding, survivor], fetchImpl, "/other")

    // The other plugin's page still renders, which is the whole claim: one
    // plugin throwing takes down its own box, not the dashboard.
    expect(await screen.findByText("other page body")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Other" })).toBeTruthy()
    // And the throw left a visible marker rather than an empty gap.
    expect(screen.getByText(/failed to render: core-contract/)).toBeTruthy()
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

  // MINOR 5's regression. priority is documented as ordering a plugin's items
  // within its own group, and cross-plugin nav order is installation order.
  // Sorting the flattened list broke both, and only looked right because
  // Array.prototype.sort is stable and every priority defaults to 0. These
  // two plugins interleave under a global sort: alpha's 10 would fall behind
  // beta's 1.
  it("sorts nav within each plugin and keeps plugins in installation order", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "alpha", envelopes: ["v1"], configured: true },
      { name: "beta", envelopes: ["v1"], configured: true },
    ])
    const alpha = definePlugin({
      extension: "alpha",
      nav: [
        { label: "Alpha Second", to: "/alpha/second", priority: 10 },
        { label: "Alpha First", to: "/alpha/first", priority: 5 },
      ],
      routes: [{ path: "/alpha/first", element: () => <p>alpha page</p> }],
    })
    const beta = definePlugin({
      extension: "beta",
      nav: [
        { label: "Beta Second", to: "/beta/second", priority: 3 },
        { label: "Beta First", to: "/beta/first", priority: 1 },
      ],
      routes: [{ path: "/beta/first", element: () => <p>beta page</p> }],
    })

    renderHost([alpha, beta], fetchImpl, "/alpha/first")

    await screen.findByText("alpha page")
    const links = screen
      .getAllByRole("link")
      .map((el) => el.textContent)
      .filter((t) => t?.startsWith("Alpha") || t?.startsWith("Beta"))

    expect(links).toEqual([
      "Alpha First",
      "Alpha Second",
      "Beta First",
      "Beta Second",
    ])
  })

  // MINOR 6's regression. Keying on item.to alone collides the moment two
  // plugins contribute the same path, which is not exotic: /settings is the
  // obvious one. React reports that on console.error and then renders one of
  // the two, so nothing else here would notice.
  it("keys nav on extension and path, so two plugins can contribute the same path", async () => {
    const errors: unknown[][] = []
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args)
      })

    const fetchImpl = capabilitiesFetch([
      { name: "alpha", envelopes: ["v1"], configured: true },
      { name: "beta", envelopes: ["v1"], configured: true },
    ])
    const alpha = definePlugin({
      extension: "alpha",
      nav: [{ label: "Alpha Settings", to: "/settings" }],
      routes: [{ path: "/alpha", element: () => <p>alpha page</p> }],
    })
    const beta = definePlugin({
      extension: "beta",
      nav: [{ label: "Beta Settings", to: "/settings" }],
      routes: [{ path: "/beta", element: () => <p>beta page</p> }],
    })

    renderHost([alpha, beta], fetchImpl, "/alpha")

    await screen.findByText("alpha page")

    expect(screen.getByRole("link", { name: "Alpha Settings" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Beta Settings" })).toBeTruthy()

    const duplicateKey = errors.some((args) =>
      args.some((a) => String(a).includes("same key"))
    )
    spy.mockRestore()
    expect(duplicateKey).toBe(false)
  })

  // MINOR 7. Read the comment on rootIsClaimed first: this does NOT
  // discriminate that guard, and it is labelled so nobody later mistakes it
  // for a test that does. Dropping the guard leaves this green, because
  // react-router already breaks the "/" tie on declaration order and the
  // redirect is declared last. What it does pin, and nothing pinned before,
  // is the behaviour itself: a plugin may own the root and its page renders
  // there. If the route table is ever reordered, this catches it.
  it("lets a plugin own the root path instead of redirecting away from it", async () => {
    const fetchImpl = capabilitiesFetch([
      { name: "alpha", envelopes: ["v1"], configured: true },
      { name: "beta", envelopes: ["v1"], configured: true },
    ])
    // beta is listed first and has a nav entry, so the old unconditional
    // redirect would have sent "/" to /beta and never rendered alpha's page.
    const beta = definePlugin({
      extension: "beta",
      nav: [{ label: "Beta", to: "/beta" }],
      routes: [{ path: "/beta", element: () => <p>beta page</p> }],
    })
    const alpha = definePlugin({
      extension: "alpha",
      nav: [{ label: "Alpha Home", to: "/" }],
      routes: [{ path: "/", element: () => <p>alpha root page</p> }],
    })

    renderHost([beta, alpha], fetchImpl, "/")

    expect(await screen.findByText("alpha root page")).toBeTruthy()
    expect(screen.queryByText("beta page")).toBeNull()
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

    const alpha = queryingPlugin("alpha", "/alpha", "Alpha")
    const beta = queryingPlugin("beta", "/beta", "Beta")

    const first = renderHost([alpha, beta], fetchImpl, "/alpha")
    expect(await screen.findByText("Alpha says alpha")).toBeTruthy()
    first.unmount()

    renderHost([alpha, beta], fetchImpl, "/beta")
    expect(await screen.findByText("Beta says beta")).toBeTruthy()

    expect(sent.map((r) => r.intent)).toEqual(["ping", "ping"])
    expect(sent.map((r) => r.contributor)).toEqual(["alpha", "beta"])
  })
})
