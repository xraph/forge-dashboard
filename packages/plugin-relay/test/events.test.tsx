import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RelayEventSendPage } from "../src/pages/event-send"
import { RelayEventTypeDetailPage } from "../src/pages/event-type-detail"
import { RelayEventTypeRegisterPage } from "../src/pages/event-type-register"
import { RelayDeliveryDetailPage } from "../src/pages/delivery-detail"
import { renderPage, scriptedClient } from "./harness"

const originalLocation = Object.getOwnPropertyDescriptor(window, "location")
beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: "" },
  })
})
afterEach(() => {
  if (originalLocation)
    Object.defineProperty(window, "location", originalLocation)
})

const types = {
  types: [{ name: "invoice.paid" }, { name: "customer.created" }],
}
const invoiceType = {
  name: "invoice.paid",
  description: "",
  version: "2",
  hasSchema: true,
  deprecated: false,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  schema: { type: "object" },
  example: { invoiceId: "inv_1", amount: 42 },
}

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe("RelayEventSendPage", () => {
  it("sends the typed event and opens it", async () => {
    const { client, sent } = scriptedClient(
      { "eventTypes.list": types, "eventTypes.detail": invoiceType },
      { "events.send": { ok: true, id: "evt_new" } }
    )
    renderPage(RelayEventSendPage, client)
    await screen.findByRole("option", { name: "invoice.paid" })
    fill("Event type", "invoice.paid")
    fill("Tenant ID", "acme")
    fireEvent.click(
      await screen.findByRole("button", { name: "Use the example" })
    )
    expect(
      (screen.getByLabelText("Payload") as HTMLTextAreaElement).value
    ).toContain('"invoiceId": "inv_1"')
    fireEvent.click(screen.getByRole("button", { name: "Send event" }))
    await waitFor(() =>
      expect(sent).toEqual([
        {
          intent: "events.send",
          payload: {
            type: "invoice.paid",
            tenantId: "acme",
            data: { invoiceId: "inv_1", amount: 42 },
          },
        },
      ])
    )
    await waitFor(() => expect(window.location.href).toBe("/events/evt_new"))
  })

  it("will not send a payload that is not JSON, and says so beside it", async () => {
    const { client, sent } = scriptedClient({
      "eventTypes.list": types,
      "eventTypes.detail": invoiceType,
    })
    renderPage(RelayEventSendPage, client)
    await screen.findByRole("option", { name: "invoice.paid" })
    fill("Event type", "invoice.paid")
    fill("Tenant ID", "acme")
    fill("Payload", '{"amount": 42')
    expect(screen.getByText(/Not valid JSON/)).toBeDefined()
    expect(screen.getByLabelText("Payload").getAttribute("aria-invalid")).toBe(
      "true"
    )
    const button = screen.getByRole("button", { name: "Send event" })
    expect(button.hasAttribute("disabled")).toBe(true)
    fireEvent.click(button)
    expect(sent).toHaveLength(0)
  })

  // relay.Send stores nothing for a reused key. The page says so and stays,
  // rather than opening an event that does not exist.
  it("says a reused idempotency key sent nothing", async () => {
    const { client } = scriptedClient(
      { "eventTypes.list": types, "eventTypes.detail": invoiceType },
      { "events.send": { ok: true, duplicate: true } }
    )
    renderPage(RelayEventSendPage, client)
    await screen.findByRole("option", { name: "invoice.paid" })
    fill("Event type", "invoice.paid")
    fill("Tenant ID", "acme")
    fill("Idempotency key", "k-1")
    fireEvent.click(screen.getByRole("button", { name: "Send event" }))
    expect(
      await screen.findByText(
        "That idempotency key has been used before, so nothing was sent."
      )
    ).toBeDefined()
    expect(window.location.href).toBe("")
  })

  it("shows the schema's refusal and stays on the form", async () => {
    const { client } = scriptedClient(
      { "eventTypes.list": types, "eventTypes.detail": invoiceType },
      {
        "events.send": new ContractError(
          "BAD_REQUEST",
          "relay: payload validation failed: missing property 'currency'"
        ),
      }
    )
    renderPage(RelayEventSendPage, client)
    await screen.findByRole("option", { name: "invoice.paid" })
    fill("Event type", "invoice.paid")
    fill("Tenant ID", "acme")
    fireEvent.click(screen.getByRole("button", { name: "Send event" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "missing property 'currency'"
    )
    expect(window.location.href).toBe("")
  })
})

describe("RelayEventTypeDetailPage", () => {
  it("deprecates the type after saying what that stops and what it leaves alone", async () => {
    const { client, sent } = scriptedClient(
      { "eventTypes.detail": invoiceType },
      { "eventTypes.deprecate": { ok: true } }
    )
    renderPage(RelayEventTypeDetailPage, client, { name: "invoice.paid" })
    fireEvent.click(await screen.findByRole("button", { name: "Deprecate" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain(
      "Relay will refuse new events of this type."
    )
    expect(dialog.textContent).toContain(
      "Events already sent, and their deliveries, are not touched."
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Deprecate" }))
    await waitFor(() =>
      expect(sent).toEqual([
        { intent: "eventTypes.deprecate", payload: { name: "invoice.paid" } },
      ])
    )
  })

  it("shows the schema and the example", async () => {
    const { client } = scriptedClient({ "eventTypes.detail": invoiceType })
    renderPage(RelayEventTypeDetailPage, client, { name: "invoice.paid" })
    expect((await screen.findByLabelText("schema")).textContent).toContain(
      '"type": "object"'
    )
    expect(screen.getByLabelText("example").textContent).toContain(
      '"invoiceId": "inv_1"'
    )
  })
})

describe("RelayEventTypeRegisterPage", () => {
  it("refuses a schema that is not an object before sending it", () => {
    const { client, sent } = scriptedClient(
      {},
      { "eventTypes.register": { ok: true } }
    )
    renderPage(RelayEventTypeRegisterPage, client)
    fill("Name", "invoice.paid")
    fill("JSON Schema", '"just a string"')
    expect(
      screen.getByText("A JSON Schema is an object, in braces.")
    ).toBeDefined()
    expect(
      screen.getByRole("button", { name: "Register" }).hasAttribute("disabled")
    ).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it("registers the type and opens it", async () => {
    const { client, sent } = scriptedClient(
      {},
      { "eventTypes.register": { ok: true, id: "evtype_1" } }
    )
    renderPage(RelayEventTypeRegisterPage, client)
    fill("Name", " invoice.paid ")
    fill("JSON Schema", '{"type":"object"}')
    fireEvent.click(screen.getByRole("button", { name: "Register" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({
      name: "invoice.paid",
      description: "",
      group: "",
      version: "1",
      schema: { type: "object" },
    })
    await waitFor(() =>
      expect(window.location.href).toBe("/event-types/invoice.paid")
    )
  })
})

describe("RelayDeliveryDetailPage", () => {
  it("draws the retry sequence and links the delivery to its event and endpoint", async () => {
    const { client } = scriptedClient({
      "deliveries.detail": {
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
    renderPage(RelayDeliveryDetailPage, client, { id: "del_1" })
    const timeline = await screen.findByRole("list", { name: "Retry sequence" })
    expect(timeline.textContent).toContain("waited 5s")
    expect(timeline.textContent).toContain("Gave up after 2 attempts.")
    expect(
      screen.getByRole("link", { name: "evt_1" }).getAttribute("href")
    ).toBe("/events/evt_1")
    expect(
      screen
        .getByRole("link", { name: "https://acme.example/hook" })
        .getAttribute("href")
    ).toBe("/endpoints/ep_1")
  })
})
