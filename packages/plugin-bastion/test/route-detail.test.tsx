import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { vi } from "vitest"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import { BastionRouteDetailPage } from "../src/pages/route-detail"
import type { RouteDetail } from "../src/types"
import { recordingCommandClient, recordingQueryClient, renderPage, stubClient } from "./harness"

if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

function detail(over: Partial<RouteDetail> = {}): RouteDetail {
  return {
    id: "manual-/users", path: "/gw/users", methods: ["GET"], protocol: "http", source: "manual", serviceName: "",
    priority: 110, enabled: true, targetCount: 1, healthyTargets: 1, editable: true, config: true,
    updatedAt: "2026-09-30T07:30:00Z", input: { path: "/users", priority: 10 },
    stripPrefix: true, addPrefix: "", rewritePath: "",
    headers: { set: { "X-Env": "prod" } },
    transform: { requestHeaders: { set: { "X-Api-Key": "[redacted]" } }, responseHeaders: {} },
    metadataKeys: [], version: 2, createdAt: "2026-09-29T10:00:00Z",
    targets: [{
      id: "t0", url: "http://users:8080", weight: 1, tags: [], healthy: true, circuitState: "half_open",
      stats: { activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0 }, tls: false, metadataKeys: [],
    }],
    ...over,
  }
}

describe("BastionRouteDetailPage", () => {
  it("asks for the decoded id, slash included", async () => {
    const { client, sent } = recordingQueryClient({ "routes.detail": detail() })
    renderPage(BastionRouteDetailPage, client, { id: "manual-/users" })
    await screen.findByRole("heading", { name: "/gw/users" })
    expect(sent[0]).toEqual({ intent: "routes.detail", params: { id: "manual-/users" } })
  })

  it("shows the entered priority beside the effective one and warns about config routes", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    await screen.findByText("110 (entered as 10)")
    expect(screen.getByText(/lasts until the gateway restarts/)).toBeTruthy()
  })

  it("marks a redacted header rather than printing its placeholder as a value", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    const row = (await screen.findByText("X-Api-Key")).closest("tr") as HTMLElement
    expect(within(row).getByText("Redacted")).toBeTruthy()
    expect(within(row).getByText("Request transform (set)")).toBeTruthy()
    expect(screen.getByText("2 headers")).toBeTruthy()
  })

  it("shows add and remove changes from headers and both transforms", async () => {
    const d = detail({
      headers: { set: { "X-Env": "prod" }, remove: ["X-Debug"] },
      transform: {
        requestHeaders: { add: { "X-Trace": "on" }, remove: ["Cookie"] },
        responseHeaders: { set: { "X-Served-By": "gw" }, add: { Vary: "Accept" }, remove: ["Server"] },
      },
    })
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": d }), { id: "manual-/users" })
    const rowOf = async (name: string) => (await screen.findByText(name)).closest("tr") as HTMLElement

    expect(within(await rowOf("X-Env")).getByText("Set")).toBeTruthy()
    const debug = await rowOf("X-Debug")
    expect(within(debug).getByText("Remove")).toBeTruthy()
    expect(within(debug).getByText("Removed")).toBeTruthy()
    expect(within(await rowOf("X-Trace")).getByText("Request transform (add)")).toBeTruthy()
    expect(within(await rowOf("Cookie")).getByText("Request transform (remove)")).toBeTruthy()
    expect(within(await rowOf("X-Served-By")).getByText("Response transform (set)")).toBeTruthy()
    expect(within(await rowOf("Vary")).getByText("Response transform (add)")).toBeTruthy()
    expect(within(await rowOf("Server")).getByText("Response transform (remove)")).toBeTruthy()
    expect(screen.getByText("7 headers")).toBeTruthy()
    expect(screen.queryByText("No header changes.")).toBeNull()
  })

  it("says discovery owns a FARP route", async () => {
    renderPage(
      BastionRouteDetailPage,
      stubClient({ "routes.detail": detail({ source: "farp", editable: false, config: false, input: undefined }) }),
      { id: "farp-x" },
    )
    await screen.findByText(/Discovery manages this route/)
    expect(screen.queryByText(/entered as/)).toBeNull()
  })

  it("shows no latency for a target that has served nothing", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    await screen.findByText("http://users:8080")
    expect(screen.getByLabelText("no latency")).toBeTruthy()
    expect(screen.getByText("Half-open")).toBeTruthy()
  })

  it("renders a status line and asks nothing when the address has no id", () => {
    const { client, sent } = recordingQueryClient({})
    renderPage(BastionRouteDetailPage, client, {})
    expect(screen.getByRole("status").textContent).toBe("No route in the address, so there is nothing to show.")
    expect(sent).toHaveLength(0)
  })
})

function renderNav(client: Parameters<typeof renderPage>[1], id: string) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={{ Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a>, navigate }}>
        <BastionRouteDetailPage params={{ id }} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

describe("BastionRouteDetailPage actions", () => {
  it("links Edit to the encoded edit page", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail() }), { id: "manual-/users" })
    const edit = await screen.findByRole("link", { name: "Edit" })
    expect(edit.getAttribute("href")).toBe("/routes/manual-%2Fusers/edit")
  })

  it("offers no actions on a discovered route", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail({ source: "farp", editable: false, config: false, input: undefined }) }), { id: "farp-x" })
    await screen.findByText(/Discovery manages this route/)
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull()
  })

  it("confirms a disable and says a config-route change ends at restart", async () => {
    const { client, sent } = recordingCommandClient(
      { "routes.detail": detail() },
      { "routes.setEnabled": { id: "manual-/users", enabled: false, durable: false } },
    )
    renderPage(BastionRouteDetailPage, client, { id: "manual-/users" })
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }))
    await screen.findByText(/comes from the config file, so this change lasts until the gateway restarts/)
    expect(sent).toEqual([{ intent: "routes.setEnabled", payload: { id: "manual-/users", enabled: false } }])
  })

  it("shows a delete failure inside the dialog", async () => {
    const client = {
      extension: "bastion",
      query: async () => detail(),
      command: async () => { throw new ContractError("CONFLICT", "route \"manual-/users\" comes from farp", { reason: "source", source: "farp" }) },
    } as never
    renderPage(BastionRouteDetailPage, client, { id: "manual-/users" })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(await within(dialog).findByText(/comes from farp/)).toBeTruthy()
  })

  it("goes back to the routes list after a delete", async () => {
    const { client } = recordingCommandClient({ "routes.detail": detail() }, { "routes.delete": { ok: true, id: "manual-/users" } })
    const { navigate } = renderNav(client, "manual-/users")
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/routes"))
  })

  it("marks overrides the proxy does not apply", async () => {
    renderPage(BastionRouteDetailPage, stubClient({ "routes.detail": detail({ timeout: { read: 5 } as never }) }), { id: "manual-/users" })
    await screen.findByText("Not applied")
    expect(screen.getByText(/does not apply them today/)).toBeTruthy()
  })
})
