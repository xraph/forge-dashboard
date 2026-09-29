import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { RelaySettingsPage } from "../src/pages/settings"
import { RelayEndpointCreatePage } from "../src/pages/endpoint-create"
import { RelayEventTypeDetailPage } from "../src/pages/event-type-detail"
import { RelayDLQDetailPage } from "../src/pages/dlq-detail"
import { renderPage, scriptedClient } from "./harness"

// What the templ pages showed and the React ones had to keep, each checked
// against the page that now carries it.

const config = {
  concurrency: 10,
  batchSize: 50,
  maxRetries: 5,
  pollIntervalMs: 1000,
  maxPollIntervalMs: 30000,
  requestTimeoutMs: 10000,
  shutdownTimeoutMs: 30000,
  cacheTtlMs: 300000,
  retryScheduleMs: [5000, 30000],
  signature: {
    algorithm: "HMAC-SHA256",
    header: "X-Relay-Signature",
    timestampHeader: "X-Relay-Timestamp",
    format: "v1=<hex>",
    signedContent: "{timestamp}.{body}",
  },
}

describe("settings", () => {
  it("tells a receiver how to verify a delivery, from what the server reports", async () => {
    renderPage(
      RelaySettingsPage,
      scriptedClient({ "settings.config": config }).client
    )
    const section = await screen.findByRole("region", {
      name: "How a receiver verifies a delivery",
    })
    for (const text of [
      "X-Relay-Signature",
      "X-Relay-Timestamp",
      "v1=<hex>",
      "{timestamp}.{body}",
    ]) {
      expect(within(section).getByText(text)).toBeDefined()
    }
    expect(screen.getByText("5s, then 30s")).toBeDefined()
  })
})

describe("endpoint create", () => {
  it("says what each pattern matches in the catalog, once typing settles", async () => {
    const { client, queried } = scriptedClient({
      "eventTypes.match": (p) =>
        p.pattern === "invoice.*"
          ? { types: [{ name: "invoice.paid" }, { name: "invoice.created" }] }
          : { types: [] },
    })
    renderPage(RelayEndpointCreatePage, client)
    fireEvent.change(screen.getByLabelText(/Event types/), {
      target: { value: "invoice.*, legacy.*" },
    })
    // The preview waits 300ms for typing to settle; leave room for a busy
    // machine rather than racing testing-library's one-second default.
    const list = await screen.findByRole(
      "list",
      { name: "What these patterns match" },
      { timeout: 3000 }
    )
    await waitFor(
      () =>
        expect(list.textContent).toContain(
          "matches invoice.paid, invoice.created"
        ),
      { timeout: 3000 }
    )
    expect(list.textContent).toContain("matches no registered type yet")
    // One lookup per pattern.
    expect(
      queried
        .filter((q) => q.intent === "eventTypes.match")
        .map((q) => q.params.pattern)
        .sort()
    ).toEqual(["invoice.*", "legacy.*"])
  })

  it("stays quiet when the lookup fails", async () => {
    renderPage(RelayEndpointCreatePage, scriptedClient({}).client)
    fireEvent.change(screen.getByLabelText(/Event types/), {
      target: { value: "invoice.*" },
    })
    await new Promise((r) => setTimeout(r, 400))
    // The list renders only lines that have an answer; with none, it is empty.
    const list = screen.queryByRole("list", {
      name: "What these patterns match",
    })
    expect(list?.textContent ?? "").toBe("")
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("detail pages", () => {
  it("shows an event type's id, app scope and metadata", async () => {
    renderPage(
      RelayEventTypeDetailPage,
      scriptedClient({
        "eventTypes.detail": {
          id: "evtype_1",
          name: "invoice.paid",
          description: "",
          version: "1",
          hasSchema: false,
          deprecated: false,
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
          scopeAppId: "app_7",
          metadata: { owner: "billing" },
        },
      }).client,
      { name: "invoice.paid" }
    )
    expect(await screen.findByText("evtype_1")).toBeDefined()
    expect(screen.getByText("app_7")).toBeDefined()
    expect(screen.getByText("owner: billing")).toBeDefined()
  })

  it("links a dead letter to its endpoint", async () => {
    renderPage(
      RelayDLQDetailPage,
      scriptedClient({
        "dlq.detail": {
          id: "dlq_1",
          deliveryId: "del_1",
          eventId: "evt_1",
          endpointId: "ep_9",
          eventType: "invoice.paid",
          tenantId: "acme",
          url: "https://acme.example/hook",
          attemptCount: 5,
          lastStatusCode: 500,
          failedAt: "2026-09-29T09:00:00Z",
          payload: {},
        },
      }).client,
      { id: "dlq_1" }
    )
    const link = await screen.findByRole("link", {
      name: "https://acme.example/hook",
    })
    expect(link.getAttribute("href")).toBe("/endpoints/ep_9")
  })
})
