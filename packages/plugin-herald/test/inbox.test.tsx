import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { InboxPage } from "../src/pages/inbox"
import { ContractError } from "@forge-go/dashboard-plugin"
import { engine, notification } from "./data"
import { invalidatingClient, renderPage, scriptedClient } from "./harness"

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

const PAGE = {
  notifications: [
    notification(),
    notification({ id: "hinb_01j00000000000000000002001", title: "New sign-in", type: "security.signin-alert", read: true, readAt: "2026-09-23T11:00:00Z", expiresAt: "2026-10-30T00:00:00Z" }),
  ],
  unread: 7,
  nextCursor: "bzoyNQ",
}

function setup() {
  return scriptedClient(
    { "engine.info": engine(), "inbox.list": (p) => (p.cursor ? { notifications: [notification({ id: "hinb_01j00000000000000000002029", title: "Older one" })], unread: 7 } : PAGE) },
    { "inbox.markRead": { ok: true, id: "x" }, "inbox.markAllRead": { ok: true }, "inbox.delete": { ok: true, id: "x" } },
  )
}

async function typeUser(value: string) {
  fireEvent.change(await screen.findByLabelText("User ID"), { target: { value } })
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
}

describe("InboxPage", () => {
  it("asks for nothing until there is a user, and says so", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    expect(await screen.findByText(/Enter a user ID/)).toBeTruthy()
    expect(c.queried.some((q) => q.intent === "inbox.list")).toBe(false)
  })

  it("waits for typing to stop, then reads that user's first page", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    fireEvent.change(await screen.findByLabelText("User ID"), { target: { value: "usr_a" } })
    await act(async () => {
      vi.advanceTimersByTime(299)
    })
    expect(c.queried.some((q) => q.intent === "inbox.list")).toBe(false)
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "usr_ada" } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await screen.findByText("Welcome to Example")
    expect(c.queried.filter((q) => q.intent === "inbox.list").map((q) => q.params)).toEqual([{ userId: "usr_ada", limit: 25 }])
  })

  it("counts this page and the unread total, with types in mono and read times", async () => {
    renderPage(InboxPage, setup().client)
    await typeUser("usr_ada")
    expect(await screen.findByText("2 notifications on this page, 7 unread in total")).toBeTruthy()
    expect(screen.getByText("security.signin-alert").closest("td")?.className).toMatch(/font-mono text-xs/)
    const unread = screen.getAllByRole("row").find((r) => within(r).queryByText("Welcome to Example"))!
    expect(within(unread).getByText("Unread")).toBeTruthy()
    expect(within(unread).getByLabelText("no expiry")).toBeTruthy()
  })

  it("marks one read straight from its row, and the row stops offering it once the list refetches", async () => {
    const c = invalidatingClient(
      { "engine.info": engine(), "inbox.list": (_input, call) => ({ notifications: [notification({ read: call > 0, readAt: call > 0 ? "2026-09-23T12:00:00Z" : undefined })], unread: call === 0 ? 1 : 0 }) },
      { "inbox.markRead": { answer: { ok: true, id: "x" }, invalidates: ["inbox.list"] } },
    )
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Mark Welcome to Example read" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "inbox.markRead", payload: { id: "hinb_01j00000000000000000002000" } }]))
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "inbox.list")).toHaveLength(2))
    await screen.findByText("0 unread in total", { exact: false })
    expect(screen.queryByRole("button", { name: "Mark Welcome to Example read" })).toBeNull()
  })

  it("deletes one behind a confirm", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Delete New sign-in" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "inbox.delete", payload: { id: "hinb_01j00000000000000000002001" } }]))
  })

  it("marks all read behind a confirm that names the user and the count", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/usr_ada/)
    expect(dialog.textContent).toMatch(/7 unread notifications/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark all read" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "inbox.markAllRead", payload: { userId: "usr_ada" } }]))
  })

  it("starts from the first page when the user changes", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await screen.findByText("Older one")
    await typeUser("usr_bo")
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "inbox.list").map((q) => q.params).at(-1)).toEqual({ userId: "usr_bo", limit: 25 }))
    // The old cursor never travels with the new user, not even once.
    expect(c.queried.filter((q) => q.intent === "inbox.list" && q.params.userId === "usr_bo" && "cursor" in q.params)).toEqual([])
  })

  it("stays on the page being read while typing, and only goes back once the new user settles", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await screen.findByText("Older one")
    const before = c.queried.filter((q) => q.intent === "inbox.list").length
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "usr_ad" } })
    expect(screen.getByText("Older one")).toBeTruthy()
    expect(c.queried.filter((q) => q.intent === "inbox.list")).toHaveLength(before)
  })

  it("asks for nothing again once the user is cleared", async () => {
    const c = setup()
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    await screen.findByText("Welcome to Example")
    await typeUser("")
    expect(await screen.findByText("Enter a user ID to see their in-app notifications.")).toBeTruthy()
    expect(c.queried.filter((q) => q.params.userId === "")).toEqual([])
  })

  it("names the app on every state", async () => {
    renderPage(InboxPage, setup().client)
    expect(await screen.findByText(/^App:/)).toBeTruthy()
    await typeUser("usr_ada")
    await screen.findByText("Welcome to Example")
    expect(screen.getByText(/^App:/)).toBeTruthy()
  })

  it("keeps the mark-all dialog, with the count it was opened on, while its own refetch runs", async () => {
    const { client: base, queried } = invalidatingClient(
      { "engine.info": engine(), "inbox.list": (_input, call) => ({ notifications: [notification({ read: call > 0 })], unread: call === 0 ? 7 : 0 }) },
      { "inbox.markAllRead": { answer: { ok: true }, invalidates: ["inbox.list"] } },
    )
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const client = {
      ...base,
      command: async (intent: string, payload?: unknown) => {
        const out = await base.command(intent, payload)
        await gate
        return out
      },
    } as typeof base
    renderPage(InboxPage, client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark all read" }))
    await waitFor(() => expect(queried.filter((q) => q.intent === "inbox.list")).toHaveLength(2))
    // The refetch is answering 0 unread, and the dialog still speaks about the 7 it was opened on.
    expect(screen.getByRole("alertdialog").textContent).toMatch(/7 unread notifications/)
    release()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("keeps the delete dialog naming its notification when the refetch fails", async () => {
    const { client: base, queried } = invalidatingClient(
      { "engine.info": engine(), "inbox.list": (_input, call) => (call === 0 ? PAGE : new ContractError("INTERNAL", "boom")) },
      { "inbox.delete": { answer: { ok: true, id: "x" }, invalidates: ["inbox.list"] } },
    )
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const client = {
      ...base,
      command: async (intent: string, payload?: unknown) => {
        const out = await base.command(intent, payload)
        await gate
        return out
      },
    } as typeof base
    renderPage(InboxPage, client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Delete New sign-in" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/usr_ada/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(queried.filter((q) => q.intent === "inbox.list")).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Delete New sign-in" })).toBeNull())
    expect(screen.getByRole("alertdialog").textContent).toMatch(/New sign-in/)
    release()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("drops a mark-read failure when the user changes, and when the next try starts", async () => {
    let fail = true
    const c = scriptedClient({ "engine.info": engine(), "inbox.list": PAGE }, { "inbox.markRead": () => (fail ? new ContractError("NOT_FOUND", "notification not found") : { ok: true }) })
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Mark Welcome to Example read" }))
    expect(await screen.findByText(/notification not found/)).toBeTruthy()
    await typeUser("usr_bo")
    await waitFor(() => expect(screen.queryByText(/notification not found/)).toBeNull())
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Mark Welcome to Example read" }))
    expect(await screen.findByText(/notification not found/)).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole("button", { name: "Mark Welcome to Example read" }))
    await waitFor(() => expect(screen.queryByText(/notification not found/)).toBeNull())
  })

  it("says why a mark-read failed, outside the list", async () => {
    const c = scriptedClient({ "engine.info": engine(), "inbox.list": PAGE }, { "inbox.markRead": new ContractError("NOT_FOUND", "notification not found") })
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Mark Welcome to Example read" }))
    expect(await screen.findByText(/notification not found/)).toBeTruthy()
  })

  it("shows a raw send's notification, which has no title and no type, as a row that says so and can still be acted on", async () => {
    const raw = notification({ id: "hinb_01j00000000000000000002050", title: "", type: "" })
    const c = scriptedClient(
      { "engine.info": engine(), "inbox.list": { notifications: [raw], unread: 1 } },
      { "inbox.markRead": { ok: true, id: "x" }, "inbox.delete": { ok: true, id: "x" } },
    )
    renderPage(InboxPage, c.client)
    await typeUser("usr_ada")
    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByLabelText("no title"))!
    expect(within(row).getByLabelText("no title")).toBeTruthy()
    expect(within(row).getByLabelText("no type")).toBeTruthy()
    // The controls name the row by its ID, never "Mark  read".
    expect(screen.queryByRole("button", { name: "Mark  read" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: `Mark ${raw.id} read` }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "inbox.markRead", payload: { id: raw.id } }]))
    fireEvent.click(screen.getByRole("button", { name: `Delete ${raw.id}` }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByRole("heading").textContent).toBe(`Delete notification ${raw.id}?`)
    expect(dialog.textContent).not.toMatch(/Delete ""/)
  })

  it("says the user has nothing in this app, rather than nothing at all", async () => {
    renderPage(InboxPage, scriptedClient({ "engine.info": engine(), "inbox.list": { notifications: [], unread: 0 } }).client)
    await typeUser("usr_nobody")
    expect(await screen.findByText("No notifications for usr_nobody in this app.")).toBeTruthy()
  })
})
