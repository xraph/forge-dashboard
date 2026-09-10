import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { waitlistSubPlugin, WaitlistCountsWidget } from "../../src/sub/waitlist"
import { renderSubPage, subStubClient } from "./harness"

const entries = {
  entries: [
    { id: "w1", email: "ada@example.com", name: "Ada", status: "pending", createdAt: "2026-01-01T00:00:00Z" },
    { id: "w2", email: "bob@example.com", status: "approved", createdAt: "2026-01-02T00:00:00Z" },
  ],
  total: 2,
}

const page = waitlistSubPlugin.routes[0].element

describe("waitlist", () => {
  it("colours each status apart", async () => {
    // Bug: subStubClient takes a MAP of intent to answer, not a bare
    // response. `subStubClient(entries)` would answer every intent
    // (including the required "waitlist.list") the same way, which is not
    // what a query keyed by intent name needs.
    renderSubPage(page, {
      client: subStubClient({ "waitlist.list": entries }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    // The status is what an operator scans for. The word alone is not the
    // signal; the colour is.
    expect(screen.getByText("pending").getAttribute("data-variant")).toBe("outline")
    expect(screen.getByText("approved").getAttribute("data-variant")).toBe("default")
  })

  it("offers approve and reject only on a pending entry", async () => {
    renderSubPage(page, {
      client: subStubClient({ "waitlist.list": entries }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    expect(screen.getByRole("button", { name: /approve ada@example.com/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /approve bob@example.com/i })).toBeNull()
    // Delete is offered on every entry, pending or not. It is how a mistake
    // gets cleaned up.
    expect(screen.getByRole("button", { name: /delete bob@example.com/i })).toBeTruthy()
  })

  it("omits a blank note rather than sending an empty string", async () => {
    // Bugs fixed here: subStubClient's first argument is a map keyed by
    // intent (not the bare `entries` response), and the recorded commands
    // live on `own.payloads`, not `own.commands` -- stubClient returns
    // `{ client, intents, payloads }`.
    const own = subStubClient(
      { "waitlist.list": entries },
      { "waitlist.approve": { ok: true } },
    )
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /approve ada@example.com/i }))
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    const payload = own.payloads[0].payload as Record<string, unknown>
    expect(payload.id).toBe("w1")
    expect("note" in payload).toBe(false)
  })

  it("sends the note when there is one", async () => {
    const own = subStubClient(
      { "waitlist.list": entries },
      { "waitlist.reject": { ok: true } },
    )
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /reject ada@example.com/i }))
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "duplicate" } })
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    expect(own.payloads[0].payload).toEqual({ id: "w1", note: "duplicate" })
  })

  it("drops the cursor when the status filter changes", async () => {
    // Bug fixed here: stubClient's `payloads` array records only COMMAND
    // payloads, never a query's params. To see what a QUERY went out with,
    // the answer has to be a function that captures its own input, the way
    // test/sub/settings-panel.test.tsx does it -- not `own.payloads`, which
    // the plan originally reached for.
    let lastParams: Record<string, unknown> | undefined
    const own = subStubClient({
      "waitlist.list": (params?: Record<string, unknown>) => {
        lastParams = params
        return { ...entries, nextCursor: "c2" }
      },
    })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    await waitFor(() => expect(lastParams).toMatchObject({ cursor: "c2" }))
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: "approved" } })
    await waitFor(() => expect(lastParams).toMatchObject({ status: "approved" }))
    // A cursor points into the PREVIOUS result set. Carried across a new
    // filter it returns page two of an answer nobody asked for, and it looks
    // like data rather than like an error.
    expect(lastParams?.cursor).toBeUndefined()
  })
})

describe("WaitlistCountsWidget", () => {
  it("shows the three counts the server actually answers", async () => {
    const own = subStubClient({ "waitlist.counts": { pending: 3, approved: 10, rejected: 1 } })
    renderSubPage(WaitlistCountsWidget, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy())
    expect(screen.getByText("10")).toBeTruthy()
    expect(screen.getByText("1")).toBeTruthy()
    // No total. The server answers three numbers and an entry could be in a
    // state none of them counts, so a computed total would hide it.
    expect(screen.queryByText("14")).toBeNull()
  })
})
