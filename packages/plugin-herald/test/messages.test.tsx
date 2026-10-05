import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { MessagesPage } from "../src/pages/messages"
import { engine, messageSummary } from "./data"
import { pendingClient, recordingQueryClient, renderPage } from "./harness"

const PAGE1 = {
  messages: [
    messageSummary(),
    messageSummary({ id: "hmsg_01j00000000000000000001001", recipient: "+15550111", channel: "sms", status: "failed", error: "twilio: 21211 invalid 'To' phone number", templateSlug: "auth.mfa-code", provider: { id: "hpvd_01j00000000000000000000002", name: "Twilio", driver: "twilio" } }),
    messageSummary({ id: "hmsg_01j00000000000000000001008", status: "suppressed", provider: null, templateSlug: undefined, sentAt: undefined }),
  ],
  nextCursor: "bzoyNQ",
}

function list(params: Record<string, unknown>) {
  if (params.cursor === "end") return { messages: [] }
  if (params.cursor) return { messages: [messageSummary({ id: "hmsg_01j00000000000000000001030", recipient: "late@example.com" })], nextCursor: "end" }
  if (params.channel === "push") return { messages: [] }
  return PAGE1
}

function client() {
  const sent: Record<string, unknown>[] = []
  const c = recordingQueryClient({ "engine.info": engine() })
  return {
    sent,
    client: {
      ...c.client,
      query: async (intent: string, params?: Record<string, unknown>) => {
        if (intent === "messages.list") {
          sent.push(params ?? {})
          return list(params ?? {})
        }
        return c.client.query(intent, params)
      },
    } as typeof c.client,
  }
}

describe("MessagesPage", () => {
  it("asks for the first page of 25 with no empty filters", async () => {
    const c = client()
    renderPage(MessagesPage, c.client)
    await screen.findByText("3 messages on this page")
    expect(c.sent[0]).toEqual({ limit: 25 })
  })

  it("shows ids in mono as links, recipients as the column you read, and none for a missing provider or template", async () => {
    renderPage(MessagesPage, client().client)
    const link = await screen.findByRole("link", { name: "hmsg_01j00000000000000000001000" })
    expect(link.getAttribute("href")).toBe("/messages/hmsg_01j00000000000000000001000")
    expect(link.closest("td")?.className).toMatch(/font-mono text-xs/)
    expect(screen.getByText("+15550111").closest("td")?.className).toMatch(/font-medium/)
    const suppressed = screen.getAllByRole("row").find((r) => within(r).queryByText("hmsg_01j00000000000000000001008"))!
    expect(within(suppressed).getByLabelText("no provider")).toBeTruthy()
    expect(within(suppressed).getByLabelText("no template")).toBeTruthy()
    expect(within(suppressed).getByText("Suppressed", { selector: '[data-slot="badge"]' })).toBeTruthy()
  })

  it("says a deleted provider no longer exists, but not for a suppressed send", async () => {
    const c = recordingQueryClient({ "engine.info": engine(), "messages.list": { messages: [messageSummary({ provider: null, status: "sent" }), messageSummary({ id: "hmsg_01j00000000000000000001008", provider: null, status: "suppressed" })] } })
    renderPage(MessagesPage, c.client)
    const sent = (await screen.findAllByRole("row")).find((r) => within(r).queryByText("hmsg_01j00000000000000000001000"))!
    expect(within(sent).getByText("(no longer exists)")).toBeTruthy()
    const suppressed = screen.getAllByRole("row").find((r) => within(r).queryByText("hmsg_01j00000000000000000001008"))!
    expect(within(suppressed).queryByText("(no longer exists)")).toBeNull()
    expect(within(suppressed).getByLabelText("no provider")).toBeTruthy()
  })

  it("offers only the statuses Herald writes, and says why", async () => {
    renderPage(MessagesPage, client().client)
    const status = (await screen.findByLabelText("Status")) as HTMLSelectElement
    expect([...status.options].map((o) => o.value)).toEqual(["", "sending", "sent", "failed", "suppressed"])
    expect(screen.getByText(/Delivered and bounced are never recorded/)).toBeTruthy()
  })

  it("pages with the cursor, and a filter change starts again without it", async () => {
    const c = client()
    renderPage(MessagesPage, c.client)
    await screen.findByText("3 messages on this page")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("late@example.com")
    expect(c.sent).toContainEqual({ limit: 25, cursor: "bzoyNQ" })
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "failed" } })
    await waitFor(() => expect(c.sent[c.sent.length - 1]).toEqual({ limit: 25, status: "failed" }))
    expect(c.sent.filter((p) => p.status === "failed" && "cursor" in p)).toEqual([])
    expect(screen.getByRole("button", { name: "Previous page" })).toHaveProperty("disabled", true)
  })

  it("starts again from the first page when the channel changes too, never sending the old cursor", async () => {
    const c = client()
    renderPage(MessagesPage, c.client)
    await screen.findByText("3 messages on this page")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("late@example.com")
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "sms" } })
    await waitFor(() => expect(c.sent[c.sent.length - 1]).toEqual({ limit: 25, channel: "sms" }))
    expect(c.sent.filter((p) => p.channel === "sms" && "cursor" in p)).toEqual([])
    // Clearing the filter returns to the unfiltered first page, also without a cursor.
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "" } })
    await waitFor(() => expect(c.sent[c.sent.length - 1]).toEqual({ limit: 25 }))
  })

  it("says nothing matches when a filter empties the list", async () => {
    const c = client()
    renderPage(MessagesPage, c.client)
    await screen.findByText("3 messages on this page")
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "push" } })
    expect(await screen.findByText("No messages match these filters.")).toBeTruthy()
    expect(c.sent[c.sent.length - 1]).toEqual({ limit: 25, channel: "push" })
  })

  it("says nothing further on a page past the end, not that nothing was sent", async () => {
    renderPage(MessagesPage, client().client)
    await screen.findByText("3 messages on this page")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("late@example.com")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(await screen.findByText("Nothing further.")).toBeTruthy()
    expect(screen.queryByText(/Nothing has been sent/)).toBeNull()
  })

  it("says nothing has been sent when the app has no messages at all", async () => {
    renderPage(MessagesPage, recordingQueryClient({ "engine.info": engine(), "messages.list": { messages: [] } }).client)
    expect(await screen.findByText(/Nothing has been sent in this app yet/)).toBeTruthy()
    expect(screen.getByText("0 messages on this page")).toBeTruthy()
  })

  it("names the app while the list is still loading", async () => {
    renderPage(MessagesPage, pendingClient())
    expect(screen.getByRole("heading", { level: 1, name: "Messages" })).toBeTruthy()
    expect(screen.getByText(/App: loading/)).toBeTruthy()
  })
})
