import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { BastionRouteCreatePage } from "../src/pages/route-create"
import { BastionRouteEditPage } from "../src/pages/route-edit"
import type { RouteDetail } from "../src/types"
import { recordingCommandClient, stubClient } from "./harness"

/**
 * jsdom 25 has no PointerEvent, and Base UI's checkbox dispatches through it.
 * A MouseEvent subclass is what a click is.
 */
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

function renderWith(Page: typeof BastionRouteCreatePage, client: ScopedClient, params: Record<string, string> = {}) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={{ Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a>, navigate }}>
        <Page params={params} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

function failingCommandClient(error: ContractError): ScopedClient {
  return { extension: "bastion", query: async () => { throw error }, command: async () => { throw error } } as ScopedClient
}

describe("BastionRouteCreatePage", () => {
  it("sends the entered fields and opens the new route", async () => {
    const { client, sent } = recordingCommandClient({}, { "routes.create": { id: "new-1" } })
    const { navigate } = renderWith(BastionRouteCreatePage, client)
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/billing" } })
    fireEvent.change(screen.getByLabelText("Upstream 1 URL"), { target: { value: "http://billing:9000" } })
    fireEvent.click(screen.getByLabelText("GET"))
    fireEvent.click(screen.getByRole("button", { name: "Create route" }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/routes/new-1"))
    expect(sent).toEqual([{
      intent: "routes.create",
      payload: {
        path: "/billing", methods: ["GET"], priority: 0, enabled: true, protocol: "http",
        stripPrefix: false, addPrefix: "", rewritePath: "",
        targets: [{ url: "http://billing:9000", weight: 1, tags: [] }],
        rateLimit: null, auth: null,
      },
    }])
  })

  it("puts a validation error beside the field it names", async () => {
    renderWith(BastionRouteCreatePage, failingCommandClient(new ContractError("BAD_REQUEST", "upstream 1: \"x\" is not an http, https, ws or wss URL", { field: "targets" })))
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/x" } })
    fireEvent.change(screen.getByLabelText("Upstream 1 URL"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Create route" }))

    const upstreams = (await screen.findByRole("group", { name: "Upstreams" })) as HTMLElement
    expect(within(upstreams).getByRole("alert").textContent).toMatch(/not an http/)
  })

  it("shows a validation error whose field has no inline slot", async () => {
    renderWith(BastionRouteCreatePage, failingCommandClient(new ContractError("BAD_REQUEST", "priority must be below 1000", { field: "priority" })))
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/x" } })
    fireEvent.change(screen.getByLabelText("Upstream 1 URL"), { target: { value: "http://u:1" } })
    fireEvent.click(screen.getByRole("button", { name: "Create route" }))

    await screen.findByText(/priority must be below 1000/)
  })

  it("links to the route a duplicate clashes with", async () => {
    renderWith(BastionRouteCreatePage, failingCommandClient(new ContractError("CONFLICT", "route \"manual-/users\" already serves /gw/users", { reason: "duplicate", routeId: "manual-/users" })))
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/users" } })
    fireEvent.change(screen.getByLabelText("Upstream 1 URL"), { target: { value: "http://u:1" } })
    fireEvent.click(screen.getByRole("button", { name: "Create route" }))

    const link = await screen.findByRole("link", { name: "Open the route it clashes with" })
    expect(link.getAttribute("href")).toBe("/routes/manual-%2Fusers")
  })
})

const DETAIL: RouteDetail = {
  id: "manual-/users", path: "/gw/users", methods: [], protocol: "http", source: "manual", serviceName: "",
  priority: 110, enabled: true, targetCount: 1, healthyTargets: 1, editable: true, config: true,
  updatedAt: "2026-09-30T07:30:00Z", input: { path: "/users", priority: 10 },
  stripPrefix: false, addPrefix: "", rewritePath: "", headers: {}, metadataKeys: [], version: 1,
  createdAt: "2026-09-29T10:00:00Z",
  targets: [{ id: "t0", url: "http://users:8080", weight: 1, tags: [], healthy: true, circuitState: "closed",
    stats: { activeConns: 0, totalRequests: 0, totalErrors: 0, avgLatencyMs: 0 }, tls: false, metadataKeys: [] }],
}

describe("BastionRouteEditPage", () => {
  it("prefills as entered and sends an update for this id", async () => {
    const { client, sent } = recordingCommandClient({ "routes.detail": DETAIL }, { "routes.update": { id: "manual-/users" } })
    const { navigate } = renderWith(BastionRouteEditPage, client, { id: "manual-/users" })
    const path = (await screen.findByLabelText("Path")) as HTMLInputElement
    expect(path.value).toBe("/users")
    expect((screen.getByLabelText("Priority") as HTMLInputElement).value).toBe("10")

    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "12" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/routes/manual-%2Fusers"))
    expect(sent[0]?.intent).toBe("routes.update")
    expect(sent[0]?.payload).toMatchObject({ id: "manual-/users", path: "/users", priority: 12 })
  })

  it("says why a discovered route has no editor", async () => {
    renderWith(BastionRouteEditPage, stubClient({ "routes.detail": { ...DETAIL, source: "farp", editable: false, config: false, input: undefined } }), { id: "farp-x" })
    await screen.findByText(/Discovery manages this route/)
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
  })
})
