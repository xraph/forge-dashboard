import { afterEach, describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { AuditPage } from "../src/pages/audit"
import { AUDIT_ACTIONS, isDeleteAction } from "../src/audit-actions"
import { flagPath, secretPath } from "../src/keys"
import { recordingQueryClient, renderPage } from "./harness"

/**
 * jsdom 25 has no PointerEvent, and Base UI's checkbox dispatches one when it
 * is clicked. A MouseEvent subclass is what a click is, so the checkbox works.
 */
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

function entry(over: Record<string, unknown> = {}) {
  return {
    id: "aud_01",
    action: "secret.set",
    resource: "secret",
    key: "db/primary.password",
    outcome: "success",
    userId: "u_rex",
    createdAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

const ROWS = {
  entries: [
    entry(),
    entry({
      id: "aud_02",
      action: "secret.rotated",
      key: "api/token",
      outcome: "failure",
      error: "rotator refused the new value",
      userId: undefined,
      tenantId: "acme",
    }),
    entry({ id: "aud_03", action: "secret.delete", key: "old/secret" }),
    entry({
      id: "aud_04",
      action: "flag.toggled",
      resource: "flag",
      key: "checkout/new-flow",
    }),
    entry({
      id: "aud_05",
      action: "override.set",
      resource: "override",
      key: "app/greeting",
    }),
  ],
  total: 5,
}

const EMPTY = { entries: [], total: 0 }

const listParams = (sent: { intent: string; params?: unknown }[]) =>
  sent
    .filter((i) => i.intent === "audit.list")
    .map((i) => i.params as Record<string, unknown>)

const lastParams = (sent: { intent: string; params?: unknown }[]) => {
  const all = listParams(sent)
  return all[all.length - 1]!
}

const row = (name: string) =>
  screen.getAllByRole("row").find((r) => within(r).queryByText(name))!

const select = (label: string) =>
  screen.getByLabelText(label) as HTMLSelectElement

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("AuditPage", () => {
  it("asks audit.list for the first page with reads off and no other filter key", async () => {
    const { client, sent } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    expect(listParams(sent)[0]).toEqual({
      includeReads: false,
      limit: 25,
      offset: 0,
    })
  })

  it("renders every column", async () => {
    const { client } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    for (const h of [
      "Time",
      "Action",
      "Resource",
      "Key",
      "Tenant",
      "User",
      "Outcome",
    ]) {
      expect(screen.getByRole("columnheader", { name: h })).toBeTruthy()
    }
  })

  it("offers All plus the 18 known actions, and the resources and outcomes", async () => {
    const { client } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    expect(AUDIT_ACTIONS).toHaveLength(18)
    const actions = Array.from(select("Action").options).map((o) => o.value)
    expect(actions).toEqual(["", ...AUDIT_ACTIONS])
    expect(Array.from(select("Resource").options).map((o) => o.value)).toEqual([
      "",
      "secret",
      "flag",
      "config",
      "override",
      "rotation",
    ])
    expect(Array.from(select("Outcome").options).map((o) => o.value)).toEqual([
      "",
      "success",
      "failure",
    ])
  })

  it("hides reads by default and sends includeReads true when Show reads is ticked", async () => {
    const { client, sent } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    expect(lastParams(sent).includeReads).toBe(false)
    fireEvent.click(screen.getByRole("checkbox", { name: "Show reads" }))
    await waitFor(() => expect(lastParams(sent).includeReads).toBe(true))
  })

  it("starts again at page one when Show reads changes", async () => {
    const { client, sent } = recordingQueryClient({
      "audit.list": { entries: ROWS.entries, total: 60 },
    })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(lastParams(sent).offset).toBe(25))
    fireEvent.click(screen.getByRole("checkbox", { name: "Show reads" }))
    await waitFor(() =>
      expect(lastParams(sent)).toMatchObject({ includeReads: true, offset: 0 })
    )
  })

  describe.each([
    ["Resource", "flag", { resource: "flag" }],
    ["Action", "secret.rotated", { action: "secret.rotated" }],
    ["Outcome", "failure", { outcome: "failure" }],
  ])("the %s filter", (label, value, expected) => {
    it("is sent, and starts again at page one", async () => {
      const { client, sent } = recordingQueryClient({
        "audit.list": { entries: ROWS.entries, total: 60 },
      })
      renderPage(AuditPage, client)
      await screen.findByText("api/token")
      fireEvent.click(screen.getByRole("button", { name: "Next page" }))
      await waitFor(() => expect(lastParams(sent).offset).toBe(25))
      fireEvent.change(select(label), { target: { value } })
      await waitFor(() =>
        expect(lastParams(sent)).toMatchObject({ ...expected, offset: 0 })
      )
      await screen.findByText(/Page 1 of 3/)
    })

    it("is dropped from the request when set back to All", async () => {
      const { client, sent } = recordingQueryClient({ "audit.list": ROWS })
      renderPage(AuditPage, client)
      await screen.findByText("api/token")
      fireEvent.change(select(label), { target: { value } })
      await waitFor(() => expect(lastParams(sent)).toMatchObject(expected))
      fireEvent.change(select(label), { target: { value: "" } })
      await waitFor(() =>
        expect(Object.keys(lastParams(sent))).not.toContain(
          Object.keys(expected)[0]
        )
      )
    })
  })

  it("sends the key trimmed, after the typing stops, and starts again at page one", async () => {
    const { client, sent } = recordingQueryClient({
      "audit.list": { entries: ROWS.entries, total: 60 },
    })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(lastParams(sent).offset).toBe(25))
    const before = listParams(sent).length
    const box = screen.getByLabelText("Key") as HTMLInputElement
    fireEvent.change(box, { target: { value: " a" } })
    fireEvent.change(box, { target: { value: " api/token " } })
    // The box shows what you typed at once; the server has not been asked yet.
    expect(box.value).toBe(" api/token ")
    expect(listParams(sent)).toHaveLength(before)
    await waitFor(() =>
      expect(lastParams(sent)).toMatchObject({ key: "api/token", offset: 0 })
    )
    // One request for the pair of keystrokes, not one each.
    expect(listParams(sent)).toHaveLength(before + 1)
  })

  it("seeds the filters from the URL, so the first request is already filtered", async () => {
    window.history.replaceState(
      null,
      "",
      "/audit?action=secret.rotated&outcome=failure"
    )
    const { client, sent } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    expect(listParams(sent)).toEqual([
      {
        action: "secret.rotated",
        outcome: "failure",
        includeReads: false,
        limit: 25,
        offset: 0,
      },
    ])
    expect(select("Action").value).toBe("secret.rotated")
    expect(select("Outcome").value).toBe("failure")
  })

  it("sends since from the URL and shows it as a chip", async () => {
    window.history.replaceState(
      null,
      "",
      "/audit?action=secret.rotated&outcome=failure&since=2026-09-29T10%3A00%3A00.000Z"
    )
    const { client, sent } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    expect(listParams(sent)[0]).toEqual({
      action: "secret.rotated",
      outcome: "failure",
      since: "2026-09-29T10:00:00.000Z",
      includeReads: false,
      limit: 25,
      offset: 0,
    })
    expect(
      screen.getByText(
        `Since ${new Date("2026-09-29T10:00:00.000Z").toLocaleString()}`
      )
    ).toBeTruthy()
  })

  it("removing the since chip drops since and goes back to page one", async () => {
    window.history.replaceState(
      null,
      "",
      "/audit?since=2026-09-29T10%3A00%3A00Z"
    )
    const { client, sent } = recordingQueryClient({
      "audit.list": { entries: ROWS.entries, total: 60 },
    })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    await waitFor(() => expect(lastParams(sent)).toMatchObject({ offset: 25 }))
    fireEvent.click(screen.getByRole("button", { name: "Remove since filter" }))
    await waitFor(() => expect("since" in lastParams(sent)).toBe(false))
    expect(lastParams(sent)).toMatchObject({ offset: 0 })
    expect(screen.queryByText(/^Since /)).toBeNull()
  })

  it("ignores a since that is not an RFC3339 time", async () => {
    window.history.replaceState(null, "", "/audit?since=yesterday")
    const { client, sent } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    expect("since" in listParams(sent)[0]!).toBe(false)
    expect(screen.queryByText(/^Since /)).toBeNull()
  })

  it("seeds resource and key from the URL too, and ignores a value it does not offer", async () => {
    window.history.replaceState(
      null,
      "",
      "/audit?resource=flag&key=checkout%2Fnew-flow&outcome=bogus"
    )
    const { client, sent } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    expect(listParams(sent)[0]).toEqual({
      resource: "flag",
      key: "checkout/new-flow",
      includeReads: false,
      limit: 25,
      offset: 0,
    })
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe(
      "checkout/new-flow"
    )
    expect(select("Outcome").value).toBe("")
  })

  it("never writes the filters back into the URL", async () => {
    const { client, sent } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    fireEvent.change(select("Outcome"), { target: { value: "failure" } })
    await waitFor(() => expect(lastParams(sent).outcome).toBe("failure"))
    expect(window.location.search).toBe("")
  })

  it("shows a failure row's error under its outcome", async () => {
    const { client } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    const failed = row("api/token")
    expect(within(failed).getByText("failure")).toBeTruthy()
    expect(
      within(failed).getByText("rotator refused the new value")
    ).toBeTruthy()
    expect(within(row("db/primary.password")).queryByText(/refused/)).toBeNull()
  })

  it("labels a missing user and a missing tenant rather than leaving the cell blank", async () => {
    const { client } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    // The rotation row has a tenant and no user; the set row has a user and no tenant.
    const rotated = row("api/token")
    expect(within(rotated).getByLabelText("no user")).toBeTruthy()
    expect(within(rotated).getByText("acme")).toBeTruthy()
    const set = row("db/primary.password")
    expect(within(set).getByLabelText("no tenant")).toBeTruthy()
    expect(within(set).getByText("u_rex")).toBeTruthy()
  })

  it("links a key to its page only for a live secret, flag or config, never for a delete or an override", async () => {
    const { client } = recordingQueryClient({ "audit.list": ROWS })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    const href = (name: string) =>
      screen.getByText(name).closest("a")?.getAttribute("href")
    expect(href("db/primary.password")).toContain(
      secretPath("db/primary.password")
    )
    expect(href("checkout/new-flow")).toContain(flagPath("checkout/new-flow"))
    expect(screen.getByText("old/secret").closest("a")).toBeNull()
    expect(screen.getByText("app/greeting").closest("a")).toBeNull()
  })

  it("treats every delete action as not linkable", () => {
    for (const a of [
      "secret.delete",
      "flag.deleted",
      "config.deleted",
      "override.deleted",
    ]) {
      expect(isDeleteAction(a)).toBe(true)
    }
    for (const a of [
      "secret.set",
      "flag.override_deleted",
      "config.rolled_back",
    ]) {
      expect(isDeleteAction(a)).toBe(false)
    }
  })

  it("captions the table with the server's total, singular at one", async () => {
    const { client } = recordingQueryClient({
      "audit.list": { entries: [entry()], total: 1 },
    })
    renderPage(AuditPage, client)
    await screen.findByText("db/primary.password")
    expect(screen.getByText("1 entry")).toBeTruthy()
  })

  it("uses the total, not the page length, in the caption", async () => {
    const { client } = recordingQueryClient({
      "audit.list": { entries: ROWS.entries, total: 60 },
    })
    renderPage(AuditPage, client)
    await screen.findByText("api/token")
    expect(screen.getByText("60 entries")).toBeTruthy()
  })

  it("says nothing matches at zero, with a caption, and says reads are hidden", async () => {
    const { client } = recordingQueryClient({ "audit.list": EMPTY })
    renderPage(AuditPage, client)
    await screen.findByText("No audit entries match these filters.")
    expect(screen.getByText("0 entries")).toBeTruthy()
    expect(
      screen.getByText("Reads are hidden. Turn on Show reads to include them.")
    ).toBeTruthy()
  })

  it("drops the reads hint once reads are shown, or when an action is named", async () => {
    const { client } = recordingQueryClient({ "audit.list": EMPTY })
    renderPage(AuditPage, client)
    await screen.findByText("No audit entries match these filters.")
    const hint = "Reads are hidden. Turn on Show reads to include them."
    fireEvent.click(screen.getByRole("checkbox", { name: "Show reads" }))
    await waitFor(() => expect(screen.queryByText(hint)).toBeNull())
    expect(
      screen.getByText("No audit entries match these filters.")
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("checkbox", { name: "Show reads" }))
    await screen.findByText(hint)
    // An explicit action is always honoured, reads or not, so the hint would be wrong.
    fireEvent.change(select("Action"), { target: { value: "secret.get" } })
    await waitFor(() => expect(screen.queryByText(hint)).toBeNull())
  })
})
