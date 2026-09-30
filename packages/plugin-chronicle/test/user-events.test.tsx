import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { UserEventsPage } from "../src/pages/user-events"
import { renderPage, scriptedClient } from "./harness"

describe("UserEventsPage", () => {
  it("reads events.byUser for the user in the route and captions with its total", async () => {
    const c = scriptedClient({
      "events.byUser": {
        events: [{ id: "audit_own_7", timestamp: "2026-09-29T11:00:00Z", sequence: 7, action: "role.grant", resource: "role", category: "admin", outcome: "success", severity: "warning", userId: "user_1", erased: false }],
        total: 31,
        hasMore: true,
      },
    })
    renderPage(UserEventsPage, c.client, { userId: "user_1" })
    await waitFor(() => expect(screen.getByText("1 of 31 events")).toBeTruthy())
    expect(c.queried[0]).toEqual({ intent: "events.byUser", params: { userId: "user_1", limit: 50, offset: 0 } })
    expect(screen.getByRole("heading", { name: /user_1/ })).toBeTruthy()
  })

  it("says this user recorded nothing, rather than showing an empty table", async () => {
    renderPage(UserEventsPage, scriptedClient({ "events.byUser": { events: [], total: 0, hasMore: false } }).client, { userId: "user_9" })
    await waitFor(() => expect(screen.getByText("No events are recorded for this user.")).toBeTruthy())
  })

  it("does not repeat the user in every row, since the page is about one user", async () => {
    const c = scriptedClient({
      "events.byUser": {
        events: [{ id: "audit_own_7", timestamp: "2026-09-29T11:00:00Z", sequence: 7, action: "role.grant", resource: "role", category: "admin", outcome: "success", severity: "warning", userId: "user_1", erased: false }],
        total: 1,
        hasMore: false,
      },
    })
    renderPage(UserEventsPage, c.client, { userId: "user_1" })
    await screen.findByRole("link", { name: "role.grant" })
    expect(screen.queryByRole("columnheader", { name: "User" })).toBeNull()
  })

  it("pages with the server's total", async () => {
    const c = scriptedClient({
      "events.byUser": { events: [{ id: "audit_own_7", timestamp: "2026-09-29T11:00:00Z", sequence: 7, action: "role.grant", resource: "role", category: "admin", outcome: "success", severity: "warning", userId: "user_1", erased: false }], total: 120, hasMore: true },
    })
    renderPage(UserEventsPage, c.client, { userId: "user_1" })
    await screen.findByText("1 of 120 events")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(c.queried.pop()?.params).toEqual({ userId: "user_1", limit: 50, offset: 50 }))
  })

  it("agrees the caption's noun with a total of one", async () => {
    const c = scriptedClient({
      "events.byUser": {
        events: [{ id: "audit_own_7", timestamp: "2026-09-29T11:00:00Z", sequence: 7, action: "role.grant", resource: "role", category: "admin", outcome: "success", severity: "warning", userId: "user_1", erased: false }],
        total: 1,
        hasMore: false,
      },
    })
    renderPage(UserEventsPage, c.client, { userId: "user_1" })
    expect(await screen.findByText("1 of 1 event")).toBeTruthy()
  })
})
