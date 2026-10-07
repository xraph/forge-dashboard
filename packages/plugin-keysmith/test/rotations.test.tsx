import { afterEach, describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { RotationsPage } from "../src/pages/rotations"
import { keyPath } from "../src/format"
import type { KeyDetail, RotationItem, RotationsList } from "../src/types"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  renderRoutedPage,
  stubClient,
} from "./harness"

function rotation(over: Partial<RotationItem>): RotationItem {
  return {
    id: "krot_1",
    keyId: "akey_billing",
    keyName: "Billing service",
    prefix: "sk",
    environment: "live",
    oldHint: "9c1e",
    newHint: "a3f8",
    reason: "manual",
    graceSeconds: 86400,
    graceEnds: "2026-10-06T12:00:00Z",
    windowOpen: true,
    rotatedBy: "user_ops",
    rotatedAt: "2026-10-05T12:00:00Z",
    ...over,
  }
}

// Five rows, each exercising a different reason, window or absence.
const MANUAL = rotation({})
const COMPROMISE = rotation({
  id: "krot_2",
  keyId: "akey_partner",
  keyName: "Partner sandbox",
  environment: "staging",
  newHint: "42ad",
  reason: "compromise",
  graceSeconds: 0,
  graceEnds: "2026-10-04T09:00:00Z",
  windowOpen: false,
  rotatedAt: "2026-10-04T09:00:00Z",
})
const POLICY = rotation({
  id: "krot_3",
  keyId: "akey_reporting",
  keyName: "Reporting export",
  environment: "test",
  newHint: "3d0b",
  reason: "policy",
  graceSeconds: 3600,
  graceEnds: "2026-10-03T01:00:00Z",
  windowOpen: false,
  rotatedBy: undefined,
  rotatedAt: "2026-10-03T00:00:00Z",
})
// Written before hints existed: both hints are "".
const SCHEDULED = rotation({
  id: "krot_4",
  keyId: "akey_webhook",
  keyName: "Legacy webhook signer",
  prefix: "whk",
  oldHint: "",
  newHint: "",
  reason: "scheduled",
  graceSeconds: 172800,
  graceEnds: "2026-09-03T00:00:00Z",
  windowOpen: false,
  rotatedAt: "2026-09-01T00:00:00Z",
})
// The key no longer exists in this tenant: name, prefix and environment are
// null together, and the contract never reports its window open.
const GONE = rotation({
  id: "krot_5",
  keyId: "akey_deleted",
  keyName: null,
  prefix: null,
  environment: null,
  newHint: "77e1",
  reason: "manual",
  windowOpen: false,
  rotatedAt: "2026-08-01T00:00:00Z",
})

const LIST: RotationsList = {
  items: [MANUAL, COMPROMISE, POLICY, SCHEDULED, GONE],
  hasMore: false,
}

/** A client whose rotations.list answer depends on the params it was sent. */
function clientByParams(
  answer: (params: Record<string, unknown>) => RotationsList,
): { client: ScopedClient; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = []
  return {
    sent,
    client: {
      extension: "keysmith",
      query: async (intent: string, params?: Record<string, unknown>) => {
        if (intent !== "rotations.list") {
          throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
        }
        sent.push(params ?? {})
        return answer(params ?? {})
      },
      command: async () => {
        throw new ContractError("NOT_FOUND", "no commands")
      },
    } as ScopedClient,
  }
}

function rowWith(text: string): HTMLElement {
  const row = screen
    .getAllByRole("row")
    .find((r) => within(r).queryByText(text))
  if (!row) throw new Error(`no row with ${text}`)
  return row
}

function cellOf(row: HTMLElement, column: string): HTMLElement {
  const headers = screen
    .getAllByRole("columnheader")
    .map((h) => h.textContent)
  const index = headers.indexOf(column)
  if (index < 0) throw new Error(`no column ${column}`)
  return within(row).getAllByRole("cell")[index]!
}

describe("RotationsPage", () => {
  it("asks rotations.list for the first page with no reason", async () => {
    const { client, sent } = recordingQueryClient({ "rotations.list": LIST })
    renderPage(RotationsPage, client)
    await screen.findByText("Partner sandbox")
    const first = sent.find((s) => s.intent === "rotations.list")
    expect(first?.params).toEqual({ limit: 25, offset: 0 })
    expect(first?.params).not.toHaveProperty("reason")
  })

  it("says what the page lists", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    expect(screen.getByRole("heading", { name: "Rotations" })).toBeTruthy()
    expect(
      screen.getByText("Every rotation across keys, newest first."),
    ).toBeTruthy()
  })

  it("shows the columns in order, with a live count", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["When", "Key", "Reason", "Grace", "Window"])
    expect(screen.getByText("5 rotations")).toBeTruthy()
  })

  it("uses the singular for one rotation", async () => {
    renderPage(
      RotationsPage,
      stubClient({ "rotations.list": { items: [MANUAL], hasMore: false } }),
    )
    await screen.findByText("Billing service")
    expect(screen.getByText("1 rotation")).toBeTruthy()
  })

  it("shows when each rotation happened", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    const when = cellOf(rowWith("Billing service"), "When")
    expect(within(when).getByText(formatTimestamp("2026-10-05T12:00:00Z"))).toBeTruthy()
  })

  it("links the key name to its page and shows the new key masked in mono beneath", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    const link = await screen.findByRole("link", { name: "Billing service" })
    expect(link.getAttribute("href")).toBe(keyPath("akey_billing"))
    expect(link.closest("td")?.className).toMatch(/font-medium/)

    const cell = cellOf(rowWith("Billing service"), "Key")
    const masked = within(cell).getByText("sk_live_…a3f8")
    expect(masked.className).toMatch(/font-mono/)
    expect(masked.className).toMatch(/text-xs/)
    // The old key is the one that rotated away: not shown in the list.
    expect(within(cell).queryByText("sk_live_…9c1e")).toBeNull()
  })

  it("shows the key's id in mono and says the key no longer exists when it is gone", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    const row = rowWith("akey_deleted")
    const cell = cellOf(row, "Key")
    const id = within(cell).getByText("akey_deleted")
    expect(id.className).toMatch(/font-mono/)
    expect(id.className).toMatch(/text-xs/)
    expect(id.closest("a")).toBeNull()
    expect(within(cell).getByText("Key no longer exists")).toBeTruthy()
    expect(within(row).queryByRole("link")).toBeNull()
    // The rest of the row still renders.
    expect(within(row).getByText("Manual")).toBeTruthy()
    expect(cellOf(row, "Window").textContent).toBe("Closed")
  })

  it("says there is no hint on a record written before hints existed", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Legacy webhook signer")
    const cell = cellOf(rowWith("Legacy webhook signer"), "Key")
    const hint = within(cell).getByText("(no hint)")
    expect(hint.className).toMatch(/font-mono/)
    expect(within(cell).getByRole("link", { name: "Legacy webhook signer" })).toBeTruthy()
  })

  it("shows a badge per reason", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    const reason = (text: string) =>
      cellOf(rowWith(text), "Reason").querySelector('[data-slot="badge"]')
        ?.textContent
    expect(reason("Billing service")).toBe("Manual")
    expect(reason("Partner sandbox")).toBe("Compromise")
    expect(reason("Reporting export")).toBe("Policy")
    expect(reason("Legacy webhook signer")).toBe("Scheduled")
  })

  it("shows the grace as people say it, and None for a zero-grace rotation", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    expect(cellOf(rowWith("Billing service"), "Grace").textContent).toBe("1 day")
    expect(cellOf(rowWith("Reporting export"), "Grace").textContent).toBe("1 hour")
    expect(cellOf(rowWith("Legacy webhook signer"), "Grace").textContent).toBe("2 days")
    expect(cellOf(rowWith("Partner sandbox"), "Grace").textContent).toBe("None")
  })

  it("says when an open window ends, without claiming the old key works", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    const open = cellOf(rowWith("Billing service"), "Window")
    expect(open.textContent).toBe(
      `Window ends ${formatTimestamp("2026-10-06T12:00:00Z")}`,
    )
    // A suspended key's window is open, but its old key does not validate.
    expect(screen.queryByText(/keeps working/)).toBeNull()
    expect(screen.queryByText(/Open until/)).toBeNull()
  })

  it("says Closed for a window that has closed", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    expect(cellOf(rowWith("Partner sandbox"), "Window").textContent).toBe("Closed")
    expect(cellOf(rowWith("Reporting export"), "Window").textContent).toBe("Closed")
  })

  it("never shows an open window for a key that no longer exists", async () => {
    // The contract answers false here; the page holds the same line if a
    // fixture or an older server does not.
    const stray = { ...GONE, windowOpen: true }
    renderPage(
      RotationsPage,
      stubClient({ "rotations.list": { items: [stray], hasMore: false } }),
    )
    await screen.findByText("akey_deleted")
    expect(cellOf(rowWith("akey_deleted"), "Window").textContent).toBe("Closed")
  })

  it("shows who rotated in mono on a muted line under the time, with no column of its own", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    const when = cellOf(rowWith("Billing service"), "When")
    expect(when.textContent).toBe(
      `${formatTimestamp("2026-10-05T12:00:00Z")}by user_ops`,
    )
    const by = within(when).getByText("user_ops")
    expect(by.className).toMatch(/font-mono/)
    const line = by.parentElement!
    expect(line.textContent).toBe("by user_ops")
    expect(line.className).toMatch(/text-muted-foreground/)
    expect(line.className).toMatch(/text-xs/)
    expect(screen.queryByRole("columnheader", { name: "Rotated by" })).toBeNull()
  })

  it("says no actor was recorded on that line when nobody was", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    const when = cellOf(rowWith("Reporting export"), "When")
    const none = within(when).getByLabelText("no actor recorded")
    expect(none.parentElement!.className).toMatch(/text-muted-foreground/)
  })

  it("says so when there are no rotations yet", async () => {
    renderPage(
      RotationsPage,
      stubClient({ "rotations.list": { items: [], hasMore: false } }),
    )
    expect(await screen.findByText("No rotations yet.")).toBeTruthy()
    expect(screen.getByText("0 rotations")).toBeTruthy()
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull()
  })

  it("offers the reasons the contract accepts", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    const options = within(screen.getByLabelText("Reason"))
      .getAllByRole("option")
      .map((o) => o.textContent)
    expect(options).toEqual(["All", "Manual", "Compromise", "Policy", "Scheduled"])
  })

  it("filters by reason, sending only the chosen value", async () => {
    const { client, sent } = recordingQueryClient({ "rotations.list": LIST })
    renderPage(RotationsPage, client)
    await screen.findByText("Partner sandbox")

    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "compromise" },
    })
    await screen.findByText("Partner sandbox")
    const calls = sent
      .filter((s) => s.intent === "rotations.list")
      .map((s) => s.params)
    expect(calls).toContainEqual({ limit: 25, offset: 0, reason: "compromise" })

    // Back to All: no reason key at all, not an empty string.
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "" } })
    await screen.findByText("Partner sandbox")
    const last = sent.filter((s) => s.intent === "rotations.list").at(-1)
    expect(last?.params).toEqual({ limit: 25, offset: 0 })
  })

  it("says no rotations match when a reason finds nothing, and keeps the filter", async () => {
    const { client } = clientByParams((params) =>
      params.reason === "scheduled" ? { items: [], hasMore: false } : LIST,
    )
    renderPage(RotationsPage, client)
    await screen.findByText("Partner sandbox")
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "scheduled" },
    })
    expect(await screen.findByText("No rotations match this reason.")).toBeTruthy()
    expect(screen.queryByText("No rotations yet.")).toBeNull()
    expect((screen.getByLabelText("Reason") as HTMLSelectElement).value).toBe(
      "scheduled",
    )
  })

  it("shows no pager when everything fits on one page", async () => {
    renderPage(RotationsPage, stubClient({ "rotations.list": LIST }))
    await screen.findByText("Partner sandbox")
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull()
  })

  it("pages forward and back by hasMore", async () => {
    const { client, sent } = clientByParams((params) =>
      params.offset === 0
        ? { items: [MANUAL, COMPROMISE], hasMore: true }
        : { items: [POLICY], hasMore: false },
    )
    renderPage(RotationsPage, client)
    await screen.findByText("Partner sandbox")

    const previous = () =>
      screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement
    const next = () =>
      screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement
    expect(previous().disabled).toBe(true)
    expect(next().disabled).toBe(false)
    expect(screen.getByText("Rotations 1 to 2, more on the next page")).toBeTruthy()

    fireEvent.click(next())
    await screen.findByText("Reporting export")
    expect(sent.at(-1)).toEqual({ limit: 25, offset: 25 })
    expect(previous().disabled).toBe(false)
    expect(next().disabled).toBe(true)
    expect(screen.getByText("Rotations 26 to 26")).toBeTruthy()

    fireEvent.click(previous())
    await screen.findByText("Partner sandbox")
    expect(sent.at(-1)).toEqual({ limit: 25, offset: 0 })
  })

  it("goes back to the first page when the reason changes", async () => {
    const { client, sent } = clientByParams((params) =>
      params.offset === 0
        ? { items: [MANUAL], hasMore: true }
        : { items: [POLICY], hasMore: false },
    )
    renderPage(RotationsPage, client)
    await screen.findByText("Billing service")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("Reporting export")

    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "manual" },
    })
    await screen.findByText("Billing service")
    expect(sent.at(-1)).toEqual({ limit: 25, offset: 0, reason: "manual" })
  })

  it("offers a way back when a later page comes back empty", async () => {
    // Page two held rows when Next was offered; by the time it is read they
    // have gone. That is not "no rotations yet".
    const { client, sent } = clientByParams((params) =>
      params.offset === 0
        ? { items: [MANUAL], hasMore: true }
        : { items: [], hasMore: false },
    )
    renderPage(RotationsPage, client)
    await screen.findByText("Billing service")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))

    expect(await screen.findByText("No rotations on this page.")).toBeTruthy()
    expect(screen.queryByText("No rotations yet.")).toBeNull()
    // Nothing beneath it: a caption here would only repeat the message.
    expect(screen.queryByText(/No rotations from/)).toBeNull()
    expect(screen.queryByText(/^Rotations \d/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Back to the first page" }))
    await screen.findByText("Billing service")
    expect(sent.at(-1)).toEqual({ limit: 25, offset: 0 })
  })

  it("shows the error state with the message when the list fails", async () => {
    renderPage(
      RotationsPage,
      failingClient(new ContractError("INTERNAL", "rotations store is down")),
    )
    expect(await screen.findByText(/rotations store is down/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// A key carried in from its page: /rotations?keyId=<id>

const BILLING_DETAIL: KeyDetail = {
  key: {
    id: "akey_billing",
    name: "Billing service",
    prefix: "sk",
    hint: "a3f8",
    environment: "live",
    state: "active",
    effectiveState: "active",
    expiryPending: false,
    expiresSoon: false,
    scopes: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
  policy: null,
  metadata: {},
  previousKeys: [],
}

/**
 * Answers rotations.list by its params and keys.detail with `detail`, or
 * refuses keys.detail when `detail` is a ContractError. Records every read.
 */
function keyedClient(
  list: (params: Record<string, unknown>) => RotationsList,
  detail: KeyDetail | ContractError = BILLING_DETAIL,
): { client: ScopedClient; sent: { intent: string; params: Record<string, unknown> }[] } {
  const sent: { intent: string; params: Record<string, unknown> }[] = []
  return {
    sent,
    client: {
      extension: "keysmith",
      query: async (intent: string, params?: Record<string, unknown>) => {
        sent.push({ intent, params: params ?? {} })
        if (intent === "rotations.list") return list(params ?? {})
        if (intent === "keys.detail") {
          if (detail instanceof ContractError) throw detail
          return detail
        }
        throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
      },
      command: async () => {
        throw new ContractError("NOT_FOUND", "no commands")
      },
    } as ScopedClient,
  }
}

function listCalls(sent: { intent: string; params: Record<string, unknown> }[]) {
  return sent.filter((s) => s.intent === "rotations.list").map((s) => s.params)
}

function keyFilter(): HTMLElement {
  return screen.getByRole("group", { name: "Key filter" })
}

describe("RotationsPage with a key in the address", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/")
  })

  function openAt(search: string) {
    window.history.replaceState(null, "", `/@keysmith/rotations${search}`)
  }

  it("asks nothing about a key when the address names none", async () => {
    const { client, sent } = keyedClient(() => LIST)
    renderRoutedPage(RotationsPage, client)
    await screen.findByText("Partner sandbox")
    expect(sent.some((s) => s.intent === "keys.detail")).toBe(false)
    expect(screen.queryByRole("group", { name: "Key filter" })).toBeNull()
  })

  it("narrows the list to that key and names it from keys.detail", async () => {
    openAt("?keyId=akey_billing")
    const { client, sent } = keyedClient(() => ({ items: [MANUAL], hasMore: false }))
    renderRoutedPage(RotationsPage, client)
    await within(keyFilter()).findByText("Billing service")
    expect(listCalls(sent)[0]).toEqual({ limit: 25, offset: 0, keyId: "akey_billing" })
    expect(sent.find((s) => s.intent === "keys.detail")?.params).toEqual({
      id: "akey_billing",
    })
    expect(within(keyFilter()).getByText(/^Key/)).toBeTruthy()
  })

  it("shows the key's id in mono when keys.detail cannot name it", async () => {
    openAt("?keyId=akey_deleted")
    const { client } = keyedClient(
      () => ({ items: [GONE], hasMore: false }),
      new ContractError("NOT_FOUND", "key not found"),
    )
    renderRoutedPage(RotationsPage, client)
    await screen.findByText("1 rotation")
    const id = await within(keyFilter()).findByText("akey_deleted")
    expect(id.className).toMatch(/font-mono/)
    // The refusal names nothing the page needs; it is not an error card.
    expect(screen.queryByText(/key not found/)).toBeNull()
  })

  it("clears the key from the list and from the address", async () => {
    openAt("?keyId=akey_billing")
    const { client, sent } = keyedClient((params) =>
      params.keyId ? { items: [MANUAL], hasMore: false } : LIST,
    )
    const { router } = renderRoutedPage(RotationsPage, client)
    await within(keyFilter()).findByText("Billing service")
    const length = window.history.length

    fireEvent.click(screen.getByRole("button", { name: "Clear the key filter" }))
    await screen.findByText("Partner sandbox")
    expect(listCalls(sent).at(-1)).toEqual({ limit: 25, offset: 0 })
    expect(screen.queryByRole("group", { name: "Key filter" })).toBeNull()
    expect(window.location.search).toBe("")
    // Through the router, replacing the entry, so Back leaves the page.
    expect(router.navigations).toEqual([{ to: "/@keysmith/rotations", replace: true }])
    expect(window.history.length).toBe(length)
  })

  it("keeps the router in step, and the sidebar never carries the key", async () => {
    openAt("?keyId=akey_billing")
    const { client } = keyedClient((params) =>
      params.keyId ? { items: [MANUAL], hasMore: false } : LIST,
    )
    const { router } = renderRoutedPage(RotationsPage, client)
    await within(keyFilter()).findByText("Billing service")
    const sidebar = () => screen.getByRole("link", { name: "Sidebar rotations" })
    expect(router.search).toBe("?keyId=akey_billing")
    // The host carries context only, and the key is the page's own.
    expect(sidebar().getAttribute("href")).toBe("/@keysmith/rotations")

    fireEvent.click(screen.getByRole("button", { name: "Clear the key filter" }))
    await screen.findByText("Partner sandbox")
    await waitFor(() => expect(router.search).toBe(""))
    expect(sidebar().getAttribute("href")).toBe("/@keysmith/rotations")
  })

  it("leaves the page on Back after a clear, without stepping back to the key", async () => {
    window.history.replaceState(null, "", "/@keysmith/keys")
    window.history.pushState(null, "", "/@keysmith/rotations?keyId=akey_billing")
    const { client } = keyedClient((params) =>
      params.keyId ? { items: [MANUAL], hasMore: false } : LIST,
    )
    renderRoutedPage(RotationsPage, client)
    await within(keyFilter()).findByText("Billing service")
    fireEvent.click(screen.getByRole("button", { name: "Clear the key filter" }))
    await screen.findByText("Partner sandbox")

    act(() => window.history.back())
    await waitFor(() => expect(window.location.pathname).toBe("/@keysmith/keys"))
    expect(window.location.search).toBe("")
  })

  it("keeps the key while paging and filtering by reason", async () => {
    openAt("?keyId=akey_billing")
    const { client, sent } = keyedClient((params) =>
      params.offset === 0
        ? { items: [MANUAL], hasMore: true }
        : { items: [{ ...MANUAL, id: "krot_9", reason: "policy" }], hasMore: false },
    )
    renderRoutedPage(RotationsPage, client)
    await within(keyFilter()).findByText("Billing service")

    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("Rotations 26 to 26")
    expect(listCalls(sent).at(-1)).toEqual({ limit: 25, offset: 25, keyId: "akey_billing" })

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "manual" } })
    await screen.findByText("Rotations 1 to 1, more on the next page")
    expect(listCalls(sent).at(-1)).toEqual({
      limit: 25,
      offset: 0,
      keyId: "akey_billing",
      reason: "manual",
    })
  })

  it("goes back to the first page when the key is cleared", async () => {
    openAt("?keyId=akey_billing")
    const { client, sent } = keyedClient((params) =>
      params.offset === 0
        ? { items: [MANUAL], hasMore: true }
        : { items: [POLICY], hasMore: false },
    )
    renderRoutedPage(RotationsPage, client)
    await within(keyFilter()).findByText("Billing service")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("Reporting export")

    fireEvent.click(screen.getByRole("button", { name: "Clear the key filter" }))
    await screen.findByText("Rotations 1 to 1, more on the next page")
    expect(listCalls(sent).at(-1)).toEqual({ limit: 25, offset: 0 })

    // The same key again, from the address: its first page, not the one left.
    act(() => {
      window.history.replaceState(null, "", "/@keysmith/rotations?keyId=akey_billing")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    await within(keyFilter()).findByText("Billing service")
    await screen.findByText("Rotations 1 to 1, more on the next page")
    expect(listCalls(sent).at(-1)).toEqual({ limit: 25, offset: 0, keyId: "akey_billing" })
  })

  it("says the key has not been rotated, and says so apart from a reason that matches nothing", async () => {
    openAt("?keyId=akey_billing")
    const { client } = keyedClient(() => ({ items: [], hasMore: false }))
    renderRoutedPage(RotationsPage, client)
    expect(await screen.findByText("This key has not been rotated.")).toBeTruthy()
    expect(screen.queryByText("No rotations yet.")).toBeNull()

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "compromise" } })
    expect(
      await screen.findByText("No rotations of this key match this reason."),
    ).toBeTruthy()
    await waitFor(() =>
      expect(screen.queryByText("This key has not been rotated.")).toBeNull(),
    )
  })
})
