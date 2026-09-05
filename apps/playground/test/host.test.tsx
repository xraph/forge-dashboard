import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ForgeDashboardProvider } from "@forge/dashboard-runtime"
import { definePlugin } from "@forge/dashboard-plugin"
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
})
