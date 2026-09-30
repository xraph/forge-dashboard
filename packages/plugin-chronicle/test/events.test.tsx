import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { EventsPage, toQueryParams } from "../src/pages/events"
import { renderPage, scriptedClient } from "./harness"
import type { EventSummary } from "../src/types"

const ev = (seq: number, over: Partial<EventSummary> = {}): EventSummary => ({
  id: `audit_own_${seq}`, timestamp: "2026-09-29T11:00:00Z", sequence: seq, action: "user.login", resource: "session",
  category: "auth", outcome: "success", severity: "info", userId: "user_1", ip: "10.0.0.1", erased: false, ...over,
})

function client(answer: (p: Record<string, unknown>) => unknown) {
  return scriptedClient({ "events.list": answer })
}

describe("EventsPage", () => {
  it("captions with the server's total, not the rows on screen", async () => {
    renderPage(EventsPage, client(() => ({ events: [ev(12431), ev(12430)], total: 12431, hasMore: true })).client)
    await waitFor(() => expect(screen.getByText("2 of 12,431 events")).toBeTruthy())
  })

  it("renders the action as the column an operator reads and identifiers in mono", async () => {
    renderPage(EventsPage, client(() => ({ events: [ev(12431)], total: 1, hasMore: false })).client)
    const action = await screen.findByRole("link", { name: "user.login" })
    expect(action.className).toContain("font-medium")
    expect(screen.getByText("12,431").className).toContain("font-mono")
  })

  it("marks an absent user with NoneCell, never a blank", async () => {
    renderPage(EventsPage, client(() => ({ events: [ev(1, { userId: undefined })], total: 1, hasMore: false })).client)
    await waitFor(() => expect(screen.getByLabelText("no user")).toBeTruthy())
  })

  it("says the chain holds nothing when nothing is filtered and nothing comes back", async () => {
    renderPage(EventsPage, client(() => ({ events: [], total: 0, hasMore: false })).client)
    await waitFor(() => expect(screen.getByText("This chain holds no events yet.")).toBeTruthy())
    expect(screen.getByText("0 of 0 events")).toBeTruthy()
  })

  it("says nothing matches, lists the filters, and offers to clear them", async () => {
    const c = client((p) => (p.outcome ? { events: [], total: 0, hasMore: false } : { events: [ev(1)], total: 1, hasMore: false }))
    renderPage(EventsPage, c.client)
    await screen.findByRole("link", { name: "user.login" })
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "denied" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await waitFor(() => expect(screen.getByText("No events match these filters")).toBeTruthy())
    expect(screen.getByText(/Outcome: denied/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    await waitFor(() => expect(screen.getByRole("link", { name: "user.login" })).toBeTruthy())
  })

  it("sends every filter to the server, split into lists where the contract takes lists", async () => {
    const c = client(() => ({ events: [], total: 0, hasMore: false }))
    renderPage(EventsPage, c.client)
    await screen.findByText("This chain holds no events yet.")
    fireEvent.change(screen.getByLabelText("Actions"), { target: { value: "user.login, role.grant" } })
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } })
    fireEvent.change(screen.getByLabelText("User"), { target: { value: "user_7" } })
    fireEvent.change(screen.getByLabelText("Session"), { target: { value: "sess_3" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await waitFor(() =>
      expect(c.queried.filter((q) => q.intent === "events.list").pop()?.params).toEqual({
        actions: ["user.login", "role.grant"],
        severity: ["critical"],
        userId: "user_7",
        sessionId: "sess_3",
        limit: 50,
        offset: 0,
      }),
    )
  })

  it("turns local datetime inputs into RFC3339 and leaves empty bounds out", () => {
    expect(
      toQueryParams({ after: "2026-09-28T00:00", before: "", userId: "", sessionId: "", requestId: "", categories: "", actions: "", resources: "", severity: "", outcome: "" }),
    ).toEqual({ after: new Date("2026-09-28T00:00").toISOString() })
  })

  it("pages with the server's total", async () => {
    const c = client(() => ({ events: [ev(2)], total: 120, hasMore: true }))
    renderPage(EventsPage, c.client)
    await screen.findByText("1 of 120 events")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "events.list").pop()?.params).toMatchObject({ offset: 50 }))
  })

  it("shows an erased event with the Erased badge", async () => {
    renderPage(EventsPage, client(() => ({ events: [ev(1, { erased: true })], total: 1, hasMore: false })).client)
    await waitFor(() => expect(screen.getByText("Erased")).toBeTruthy())
  })

  it("names the form's reset differently from the empty state's clear, so both can show at once", async () => {
    const c = client((p) => (p.outcome ? { events: [], total: 0, hasMore: false } : { events: [ev(1)], total: 1, hasMore: false }))
    renderPage(EventsPage, c.client)
    await screen.findByRole("link", { name: "user.login" })
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "denied" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await screen.findByText("No events match these filters")
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }))
    await waitFor(() => expect(screen.getByRole("link", { name: "user.login" })).toBeTruthy())
    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull()
  })

  it("agrees the caption's noun with a total of one", async () => {
    renderPage(EventsPage, client(() => ({ events: [ev(1)], total: 1, hasMore: false })).client)
    expect(await screen.findByText("1 of 1 event")).toBeTruthy()
  })

  it("says a page past the end is empty, not the chain, and offers the way back", async () => {
    // The total was 60 when the first page loaded; by the time the second is read the rows have gone.
    const c = client((p) =>
      p.offset === 0 ? { events: Array.from({ length: 50 }, (_, i) => ev(60 - i)), total: 60, hasMore: true } : { events: [], total: 0, hasMore: false },
    )
    renderPage(EventsPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    expect(await screen.findByText("No events on this page.")).toBeTruthy()
    expect(screen.queryByText("This chain holds no events yet.")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Back to the first page" }))
    await waitFor(() => expect(c.queried.at(-1)?.params).toMatchObject({ offset: 0 }))
    expect(await screen.findByText("50 of 60 events")).toBeTruthy()
  })
})
