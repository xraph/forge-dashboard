import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { RelayDLQPage } from "../src/pages/dlq"
import { RelayDLQDetailPage } from "../src/pages/dlq-detail"
import { RelayDeliveriesPage } from "../src/pages/deliveries"
import { RelayDeliveryDetailPage } from "../src/pages/delivery-detail"
import { RelayEndpointCreatePage } from "../src/pages/endpoint-create"
import { RelayEndpointDetailPage } from "../src/pages/endpoint-detail"
import { RelayEndpointsPage } from "../src/pages/endpoints"
import { RelayEventDetailPage } from "../src/pages/event-detail"
import { RelayEventSendPage } from "../src/pages/event-send"
import { RelayEventTypeDetailPage } from "../src/pages/event-type-detail"
import { RelayEventTypeRegisterPage } from "../src/pages/event-type-register"
import { RelayEventTypesPage } from "../src/pages/event-types"
import { RelayEventsPage } from "../src/pages/events"
import { RelayOverviewPage } from "../src/pages/overview"
import { RelaySettingsPage } from "../src/pages/settings"
import type { DeliverySummary } from "../src/types"
import { renderPage, scriptedClient } from "./harness"

const delivery: DeliverySummary = {
  id: "del_1",
  eventId: "evt_1",
  endpointId: "ep_1",
  endpointUrl: "https://acme.example/hook",
  eventType: "invoice.paid",
  tenantId: "acme",
  state: "failed",
  attemptCount: 2,
  maxAttempts: 2,
  nextAttemptAt: "2026-09-29T10:00:00Z",
  lastStatusCode: 500,
  lastLatencyMs: 90,
  createdAt: "2026-09-29T10:00:00Z",
  updatedAt: "2026-09-29T10:00:05Z",
}

const deliveries = { complete: true, deliveries: [delivery] }

const endpoint = {
  id: "ep_1",
  tenantId: "acme",
  url: "https://acme.example/hook",
  description: "Production receiver",
  eventTypes: ["invoice.*"],
  enabled: true,
  rateLimit: 5,
  signed: true,
  createdAt: "2026-08-14T09:12:00Z",
  updatedAt: "2026-09-02T16:40:00Z",
  headers: { "X-Env": "prod" },
  metadata: { owner: "billing" },
}

const eventType = {
  id: "evtype_1",
  name: "invoice.paid",
  description: "An invoice was paid",
  group: "billing",
  version: "1",
  hasSchema: true,
  deprecated: false,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  schema: { type: "object" },
  example: { id: "inv_1" },
  metadata: { owner: "billing" },
}

const dlqEntry = {
  id: "dlq_1",
  deliveryId: "del_1",
  eventId: "evt_1",
  endpointId: "ep_1",
  eventType: "invoice.paid",
  tenantId: "acme",
  url: "https://acme.example/hook",
  error: "HTTP 500",
  attemptCount: 5,
  lastStatusCode: 500,
  failedAt: "2026-09-29T09:00:00Z",
}

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

const common = {
  "endpoints.list": { endpoints: [endpoint] },
  "eventTypes.list": { types: [eventType] },
}

describe("relay pages follow the shared layout", () => {
  it("Overview follows the shared layout", async () => {
    const { client } = scriptedClient({
      "overview.stats": {
        eventTypes: 3,
        endpoints: 2,
        pending: 1,
        deadLetters: 4,
      },
      "deliveries.list": deliveries,
    })
    const { container } = renderPage(RelayOverviewPage, client)
    await screen.findByRole("table")
    await screen.findByText("Event types")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Deliveries follows the shared layout", async () => {
    const { client } = scriptedClient({
      ...common,
      "deliveries.list": { ...deliveries, nextCursor: "c2" },
    })
    const { container } = renderPage(RelayDeliveriesPage, client)
    await screen.findByRole("table")
    await screen.findByRole("navigation", { name: "Pagination" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Delivery detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "deliveries.detail": {
        ...delivery,
        completedAt: "2026-09-29T10:00:05Z",
        attempts: [
          {
            id: "a1",
            attemptNum: 1,
            statusCode: 503,
            latencyMs: 80,
            outcome: "retry",
            attemptedAt: "2026-09-29T10:00:00Z",
          },
          {
            id: "a2",
            attemptNum: 2,
            statusCode: 500,
            latencyMs: 90,
            outcome: "dlq",
            attemptedAt: "2026-09-29T10:00:05Z",
          },
        ],
      },
    })
    const { container } = renderPage(RelayDeliveryDetailPage, client, {
      id: "del_1",
    })
    await screen.findByRole("list", { name: "Retry sequence" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Dead letters follows the shared layout", async () => {
    const { client } = scriptedClient({
      "dlq.list": { complete: true, entries: [dlqEntry], nextCursor: "c2" },
    })
    const { container } = renderPage(RelayDLQPage, client)
    await screen.findByRole("table")
    await screen.findByRole("navigation", { name: "Pagination" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Dead letter detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "dlq.detail": { ...dlqEntry, payload: { id: "inv_1" } },
    })
    const { container } = renderPage(RelayDLQDetailPage, client, {
      id: "dlq_1",
    })
    await screen.findByRole("region", { name: "Payload" })
    await screen.findByText("Last response")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Endpoints follows the shared layout", async () => {
    const { client } = scriptedClient({
      "endpoints.list": { endpoints: [endpoint] },
    })
    const { container } = renderPage(RelayEndpointsPage, client)
    await screen.findByRole("table")
    expect(layoutViolations(container)).toEqual([])
  })

  it("New endpoint follows the shared layout", async () => {
    const { client } = scriptedClient({})
    const { container } = renderPage(RelayEndpointCreatePage, client)
    await screen.findByRole("heading", { level: 1 })
    await screen.findByLabelText("Tenant ID")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Endpoint detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "endpoints.detail": endpoint,
      "deliveries.list": deliveries,
    })
    const { container } = renderPage(RelayEndpointDetailPage, client, {
      id: "ep_1",
    })
    await screen.findByRole("table")
    await screen.findByText("Production receiver")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Endpoint detail follows the shared layout while editing", async () => {
    const { client } = scriptedClient({
      "endpoints.detail": endpoint,
      "deliveries.list": deliveries,
    })
    const { container } = renderPage(RelayEndpointDetailPage, client, {
      id: "ep_1",
    })
    await screen.findByRole("table")
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
    await screen.findByLabelText("URL")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Events follows the shared layout", async () => {
    const { client } = scriptedClient({
      "eventTypes.list": { types: [eventType] },
      "events.list": {
        complete: true,
        nextCursor: "c2",
        events: [
          {
            id: "evt_1",
            type: "invoice.paid",
            tenantId: "acme",
            createdAt: "2026-09-29T10:00:00Z",
          },
        ],
      },
    })
    const { container } = renderPage(RelayEventsPage, client)
    await screen.findByRole("table")
    await screen.findByRole("navigation", { name: "Pagination" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Event detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "events.detail": {
        id: "evt_1",
        type: "invoice.paid",
        tenantId: "acme",
        idempotencyKey: "key-1",
        createdAt: "2026-09-29T10:00:00Z",
        data: { id: "inv_1" },
        deliveries: [delivery],
      },
    })
    const { container } = renderPage(RelayEventDetailPage, client, {
      id: "evt_1",
    })
    await screen.findByRole("table")
    await screen.findByText("key-1")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Send an event follows the shared layout", async () => {
    const { client } = scriptedClient({
      "eventTypes.list": { types: [eventType] },
    })
    const { container } = renderPage(RelayEventSendPage, client)
    await screen.findByRole("option", { name: "invoice.paid" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Event types follows the shared layout", async () => {
    const { client } = scriptedClient({
      "eventTypes.list": { types: [eventType] },
    })
    const { container } = renderPage(RelayEventTypesPage, client)
    await screen.findByRole("table")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Event type detail follows the shared layout", async () => {
    const { client } = scriptedClient({ "eventTypes.detail": eventType })
    const { container } = renderPage(RelayEventTypeDetailPage, client, {
      name: "invoice.paid",
    })
    await screen.findByText("evtype_1")
    await screen.findByRole("region", { name: "Schema" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Register an event type follows the shared layout", async () => {
    const { client } = scriptedClient({})
    const { container } = renderPage(RelayEventTypeRegisterPage, client)
    await screen.findByLabelText("Name")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Settings follows the shared layout", async () => {
    const { client } = scriptedClient({ "settings.config": config })
    const { container } = renderPage(RelaySettingsPage, client)
    await screen.findByRole("region", {
      name: "How a receiver verifies a delivery",
    })
    await waitFor(() => expect(screen.getByText("5s, then 30s")).toBeDefined())
    expect(layoutViolations(container)).toEqual([])
  })
})
