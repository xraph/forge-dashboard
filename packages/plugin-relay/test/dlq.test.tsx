import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RelayDLQPage } from "../src/pages/dlq"
import { RelayDLQDetailPage } from "../src/pages/dlq-detail"
import type { DLQEntrySummary } from "../src/types"
import { renderPage, scriptedClient } from "./harness"

function entry(over: Partial<DLQEntrySummary>): DLQEntrySummary {
  return {
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
    ...over,
  }
}

const twoEntries = {
  complete: true,
  entries: [
    entry({ id: "dlq_a", url: "https://a.example/hook" }),
    entry({
      id: "dlq_b",
      url: "https://b.example/hook",
      eventType: "customer.created",
    }),
    entry({
      id: "dlq_r",
      eventType: "legacy.ping",
      replayedAt: "2026-09-29T09:30:00Z",
    }),
  ],
}

describe("RelayDLQPage replay", () => {
  it("confirms with what it will send and to whom, then replays that entry", async () => {
    const { client, sent } = scriptedClient(
      { "dlq.list": twoEntries },
      { "dlq.replay": { ok: true, id: "dlq_a" } }
    )
    renderPage(RelayDLQPage, client)
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Replay invoice.paid to https://a.example/hook",
      })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain(
      "Relay will send this event to https://a.example/hook again now."
    )
    expect(dialog.textContent).toContain(
      "cannot tell it apart from the original"
    )
    expect(sent).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole("button", { name: "Replay" }))
    await waitFor(() =>
      expect(sent).toEqual([{ intent: "dlq.replay", payload: { id: "dlq_a" } }])
    )
    // Same verb through the whole flow.
    expect(
      await screen.findByText(
        "Replayed. A new delivery to https://a.example/hook is queued."
      )
    ).toBeDefined()
  })

  it("offers no replay on an entry already replayed, and marks it", async () => {
    const { client } = scriptedClient({ "dlq.list": twoEntries })
    renderPage(RelayDLQPage, client)
    const table = await screen.findByRole("table")
    expect(
      within(table).queryByRole("button", { name: /Replay legacy.ping/ })
    ).toBeNull()
    const badges = within(table)
      .getAllByText(/^Replayed/)
      .filter((el) => el.hasAttribute("data-variant"))
    expect(badges).toHaveLength(1)
    expect(badges[0].getAttribute("data-variant")).toBe("secondary")
  })

  it("shows a refused replay inside the dialog, and not on the next row's dialog", async () => {
    const { client } = scriptedClient(
      { "dlq.list": twoEntries },
      {
        "dlq.replay": new ContractError(
          "CONFLICT",
          "this entry has already been replayed"
        ),
      }
    )
    renderPage(RelayDLQPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: /Replay invoice.paid/ })
    )
    let dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Replay" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "already been replayed"
    )

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(
      screen.getByRole("button", { name: /Replay customer.created/ })
    )
    dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("https://b.example/hook")
    expect(within(dialog).queryByRole("alert")).toBeNull()
  })

  it("keeps the confirm disabled while the replay is in flight", async () => {
    const { client } = scriptedClient(
      { "dlq.list": twoEntries },
      { "dlq.replay": () => new Promise(() => {}) }
    )
    renderPage(RelayDLQPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: /Replay invoice.paid/ })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Replay" }))
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole("button", { name: "Working…" })
          .hasAttribute("disabled")
      ).toBe(true)
    )
  })
})

describe("RelayDLQPage bulk replay", () => {
  it("says how many it will send before it can send them, and sends the window it counted", async () => {
    const { client, sent, queried } = scriptedClient(
      {
        "dlq.list": twoEntries,
        "dlq.bulkPreview": { replayable: 2, alreadyReplayed: 1 },
      },
      { "dlq.replayBulk": { replayed: 2 } }
    )
    renderPage(RelayDLQPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Replay a time window" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(
      await within(dialog).findByText(
        /2 webhooks will be sent\. 1 already replayed will be skipped\./
      )
    ).toBeDefined()

    fireEvent.click(within(dialog).getByRole("button", { name: "Replay 2" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    const counted = queried.find((q) => q.intent === "dlq.bulkPreview")?.params
    expect(sent[0]).toEqual({ intent: "dlq.replayBulk", payload: counted })
    expect(await screen.findByText("Replayed 2 webhooks.")).toBeDefined()
  })

  it("cannot replay a window with nothing in it", async () => {
    const { client } = scriptedClient({
      "dlq.list": twoEntries,
      "dlq.bulkPreview": { replayable: 0, alreadyReplayed: 0 },
    })
    renderPage(RelayDLQPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Replay a time window" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(
      await within(dialog).findByText("Nothing in this window to replay.")
    ).toBeDefined()
    expect(
      within(dialog)
        .getByRole("button", { name: "Replay" })
        .hasAttribute("disabled")
    ).toBe(true)
  })

  it("recounts when the window changes", async () => {
    const { client, queried } = scriptedClient({
      "dlq.list": twoEntries,
      "dlq.bulkPreview": (p) => ({
        replayable:
          Date.parse(String(p.to)) - Date.parse(String(p.from)) > 2 * 86_400_000
            ? 9
            : 1,
        alreadyReplayed: 0,
      }),
    })
    renderPage(RelayDLQPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Replay a time window" })
    )
    const dialog = await screen.findByRole("alertdialog")
    await within(dialog).findByText("1 webhook will be sent.")
    fireEvent.change(within(dialog).getByLabelText("Failed in"), {
      target: { value: "30" },
    })
    expect(
      await within(dialog).findByText("9 webhooks will be sent.")
    ).toBeDefined()
    expect(
      queried.filter((q) => q.intent === "dlq.bulkPreview").length
    ).toBeGreaterThanOrEqual(2)
  })
})

describe("RelayDLQPage purge", () => {
  it("deletes entries older than the chosen age", async () => {
    const { client, sent } = scriptedClient(
      { "dlq.list": twoEntries },
      { "dlq.purge": { purged: 4 } }
    )
    renderPage(RelayDLQPage, client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete old entries" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.change(within(dialog).getByLabelText("Older than"), {
      target: { value: "30" },
    })
    const before = Date.now()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    const cutoff = Date.parse(
      String((sent[0].payload as { before: string }).before)
    )
    expect(before - cutoff).toBeGreaterThanOrEqual(30 * 86_400_000 - 50)
    expect(before - cutoff).toBeLessThan(30 * 86_400_000 + 5_000)
    expect(await screen.findByText("Deleted 4 entries.")).toBeDefined()
  })
})

describe("RelayDLQDetailPage", () => {
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

  it("shows the payload a replay would send, and replays from the page", async () => {
    const { client, sent } = scriptedClient(
      {
        "dlq.detail": {
          ...entry({ id: "dlq_7" }),
          payload: { invoiceId: "inv_7" },
        },
      },
      { "dlq.replay": { ok: true, id: "dlq_7" } }
    )
    renderPage(RelayDLQDetailPage, client, { id: "dlq_7" })
    expect((await screen.findByLabelText("payload")).textContent).toContain(
      '"invoiceId": "inv_7"'
    )
    fireEvent.click(screen.getByRole("button", { name: "Replay" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Replay" }))
    await waitFor(() =>
      expect(sent).toEqual([{ intent: "dlq.replay", payload: { id: "dlq_7" } }])
    )
    expect(
      await screen.findByText("Replayed. A new delivery is queued.")
    ).toBeDefined()
  })
})
