import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RelayEndpointCreatePage } from "../src/pages/endpoint-create"
import {
  commandFailingClient,
  recordingCommandClient,
  renderPage,
} from "./harness"

const NEW_ID = "ep_01hq2k3m4n5p6q7r8s9t0vnew"

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

function type(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function fillRequired() {
  type("Tenant ID", "acme")
  type("URL", "https://acme.example/hook")
  type(/Event types/, "invoice.*")
}

function createButton() {
  return screen.getByRole("button", { name: "Create endpoint" })
}

describe("RelayEndpointCreatePage", () => {
  it("sends what was typed, splitting event types and headers into their shapes", async () => {
    const { client, sent } = recordingCommandClient(
      {},
      { "endpoints.create": { ok: true, id: NEW_ID } }
    )
    renderPage(RelayEndpointCreatePage, client)

    type("Tenant ID", "  acme  ")
    type("URL", "https://acme.example/hook")
    type("Description", "Billing receiver")
    // Commas and newlines both separate patterns, and blanks between them drop.
    type(/Event types/, "invoice.*,\n order.created\n\n")
    type("Rate limit", "25")
    type(/Headers/, "X-Env: prod\nAuthorization: Bearer a:b")
    type(/Metadata/, "team: billing")
    fireEvent.click(createButton())

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "endpoints.create",
      payload: {
        tenantId: "acme",
        url: "https://acme.example/hook",
        description: "Billing receiver",
        eventTypes: ["invoice.*", "order.created"],
        rateLimit: 25,
        // Split at the first colon only, so a value may carry its own.
        headers: { "X-Env": "prod", Authorization: "Bearer a:b" },
        metadata: { team: "billing" },
      },
    })
  })

  it("leaves optional fields out of the payload when they are empty", async () => {
    const { client, sent } = recordingCommandClient(
      {},
      { "endpoints.create": { ok: true, id: NEW_ID } }
    )
    renderPage(RelayEndpointCreatePage, client)
    fillRequired()
    fireEvent.click(createButton())

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({
      tenantId: "acme",
      url: "https://acme.example/hook",
      eventTypes: ["invoice.*"],
    })
  })

  it("opens the new endpoint once it exists", async () => {
    const { client } = recordingCommandClient(
      {},
      { "endpoints.create": { ok: true, id: NEW_ID } }
    )
    renderPage(RelayEndpointCreatePage, client)
    fillRequired()
    fireEvent.click(createButton())
    await waitFor(() =>
      expect(window.location.href).toBe(`/endpoints/${NEW_ID}`)
    )
  })

  it("keeps create disabled until tenant, URL and an event type are all there", () => {
    const { client } = recordingCommandClient({})
    renderPage(RelayEndpointCreatePage, client)
    expect(createButton().hasAttribute("disabled")).toBe(true)
    // Each field is left out once while the other two are filled, so no one
    // of the three checks can go missing unnoticed.
    type("URL", "https://acme.example/hook")
    type(/Event types/, "invoice.*")
    type("Tenant ID", "   ")
    expect(createButton().hasAttribute("disabled")).toBe(true)
    type("Tenant ID", "acme")
    type("URL", "")
    expect(createButton().hasAttribute("disabled")).toBe(true)
    type("URL", "https://acme.example/hook")
    // A pattern list of only separators is still no pattern.
    type(/Event types/, " , \n")
    expect(createButton().hasAttribute("disabled")).toBe(true)
    type(/Event types/, "invoice.*")
    expect(createButton().hasAttribute("disabled")).toBe(false)
  })

  it("refuses a header line with no colon and says which line, without sending", () => {
    const { client, sent } = recordingCommandClient(
      {},
      { "endpoints.create": { ok: true, id: NEW_ID } }
    )
    renderPage(RelayEndpointCreatePage, client)
    fillRequired()
    type(/Headers/, "X-Env: prod\nX-Broken")
    expect(screen.getByText(/line 2/i)).toBeDefined()
    expect(screen.getByLabelText(/Headers/).getAttribute("aria-invalid")).toBe(
      "true"
    )
    expect(createButton().hasAttribute("disabled")).toBe(true)
    fireEvent.click(createButton())
    expect(sent).toHaveLength(0)
  })

  it("refuses a rate limit that is not a whole number of zero or more", () => {
    const { client } = recordingCommandClient({})
    renderPage(RelayEndpointCreatePage, client)
    fillRequired()
    type("Rate limit", "-3")
    expect(createButton().hasAttribute("disabled")).toBe(true)
    type("Rate limit", "2.5")
    expect(createButton().hasAttribute("disabled")).toBe(true)
    type("Rate limit", "0")
    expect(createButton().hasAttribute("disabled")).toBe(false)
  })

  it("shows the server's refusal and stays on the form", async () => {
    renderPage(
      RelayEndpointCreatePage,
      commandFailingClient(
        {},
        new ContractError("BAD_REQUEST", "URL: invalid URL")
      )
    )
    fillRequired()
    fireEvent.click(createButton())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("URL: invalid URL")
    expect(window.location.href).toBe("")
    // What was typed survives, so fixing the one field is all it takes.
    expect((screen.getByLabelText("Tenant ID") as HTMLInputElement).value).toBe(
      "acme"
    )
  })

  it("shows an example pattern next to the event types field", () => {
    renderPage(RelayEndpointCreatePage, recordingCommandClient({}).client)
    expect(screen.getByText(/invoice\.\*/)).toBeDefined()
  })
})
