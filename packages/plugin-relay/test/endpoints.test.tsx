import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import {
  RelayEndpointsPage,
  type EndpointSummary,
} from "../src/pages/endpoints"
import {
  failingClient,
  paramsRecordingClient,
  renderPage,
  stubClient,
} from "./harness"

function endpoint(over: Partial<EndpointSummary> = {}): EndpointSummary {
  return {
    id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2x",
    tenantId: "acme",
    url: "https://acme.example/webhooks/relay",
    description: "Production receiver",
    eventTypes: ["invoice.*"],
    enabled: true,
    rateLimit: 0,
    signed: true,
    createdAt: "2026-08-14T09:12:00Z",
    updatedAt: "2026-09-02T16:40:00Z",
    ...over,
  }
}

describe("RelayEndpointsPage", () => {
  // An endpoint with no secret gets no deliveries from an upgraded server,
  // but it can still exist, and nothing else on the row would say so.
  it("flags an endpoint with no signing secret as Unsigned", async () => {
    renderPage(
      RelayEndpointsPage,
      stubClient({
        "endpoints.list": {
          endpoints: [
            endpoint({ id: "ep_a", signed: false, url: "https://a.example/h" }),
          ],
        },
      })
    )
    const row = (await screen.findByText("https://a.example/h")).closest("tr")!
    expect(within(row).getByText("Unsigned")).toBeDefined()
  })

  // Colour is the scan signal. The majority states recede (outline) and the
  // one somebody came to find is loud (destructive).
  it("badges by proportion: unsigned is destructive, signed and enabled recede", async () => {
    renderPage(
      RelayEndpointsPage,
      stubClient({
        "endpoints.list": {
          endpoints: [
            endpoint({ id: "ep_a", url: "https://a.example/h", signed: false }),
            endpoint({
              id: "ep_b",
              url: "https://b.example/h",
              enabled: false,
            }),
          ],
        },
      })
    )
    await screen.findByText("https://a.example/h")
    // Scoped to the table: the State filter's <option>s carry the same words.
    const table = within(screen.getByRole("table"))
    expect(table.getByText("Unsigned").getAttribute("data-variant")).toBe(
      "destructive"
    )
    expect(table.getAllByText("Signed")[0].getAttribute("data-variant")).toBe(
      "outline"
    )
    expect(table.getByText("Disabled").getAttribute("data-variant")).toBe(
      "secondary"
    )
    expect(table.getAllByText("Enabled")[0].getAttribute("data-variant")).toBe(
      "outline"
    )
  })

  // Convention 3: the caption carries a live count, including at zero.
  it("counts rows in the caption, including zero", async () => {
    renderPage(
      RelayEndpointsPage,
      stubClient({ "endpoints.list": { endpoints: [] } })
    )
    expect(await screen.findByText("0 endpoints")).toBeDefined()
  })

  it("says which kind of empty it is when nothing exists", async () => {
    renderPage(
      RelayEndpointsPage,
      stubClient({ "endpoints.list": { endpoints: [] } })
    )
    expect(await screen.findByText(/No endpoints yet/)).toBeDefined()
  })

  it("says which kind of empty it is when a filter matched nothing", async () => {
    renderPage(
      RelayEndpointsPage,
      stubClient({ "endpoints.list": { endpoints: [] } })
    )
    fireEvent.change(await screen.findByLabelText("Tenant"), {
      target: { value: "nobody" },
    })
    expect(await screen.findByText(/No endpoints match/)).toBeDefined()
  })

  // A filter that changes an input but never reaches the server looks right
  // and is wrong. Check the params actually sent.
  it("sends the tenant filter to the server", async () => {
    const { client, calls } = paramsRecordingClient({
      "endpoints.list": { endpoints: [] },
    })
    renderPage(RelayEndpointsPage, client)
    fireEvent.change(await screen.findByLabelText("Tenant"), {
      target: { value: "acme" },
    })
    await waitFor(() => expect(calls.at(-1)?.params?.tenantId).toBe("acme"))
  })

  it("sends the enabled filter to the server", async () => {
    const { client, calls } = paramsRecordingClient({
      "endpoints.list": { endpoints: [] },
    })
    renderPage(RelayEndpointsPage, client)
    fireEvent.change(await screen.findByLabelText("State"), {
      target: { value: "disabled" },
    })
    await waitFor(() => expect(calls.at(-1)?.params?.enabled).toBe(false))
  })

  // No filter means every tenant. The page must not invent a tenant.
  it("asks for every tenant when no tenant filter is set", async () => {
    const { client, calls } = paramsRecordingClient({
      "endpoints.list": { endpoints: [] },
    })
    renderPage(RelayEndpointsPage, client)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls[0].params?.tenantId ?? "").toBe("")
  })

  // Scope-relative, never /@relay/...: the host decides the mount point.
  it("links each row to its detail page with a scope-relative path", async () => {
    renderPage(
      RelayEndpointsPage,
      stubClient({
        "endpoints.list": {
          endpoints: [endpoint({ id: "ep_x", url: "https://x.example/h" })],
        },
      })
    )
    const link = await screen.findByRole("link", {
      name: "https://x.example/h",
    })
    expect(link.getAttribute("href")).toBe("/endpoints/ep_x")
  })

  // Convention 1: identifiers are monospace, the raw value you might copy.
  it("sets the tenant in monospace", async () => {
    renderPage(
      RelayEndpointsPage,
      stubClient({
        "endpoints.list": { endpoints: [endpoint({ tenantId: "acme" })] },
      })
    )
    const tenant = await screen.findByText("acme")
    expect(tenant.className).toMatch(/font-mono/)
  })

  // Convention 4: "none" is labelled, never a blank or a bare dash.
  it("shows an unlimited rate limit as a labelled none, not a blank", async () => {
    renderPage(
      RelayEndpointsPage,
      stubClient({
        "endpoints.list": { endpoints: [endpoint({ rateLimit: 0 })] },
      })
    )
    expect(await screen.findByLabelText(/no rate limit/i)).toBeDefined()
  })

  it("shows the error when the list cannot be read", async () => {
    renderPage(
      RelayEndpointsPage,
      failingClient(new ContractError("INTERNAL", "store unavailable"))
    )
    expect(await screen.findByText(/store unavailable/)).toBeDefined()
  })
})
