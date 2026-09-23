import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import {
  RelayEndpointDetailPage,
  type EndpointDetail,
} from "../src/pages/endpoint-detail"
import {
  commandFailingClient,
  commandPendingClient,
  recordingCommandClient,
  renderPage,
  stubClient,
} from "./harness"

const ID = "ep_01hq2k3m4n5p6q7r8s9t0v1w2x"

function detail(over: Partial<EndpointDetail> = {}): EndpointDetail {
  return {
    id: ID,
    tenantId: "acme",
    url: "https://acme.example/webhooks/relay",
    description: "Production receiver",
    eventTypes: ["invoice.*", "customer.created"],
    enabled: true,
    rateLimit: 0,
    signed: true,
    createdAt: "2026-08-14T09:12:00Z",
    updatedAt: "2026-09-02T16:40:00Z",
    headers: {},
    metadata: {},
    ...over,
  }
}

// useNavigateTo falls back to window.location.href outside a host, and jsdom
// does not implement navigation, so swap location for a stub per test.
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

describe("RelayEndpointDetailPage", () => {
  it("shows the endpoint's fields", async () => {
    renderPage(
      RelayEndpointDetailPage,
      stubClient({ "endpoints.detail": detail() }),
      { id: ID }
    )
    expect(await screen.findByText("customer.created")).toBeDefined()
    expect(screen.getAllByText("acme")[0].className).toMatch(/font-mono/)
  })

  it("flags a missing signing secret", async () => {
    renderPage(
      RelayEndpointDetailPage,
      stubClient({ "endpoints.detail": detail({ signed: false }) }),
      { id: ID }
    )
    expect(
      (await screen.findByText("Unsigned")).getAttribute("data-variant")
    ).toBe("destructive")
  })

  // Disabling is reversible, so it fires straight away, with no dialog.
  it("disables an endpoint without asking", async () => {
    const { client, sent } = recordingCommandClient(
      { "endpoints.detail": detail() },
      { "endpoints.setEnabled": { ok: true } }
    )
    renderPage(RelayEndpointDetailPage, client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }))
    await waitFor(() =>
      expect(sent).toEqual([
        { intent: "endpoints.setEnabled", payload: { id: ID, enabled: false } },
      ])
    )
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  // The server returns the new secret once and never again.
  it("shows a rotated secret once, and says it will not be shown again", async () => {
    const { client, sent } = recordingCommandClient(
      { "endpoints.detail": detail() },
      { "endpoints.rotateSecret": { id: ID, secret: "whsec_brandnew" } }
    )
    renderPage(RelayEndpointDetailPage, client, { id: ID })
    fireEvent.click(
      await screen.findByRole("button", { name: "Rotate secret" })
    )
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Rotate",
      })
    )
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(await screen.findByText("whsec_brandnew")).toBeDefined()
    expect(screen.getByText(/will not show it again/i)).toBeDefined()
  })

  // Base UI makes everything outside an open dialog inert and aria-hidden, so
  // an error on the page body is invisible to the person who caused it.
  it("shows a failed rotate inside the dialog", async () => {
    renderPage(
      RelayEndpointDetailPage,
      commandFailingClient(
        { "endpoints.detail": detail() },
        new ContractError("INTERNAL", "store unavailable")
      ),
      { id: ID }
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Rotate secret" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate" }))
    expect(await within(dialog).findByText(/store unavailable/)).toBeDefined()
  })

  // One hook per action keeps the last failure. Reopening must not greet the
  // operator with the previous attempt's error.
  it("clears a stale rotate error when the dialog is opened again", async () => {
    renderPage(
      RelayEndpointDetailPage,
      commandFailingClient(
        { "endpoints.detail": detail() },
        new ContractError("INTERNAL", "store unavailable")
      ),
      { id: ID }
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Rotate secret" })
    )
    let dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate" }))
    await within(dialog).findByText(/store unavailable/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: "Rotate secret" }))
    dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByText(/store unavailable/)).toBeNull()
  })

  // `pending` is not debounced: without it a double-click sends twice.
  it("disables the confirm button while a rotate is in flight", async () => {
    renderPage(
      RelayEndpointDetailPage,
      commandPendingClient({ "endpoints.detail": detail() }),
      { id: ID }
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Rotate secret" })
    )
    const dialog = await screen.findByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", { name: "Rotate" })
    fireEvent.click(confirm)
    // ConfirmDialog swaps the label to "Working…" while pending, so the
    // button is found by that, and a second click on it cannot rotate twice.
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole("button", { name: "Working…" })
          .hasAttribute("disabled")
      ).toBe(true)
    )
  })

  // delete invalidates the list only, so this page can never learn from the
  // store that its endpoint is gone. It has to leave on its own.
  it("leaves for the list once the endpoint is deleted", async () => {
    const { client, sent } = recordingCommandClient(
      { "endpoints.detail": detail() },
      { "endpoints.delete": { ok: true, id: ID } }
    )
    renderPage(RelayEndpointDetailPage, client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      })
    )
    await waitFor(() =>
      expect(sent).toEqual([
        { intent: "endpoints.delete", payload: { id: ID } },
      ])
    )
    await waitFor(() => expect(window.location.href).toBe("/endpoints"))
  })

  it("stays put and shows the error inside the dialog when a delete fails", async () => {
    renderPage(
      RelayEndpointDetailPage,
      commandFailingClient(
        { "endpoints.detail": detail() },
        new ContractError("INTERNAL", "delete refused")
      ),
      { id: ID }
    )
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(await within(dialog).findByText(/delete refused/)).toBeDefined()
    expect(window.location.href).toBe("")
  })

  // The two dialogs hold separate commands, so each has to reset its own.
  // Resetting only rotate's is the easy slip, and nothing else catches it.
  it("clears a stale delete error when the dialog is opened again", async () => {
    renderPage(
      RelayEndpointDetailPage,
      commandFailingClient(
        { "endpoints.detail": detail() },
        new ContractError("INTERNAL", "delete refused")
      ),
      { id: ID }
    )
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    let dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await within(dialog).findByText(/delete refused/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByText(/delete refused/)).toBeNull()
  })
})

describe("RelayEndpointDetailPage editing", () => {
  function edit(label: string | RegExp, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }

  it("opens the fields for editing with what is stored, and sends every field back", async () => {
    const { client, sent } = recordingCommandClient(
      {
        "endpoints.detail": detail({
          rateLimit: 5,
          headers: { "X-Env": "prod" },
          metadata: { team: "billing" },
        }),
      },
      { "endpoints.update": { ok: true, id: ID } }
    )
    renderPage(RelayEndpointDetailPage, client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))

    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe(
      "https://acme.example/webhooks/relay"
    )
    expect(
      (screen.getByLabelText(/Event types/) as HTMLTextAreaElement).value
    ).toBe("invoice.*\ncustomer.created")
    expect(
      (screen.getByLabelText(/Headers/) as HTMLTextAreaElement).value
    ).toBe("X-Env: prod")
    // An endpoint cannot change tenants, so there is nothing to edit there.
    expect(screen.queryByLabelText("Tenant ID")).toBeNull()

    edit("Description", "Renamed")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "endpoints.update",
      payload: {
        id: ID,
        url: "https://acme.example/webhooks/relay",
        description: "Renamed",
        eventTypes: ["invoice.*", "customer.created"],
        rateLimit: 5,
        headers: { "X-Env": "prod" },
        metadata: { team: "billing" },
      },
    })
    // Saved, so the page goes back to reading.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
    )
  })

  // endpoints.update reads a missing field as "leave it" and an empty one as
  // "clear it". Emptying a field in the form has to arrive as the second.
  it("sends a cleared field as empty, so the server clears it", async () => {
    const { client, sent } = recordingCommandClient(
      {
        "endpoints.detail": detail({
          rateLimit: 5,
          headers: { "X-Env": "prod" },
        }),
      },
      { "endpoints.update": { ok: true, id: ID } }
    )
    renderPage(RelayEndpointDetailPage, client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
    edit("Description", "")
    edit("Rate limit", "")
    edit(/Headers/, "")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toMatchObject({
      description: "",
      rateLimit: 0,
      headers: {},
    })
  })

  it("keeps the form open with the error when a save fails", async () => {
    renderPage(
      RelayEndpointDetailPage,
      commandFailingClient(
        { "endpoints.detail": detail() },
        new ContractError("BAD_REQUEST", "URL: invalid URL")
      ),
      { id: ID }
    )
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "URL: invalid URL"
    )
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined()
  })

  it("does not greet a reopened form with the last save's error", async () => {
    renderPage(
      RelayEndpointDetailPage,
      commandFailingClient(
        { "endpoints.detail": detail() },
        new ContractError("BAD_REQUEST", "URL: invalid URL")
      ),
      { id: ID }
    )
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByRole("alert")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("drops the edits on cancel", async () => {
    renderPage(
      RelayEndpointDetailPage,
      stubClient({ "endpoints.detail": detail() }),
      { id: ID }
    )
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
    edit("Description", "Half typed")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByLabelText("Description")).toBeNull()
    expect(screen.getByText("Production receiver")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    expect(
      (screen.getByLabelText("Description") as HTMLInputElement).value
    ).toBe("Production receiver")
  })
})
