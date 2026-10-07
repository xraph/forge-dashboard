import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { RelayDeliveriesPage } from "../src/pages/deliveries"
import type { DeliverySummary } from "../src/types"
import { renderPage, scriptedClient } from "./harness"

function row(over: Partial<DeliverySummary>): DeliverySummary {
  return {
    id: "del_1",
    eventId: "evt_1",
    endpointId: "ep_1",
    endpointUrl: "https://acme.example/hook",
    eventType: "invoice.paid",
    tenantId: "acme",
    state: "delivered",
    attemptCount: 1,
    maxAttempts: 5,
    nextAttemptAt: "2026-09-29T10:00:00Z",
    lastStatusCode: 200,
    lastLatencyMs: 120,
    createdAt: "2026-09-29T10:00:00Z",
    updatedAt: "2026-09-29T10:00:00Z",
    ...over,
  }
}

const common = {
  "endpoints.list": {
    endpoints: [{ id: "ep_1", url: "https://acme.example/hook" }],
  },
  "eventTypes.list": {
    types: [{ name: "invoice.paid" }, { name: "customer.created" }],
  },
}

function lastListParams(
  queried: { intent: string; params: Record<string, unknown> }[]
) {
  return [...queried].reverse().find((q) => q.intent === "deliveries.list")
    ?.params
}

describe("RelayDeliveriesPage", () => {
  // The ramp goes by proportion: the healthy majority is quietest, and
  // failed is the only destructive badge on the page.
  it("badges each state, splitting pending into queued and retrying", async () => {
    const { client } = scriptedClient({
      ...common,
      "deliveries.list": {
        complete: true,
        deliveries: [
          row({ id: "d1", state: "delivered" }),
          row({
            id: "d2",
            state: "pending",
            attemptCount: 0,
            eventType: "customer.created",
          }),
          row({
            id: "d3",
            state: "pending",
            attemptCount: 2,
            lastStatusCode: 503,
          }),
          row({
            id: "d4",
            state: "failed",
            attemptCount: 5,
            lastStatusCode: 0,
          }),
        ],
      },
    })
    renderPage(RelayDeliveriesPage, client)
    const table = await screen.findByRole("table")
    const variant = (text: string) =>
      within(table).getByText(text).getAttribute("data-variant")
    expect(variant("Delivered")).toBe("outline")
    expect(variant("Queued")).toBe("secondary")
    expect(variant("Retrying")).toBe("default")
    expect(variant("Failed")).toBe("destructive")
    // A 0 is no response, not a status; a queued row has none yet.
    expect(within(table).getByText("No response")).toBeDefined()
    expect(within(table).getByLabelText("no response yet")).toBeDefined()
  })

  it("sends each filter as the contract's parameter, and starts again from the newest page", async () => {
    const { client, queried } = scriptedClient({
      ...common,
      "deliveries.list": (p) =>
        p.cursor
          ? { complete: true, deliveries: [row({ id: "older" })] }
          : { complete: true, nextCursor: "c1", deliveries: [row({})] },
    })
    renderPage(RelayDeliveriesPage, client)
    await screen.findByRole("table")
    expect(lastListParams(queried)).toEqual({ limit: 50 })

    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(lastListParams(queried)).toEqual({ limit: 50, cursor: "c1" })
    )

    fireEvent.change(screen.getByLabelText("Response"), {
      target: { value: "5xx" },
    })
    await waitFor(() =>
      expect(lastListParams(queried)).toEqual({ limit: 50, statusClass: "5xx" })
    )
    fireEvent.change(screen.getByLabelText("State"), {
      target: { value: "failed" },
    })
    fireEvent.change(screen.getByLabelText("Endpoint"), {
      target: { value: "ep_1" },
    })
    fireEvent.change(screen.getByLabelText("Event type"), {
      target: { value: "invoice.paid" },
    })
    fireEvent.change(screen.getByLabelText("Tenant"), {
      target: { value: " acme " },
    })
    await waitFor(() =>
      expect(lastListParams(queried)).toEqual({
        limit: 50,
        statusClass: "5xx",
        state: "failed",
        endpointId: "ep_1",
        eventType: "invoice.paid",
        tenantId: "acme",
      })
    )
  })

  // Fixed once when chosen. Recomputed every render it would change the
  // params, and the cache key, on every render.
  //
  // Only Date is faked, so timers and promises behave. The window is exact
  // against a clock that does not move. Against the real one it was a bound
  // of 50ms on how long the render and the change took, which a machine
  // under load overshoots.
  describe("created window", () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it("fixes the created window when it is chosen", async () => {
      const chosenAt = Date.parse("2026-10-02T10:00:00Z")
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(chosenAt)
      const { client, queried } = scriptedClient({
        ...common,
        "deliveries.list": { complete: true, deliveries: [] },
      })
      renderPage(RelayDeliveriesPage, client)
      await screen.findByText(/Nothing has been sent yet/)
      fireEvent.change(screen.getByLabelText("Created"), {
        target: { value: "hour" },
      })
      await waitFor(() => expect(lastListParams(queried)?.from).toBeDefined())
      expect(lastListParams(queried)?.from).toBe(
        new Date(chosenAt - 3_600_000).toISOString()
      )

      // Time passes and the page renders again. A window recomputed on each
      // render would move with the clock; a fixed one does not.
      vi.setSystemTime(chosenAt + 60_000)
      fireEvent.change(screen.getByLabelText("State"), {
        target: { value: "failed" },
      })
      await waitFor(() => expect(lastListParams(queried)?.state).toBe("failed"))
      const withFrom = queried.filter(
        (q) => q.intent === "deliveries.list" && q.params.from
      )
      expect(new Set(withFrom.map((q) => q.params.from)).size).toBe(1)
    })
  })

  it("says a search that stopped short found nothing yet, not that there is nothing", async () => {
    const { client } = scriptedClient({
      ...common,
      "deliveries.list": { complete: false, nextCursor: "c2", deliveries: [] },
    })
    renderPage(RelayDeliveriesPage, client)
    expect(
      await screen.findByText(
        /Nothing found in the part of the log searched so far/
      )
    ).toBeDefined()
    expect(screen.queryByText(/Nothing has been sent yet/)).toBeNull()
    expect(
      screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")
    ).toBe(false)
  })

  it("tells an empty log apart from an empty filter", async () => {
    const { client } = scriptedClient({
      ...common,
      "deliveries.list": { complete: true, deliveries: [] },
    })
    renderPage(RelayDeliveriesPage, client)
    expect(await screen.findByText(/Nothing has been sent yet/)).toBeDefined()
    expect(screen.getByText("0 deliveries on this page")).toBeDefined()
    fireEvent.change(screen.getByLabelText("State"), {
      target: { value: "failed" },
    })
    expect(
      await screen.findByText("No deliveries match these filters.")
    ).toBeDefined()
  })

  it("links a row to its delivery", async () => {
    const { client } = scriptedClient({
      ...common,
      "deliveries.list": { complete: true, deliveries: [row({ id: "del_9" })] },
    })
    renderPage(RelayDeliveriesPage, client)
    const link = await screen.findByRole("link", { name: "invoice.paid" })
    expect(link.getAttribute("href")).toBe("/deliveries/del_9")
  })
})
