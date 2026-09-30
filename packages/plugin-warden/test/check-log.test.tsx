import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import {
  CheckRequestLine,
  DECISIONS,
  decisionVariant,
  formatEvalTime,
  type CheckLogList,
  type CheckSummary,
} from "../src/components/check-log"
import { WardenCheckLogPage } from "../src/pages/check-log"
import { recordingQueryClient, renderPage } from "./harness"

const ALICE: CheckSummary = {
  id: "chk_01a",
  namespacePath: "",
  subjectKind: "user",
  subjectId: "alice",
  action: "read",
  resourceType: "document",
  resourceId: "readme",
  decision: "allow",
  evalTimeNs: 412_000,
  cached: false,
  createdAt: "2026-09-23T10:00:00Z",
}

const DEPLOYER: CheckSummary = {
  id: "chk_01b",
  namespacePath: "eng/platform",
  subjectKind: "service",
  subjectId: "deployer",
  action: "admin",
  resourceType: "cluster",
  resourceId: "prod",
  decision: "error",
  evalTimeNs: 0,
  cached: true,
  error: "store unavailable",
  createdAt: "2026-09-23T10:01:00Z",
}

function list(over: Partial<CheckLogList> = {}): CheckLogList {
  return { items: [ALICE, DEPLOYER], total: 2, limit: 25, offset: 0, ...over }
}

function config(checkLogEnabled: boolean) {
  return { checkLogEnabled }
}

/** The stub every page test starts from: logging on, two rows, two namespaces. */
function answers(extra: Record<string, unknown> = {}) {
  return {
    "checkLogs.list": list(),
    "config.detail": config(true),
    "namespaces.list": { namespaces: ["", "eng/platform"] },
    ...extra,
  }
}

function render_(extra: Record<string, unknown> = {}) {
  const { client, sent } = recordingQueryClient(answers(extra))
  const view = renderPage(WardenCheckLogPage, client)
  const lists = () =>
    sent.filter((s) => s.intent === "checkLogs.list").map((s) => s.params as Record<string, unknown>)
  const last = () => lists()[lists().length - 1]
  return { ...view, client, sent, lists, last }
}

/** Waits for the row table, so a test starts from a settled page. */
async function settled() {
  await screen.findByText("user:alice")
}

describe("formatEvalTime", () => {
  it("renders 100,000 ns and above as milliseconds with two decimals", () => {
    expect(formatEvalTime(412_000)).toBe("0.41 ms")
    expect(formatEvalTime(1_800_000)).toBe("1.80 ms")
    expect(formatEvalTime(100_000)).toBe("0.10 ms")
  })

  it("renders 1000 ns up to 100,000 ns as microseconds with one decimal", () => {
    expect(formatEvalTime(1_800)).toBe("1.8 µs")
    expect(formatEvalTime(1_000)).toBe("1.0 µs")
    expect(formatEvalTime(99_900)).toBe("99.9 µs")
  })

  it("renders anything below 1000 ns as a plain nanosecond count", () => {
    expect(formatEvalTime(640)).toBe("640 ns")
    expect(formatEvalTime(999)).toBe("999 ns")
    expect(formatEvalTime(1)).toBe("1 ns")
    expect(formatEvalTime(0)).toBe("0 ns")
  })

  it("switches unit exactly at the 1000 and 100,000 boundaries", () => {
    expect(formatEvalTime(999)).toBe("999 ns")
    expect(formatEvalTime(1_000)).toBe("1.0 µs")
    expect(formatEvalTime(99_999)).toBe("100.0 µs")
    expect(formatEvalTime(100_000)).toBe("0.10 ms")
  })
})

describe("CheckRequestLine", () => {
  it("shows kind:id, the action and type:id, identifiers in mono, with no arrow", () => {
    const { container } = render(<CheckRequestLine check={ALICE} />)
    const subject = screen.getByText("user:alice")
    const resource = screen.getByText("document:readme")
    expect(subject.className).toContain("font-mono")
    expect(subject.className).toContain("text-xs")
    expect(resource.className).toContain("font-mono")
    expect(resource.className).toContain("text-xs")
    expect(screen.getByText("read")).toBeTruthy()
    expect(container.textContent).not.toMatch(/[→⇒>➔➜]/)
  })
})

describe("decisionVariant", () => {
  it("interrupts only for error, and outlines allow", () => {
    expect(decisionVariant("error")).toBe("destructive")
    expect(decisionVariant("allow")).toBe("outline")
    expect(decisionVariant("deny_explicit")).toBe("secondary")
  })

  it("lists all nine decisions, allow first and error last", () => {
    expect(DECISIONS).toHaveLength(9)
    expect(DECISIONS[0]).toBe("allow")
    expect(DECISIONS[8]).toBe("error")
  })
})

describe("subject links in the check log", () => {
  it("links each row's subject to its access page, encoded", async () => {
    render_({
      "checkLogs.list": list({
        items: [{ ...ALICE, subjectKind: "api key", subjectId: "a/b" }],
        total: 1,
      }),
    })
    const link = await screen.findByRole("link", { name: "api key:a/b" })
    expect(link.getAttribute("href")).toBe("/subjects/api%20key/a%2Fb")
  })

  it("leaves a subject with no kind as plain text", async () => {
    render_({ "checkLogs.list": list({ items: [{ ...DEPLOYER, subjectKind: "" }], total: 1 }) })
    const text = await screen.findByText(":deployer")
    expect(text.closest("a")).toBeNull()
  })

  it("links the request line's subject too", () => {
    render(<CheckRequestLine check={ALICE} />)
    expect(screen.getByRole("link", { name: "user:alice" }).getAttribute("href")).toBe(
      "/subjects/user/alice",
    )
  })
})

describe("WardenCheckLogPage rows", () => {
  it("links each timestamp to the check's own page", async () => {
    const { container } = render_()
    await settled()
    const link = container.querySelector('a[href="/check-log/chk_01a"]')!
    expect(link).toBeTruthy()
    expect(link.textContent).toBe(formatTimestamp(ALICE.createdAt))
    expect(container.querySelector('a[href="/check-log/chk_01b"]')).toBeTruthy()
  })

  it("shows the subject in font-medium and the resource in mono", async () => {
    render_()
    const subject = await screen.findByText("user:alice")
    expect(subject.className).toContain("font-medium")
    const resource = screen.getByText("document:readme")
    expect(resource.className).toContain("font-mono")
    expect(resource.className).toContain("text-xs")
  })

  it("shows the namespace, the root as a slash", async () => {
    render_()
    await settled()
    expect(screen.getByText("eng/platform", { selector: "span" })).toBeTruthy()
    expect(screen.getAllByText("/").length).toBeGreaterThan(0)
  })

  it("badges the decision and whether the check was cached", async () => {
    render_()
    const row = (await screen.findByText("user:alice")).closest("tr")!
    expect(within(row).getByText("allow").getAttribute("data-slot")).toBe("badge")
    expect(within(row).getByText("not cached").getAttribute("data-slot")).toBe("badge")
    const other = screen.getByText("service:deployer").closest("tr")!
    expect(within(other).getByText("cached").getAttribute("data-slot")).toBe("badge")
  })

  it("counts the server's total in the caption, singular at one and 0 at zero", async () => {
    const many = render_({ "checkLogs.list": list({ total: 60 }) })
    expect(await screen.findByText("60 checks")).toBeTruthy()
    many.unmount()

    const one = render_({ "checkLogs.list": list({ items: [ALICE], total: 1 }) })
    expect(await screen.findByText("1 check")).toBeTruthy()
    one.unmount()

    render_({ "checkLogs.list": list({ items: [], total: 0 }) })
    expect(await screen.findByText("0 checks")).toBeTruthy()
  })

  it("shows an error row's badge as destructive with its error text", async () => {
    render_()
    const row = (await screen.findByText("service:deployer")).closest("tr")!
    expect(within(row).getByText("error").getAttribute("data-variant")).toBe("destructive")
    expect(within(row).getByText("store unavailable").className).toContain("text-destructive")
  })
})

describe("WardenCheckLogPage filters", () => {
  it("sends only limit and offset before any filter is set", async () => {
    const t = render_()
    await settled()
    expect(Object.keys(t.lists()[0]).sort()).toEqual(["limit", "offset"])
    expect(t.lists()[0]).toMatchObject({ limit: 25, offset: 0 })
  })

  it("sends the namespace and goes back to page 1", async () => {
    const t = render_({ "checkLogs.list": list({ total: 60 }) })
    await settled()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(t.last().offset).toBe(25))
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
    await waitFor(() => expect(t.last().namespacePath).toBe("eng/platform"))
    expect(t.last().offset).toBe(0)
  })

  it("sends the tenant root as an empty namespacePath, not as an absent key", async () => {
    const t = render_()
    await settled()
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "" } })
    await waitFor(() => expect("namespacePath" in t.last()).toBe(true))
    expect(t.last().namespacePath).toBe("")
  })

  it("offers any decision plus every decision the engine records", async () => {
    render_()
    await settled()
    const select = screen.getByLabelText("Decision") as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual(["", ...DECISIONS])
    expect(select.options[0].textContent).toBe("Any decision")
  })

  it("sends the chosen decision, resets to page 1, and drops the key for any", async () => {
    const t = render_({ "checkLogs.list": list({ total: 60 }) })
    await settled()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(t.last().offset).toBe(25))
    for (const decision of DECISIONS) {
      fireEvent.change(screen.getByLabelText("Decision"), { target: { value: decision } })
      await waitFor(() => expect(t.last().decision).toBe(decision))
      expect(t.last().offset).toBe(0)
      expect(Object.keys(t.last()).sort()).toEqual(["decision", "limit", "offset"])
    }
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "" } })
    await waitFor(() => expect(Object.keys(t.last()).sort()).toEqual(["limit", "offset"]))
  })

  it("sends cached true, cached false, or no cached key at all", async () => {
    const t = render_({ "checkLogs.list": list({ total: 60 }) })
    await settled()
    const select = screen.getByLabelText("Cached") as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Any",
      "Cached",
      "Not cached",
    ])
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(t.last().offset).toBe(25))

    fireEvent.change(select, { target: { value: "cached" } })
    await waitFor(() => expect(t.last().cached).toBe(true))
    expect(t.last().offset).toBe(0)

    fireEvent.change(select, { target: { value: "evaluated" } })
    await waitFor(() => expect(t.last().cached).toBe(false))
    expect("cached" in t.last()).toBe(true)

    fireEvent.change(select, { target: { value: "" } })
    await waitFor(() => expect("cached" in t.last()).toBe(false))
    expect(Object.keys(t.last()).sort()).toEqual(["limit", "offset"])
  })

  it("sends the time window as an ISO instant, and no key for any time", async () => {
    const t = render_({ "checkLogs.list": list({ total: 60 }) })
    await settled()
    const select = screen.getByLabelText("Time") as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Any time",
      "Last hour",
      "Last 24 hours",
      "Last 7 days",
      "Last 30 days",
    ])
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(t.last().offset).toBe(25))

    const hour = 3_600_000
    const windows: [string, number][] = [
      ["1h", hour],
      ["24h", 24 * hour],
      ["7d", 7 * 24 * hour],
      ["30d", 30 * 24 * hour],
    ]
    for (const [value, ms] of windows) {
      const before = Date.now()
      fireEvent.change(select, { target: { value } })
      await waitFor(() => expect(typeof t.last().after).toBe("string"))
      const after = t.last().after as string
      expect(after).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(Math.abs(Date.parse(after) - (before - ms))).toBeLessThan(1000)
      expect(t.last().offset).toBe(0)
      expect("before" in t.last()).toBe(false)
    }

    fireEvent.change(select, { target: { value: "" } })
    await waitFor(() => expect("after" in t.last()).toBe(false))
    expect(Object.keys(t.last()).sort()).toEqual(["limit", "offset"])
  })

  it("keeps the window fixed across a refetch, so the query key is stable", async () => {
    const t = render_({ "checkLogs.list": list({ total: 60 }) })
    await settled()
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "1h" } })
    await waitFor(() => expect(typeof t.last().after).toBe("string"))
    const first = t.last().after
    // A page change and back re-reads the same window with the same instant.
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await waitFor(() => expect(t.last().offset).toBe(25))
    expect(t.last().after).toBe(first)
  })

  it("says since when for a time window in the caption, and not otherwise", async () => {
    render_({ "checkLogs.list": list({ total: 60 }) })
    await settled()
    expect(screen.getByText("60 checks")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "24h" } })
    expect(await screen.findByText(/^60 checks since /)).toBeTruthy()
  })
})

describe("WardenCheckLogPage exact-match fields", () => {
  it("labels every exact-match field and offers the four subject kinds", async () => {
    render_()
    await settled()
    const kind = screen.getByLabelText("Subject kind") as HTMLSelectElement
    expect(Array.from(kind.options).map((o) => o.value)).toEqual([
      "",
      "user",
      "api_key",
      "service",
      "service_acct",
    ])
    for (const label of ["Subject id", "Action", "Resource type", "Resource id"]) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
  })

  it("sends nothing while typing, and the filled fields on Apply", async () => {
    const t = render_({ "checkLogs.list": list({ total: 60 }) })
    await settled()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(t.last().offset).toBe(25))
    const before = t.lists().length

    fireEvent.change(screen.getByLabelText("Subject kind"), { target: { value: "user" } })
    fireEvent.change(screen.getByLabelText("Subject id"), { target: { value: "alice" } })
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "read" } })
    fireEvent.change(screen.getByLabelText("Resource type"), { target: { value: "document" } })
    fireEvent.change(screen.getByLabelText("Resource id"), { target: { value: "readme" } })
    await new Promise((r) => setTimeout(r, 30))
    expect(t.lists().length).toBe(before)

    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(t.last().subjectId).toBe("alice"))
    expect(t.last()).toMatchObject({
      subjectKind: "user",
      subjectId: "alice",
      action: "read",
      resourceType: "document",
      resourceId: "readme",
      offset: 0,
    })
  })

  it("sends no key for a blank exact-match field", async () => {
    const t = render_()
    await settled()
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "read" } })
    fireEvent.change(screen.getByLabelText("Resource id"), { target: { value: "   " } })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(t.last().action).toBe("read"))
    expect(Object.keys(t.last()).sort()).toEqual(["action", "limit", "offset"])
  })

  it("Clear removes all five and goes back to page 1", async () => {
    const t = render_({ "checkLogs.list": list({ total: 60 }) })
    await settled()
    fireEvent.change(screen.getByLabelText("Subject kind"), { target: { value: "service" } })
    fireEvent.change(screen.getByLabelText("Subject id"), { target: { value: "deployer" } })
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "admin" } })
    fireEvent.change(screen.getByLabelText("Resource type"), { target: { value: "cluster" } })
    fireEvent.change(screen.getByLabelText("Resource id"), { target: { value: "prod" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    await waitFor(() => expect(t.last().resourceId).toBe("prod"))
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await waitFor(() => expect(t.last().offset).toBe(25))

    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    await waitFor(() => expect("resourceId" in t.last()).toBe(false))
    expect(Object.keys(t.last()).sort()).toEqual(["limit", "offset"])
    expect(t.last().offset).toBe(0)
    expect((screen.getByLabelText("Subject id") as HTMLInputElement).value).toBe("")
    expect((screen.getByLabelText("Subject kind") as HTMLSelectElement).value).toBe("")
  })

  it("says the deciding rule cannot be filtered yet", async () => {
    render_()
    await settled()
    expect(
      screen.getByText("Checks cannot be filtered by the rule that decided them yet.")
    ).toBeTruthy()
  })
})

describe("WardenCheckLogPage paging", () => {
  it("sends offset 25 for page 2", async () => {
    const t = render_({ "checkLogs.list": list({ total: 60 }) })
    await settled()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(t.last().offset).toBe(25))
    expect(t.last().limit).toBe(25)
  })

  it("pages by the size it asked for, not the size the reply echoes", async () => {
    // The offset is (page - 1) * 25, so the page count must divide by 25 too.
    render_({ "checkLogs.list": list({ total: 60, limit: 10 }) })
    await settled()
    expect(screen.getByText("Page 1 of 3, 60 total")).toBeTruthy()
  })

  it("goes back to page 1 when the current page has run past the end of the set", async () => {
    // Retention can shrink the set while an operator is on a later page.
    const { client, sent } = recordingQueryClient(answers({ "checkLogs.list": list({ total: 60 }) }))
    const shrunk = {
      ...client,
      query: (intent: string, params?: Record<string, unknown>) => {
        if (intent === "checkLogs.list" && params?.offset === 25) {
          sent.push({ intent, params })
          return Promise.resolve(list({ items: [], total: 30, offset: 25 }))
        }
        return client.query(intent, params)
      },
    } as ScopedClient
    renderPage(WardenCheckLogPage, shrunk)
    await settled()
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => {
      const lists = sent.filter((s) => s.intent === "checkLogs.list")
      expect(lists.some((s) => (s.params as { offset: number }).offset === 25)).toBe(true)
      expect((lists[lists.length - 1].params as { offset: number }).offset).toBe(0)
    })
    expect(await screen.findByText("user:alice")).toBeTruthy()
  })
})

describe("WardenCheckLogPage empties", () => {
  const EMPTY = list({ items: [], total: 0 })
  const LOGGING_OFF = "Check logging is off on this server, so it records no checks."
  const WERE_RECORDED =
    "These rows were written by a server with logging on, or before logging was turned off."

  it("says logging is off, and that the rows predate it, when rows exist", async () => {
    render_({ "config.detail": config(false) })
    await settled()
    expect(await screen.findByText(`${LOGGING_OFF} ${WERE_RECORDED}`)).toBeTruthy()
  })

  it("says logging is off, without the rows sentence, when there are none", async () => {
    render_({ "config.detail": config(false), "checkLogs.list": EMPTY })
    expect(await screen.findByText(LOGGING_OFF)).toBeTruthy()
    expect(screen.queryByText(new RegExp(WERE_RECORDED))).toBeNull()
    // Said once: the alert carries it, the empty state must not repeat it.
    expect(screen.getAllByText(new RegExp(LOGGING_OFF))).toHaveLength(1)
    expect(screen.getByText("No checks are in the log.")).toBeTruthy()
    expect(screen.queryByText(/recorded yet/)).toBeNull()
  })

  it("does not say logging is off when it is on", async () => {
    render_()
    await settled()
    expect(screen.queryByText(new RegExp(LOGGING_OFF))).toBeNull()
  })

  it("says what the log holds, not that nothing was recorded yet, with logging on and no filters", async () => {
    // A purge can empty a log that was once full, so "recorded yet" is false.
    render_({ "checkLogs.list": EMPTY })
    expect(await screen.findByText("No checks are in the log.")).toBeTruthy()
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByText("No checks are in the log.")).toBeTruthy()
    expect(screen.queryByText(/recorded yet/)).toBeNull()
  })

  it("says no checks match with logging on and a filter set", async () => {
    render_({ "checkLogs.list": EMPTY })
    await screen.findByText("No checks are in the log.")
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "deny_default" } })
    expect(await screen.findByText("No checks match these filters.")).toBeTruthy()
    expect(screen.queryByText("No checks are in the log.")).toBeNull()
  })

  it("says no checks match for an applied exact-match field", async () => {
    render_({ "checkLogs.list": EMPTY })
    await screen.findByText("No checks are in the log.")
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "read" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(await screen.findByText("No checks match these filters.")).toBeTruthy()
  })

  it("does not claim a filter with logging off and a filter set", async () => {
    render_({ "config.detail": config(false), "checkLogs.list": EMPTY })
    await screen.findByText(LOGGING_OFF)
    fireEvent.change(screen.getByLabelText("Cached"), { target: { value: "cached" } })
    expect(await screen.findByText("No checks match these filters.")).toBeTruthy()
  })

  it("says only what the log holds when config.detail fails and the list is empty", async () => {
    const { client } = recordingQueryClient({
      "checkLogs.list": EMPTY,
      "namespaces.list": { namespaces: [""] },
    })
    renderPage(WardenCheckLogPage, client)
    expect(await screen.findByText("No checks are in the log.")).toBeTruthy()
    // Give the failed config read time to settle, then check it did not flip.
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByText("No checks are in the log.")).toBeTruthy()
    expect(screen.queryByText(/recorded yet/)).toBeNull()
    expect(screen.queryByText(new RegExp(LOGGING_OFF))).toBeNull()
  })

  it("makes no claim about logging when config.detail fails", async () => {
    // The stub refuses config.detail, so the page has no way to know.
    const { client } = recordingQueryClient({
      "checkLogs.list": list(),
      "namespaces.list": { namespaces: [""] },
    })
    renderPage(WardenCheckLogPage, client)
    await settled()
    expect(screen.queryByText(/Check logging is off/)).toBeNull()
    expect(screen.queryByText(/turned off/)).toBeNull()
    expect(screen.queryByText(/records no checks/)).toBeNull()
  })
})

describe("WardenCheckLogPage loss line", () => {
  const SINCE = "2026-09-23T08:00:00Z"
  const TRAILER =
    "Those checks ran, and the log may have no row for them. The count covers every tenant this server handles."

  it("counts what the server failed to record, with both causes and the trailer", async () => {
    const { container } = render_({
      "checkLogs.list": list({ notRecorded: { queueFull: 3, writeFailed: 1, since: SINCE } }),
    })
    await settled()
    const text = container.textContent ?? ""
    expect(text).toContain("This server failed to record 4 checks since it started")
    expect(text).toContain("3 dropped before they reached the store, 1 because writing it to the store failed")
    expect(text).toContain(TRAILER)
    expect(text).toContain(formatTimestamp(SINCE))
  })

  it("puts the start time in one element of its own", async () => {
    render_({
      "checkLogs.list": list({ notRecorded: { queueFull: 3, writeFailed: 1, since: SINCE } }),
    })
    const since = await screen.findByText(formatTimestamp(SINCE))
    expect(since.tagName).toBe("SPAN")
  })

  it("says only the queue clause when nothing failed to write", async () => {
    const { container } = render_({
      "checkLogs.list": list({ notRecorded: { queueFull: 3, writeFailed: 0, since: SINCE } }),
    })
    await settled()
    const text = container.textContent ?? ""
    expect(text).toContain("failed to record 3 checks")
    expect(text).toContain("3 dropped before they reached the store")
    expect(text).not.toContain("writing them to the store failed")
  })

  it("says only the write clause when nothing overflowed, singular at one", async () => {
    const { container } = render_({
      "checkLogs.list": list({ notRecorded: { queueFull: 0, writeFailed: 1, since: SINCE } }),
    })
    await settled()
    const text = container.textContent ?? ""
    expect(text).toContain("failed to record 1 check since it started")
    expect(text).not.toContain("1 checks")
    expect(text).toContain("1 because writing it to the store failed")
    expect(text).not.toContain("writing them")
    expect(text).not.toContain("dropped before")
  })

  it("shows no loss line when both counts are zero", async () => {
    const { container } = render_({
      "checkLogs.list": list({ notRecorded: { queueFull: 0, writeFailed: 0, since: SINCE } }),
    })
    await settled()
    expect(container.textContent).not.toContain("failed to record")
    expect(container.textContent).not.toContain("no row here")
  })

  it("shows no loss line when notRecorded is absent", async () => {
    const { container } = render_()
    await settled()
    expect(container.textContent).not.toContain("failed to record")
  })

  it("agrees in number at one dropped check and at several", async () => {
    const one = render_({
      "checkLogs.list": list({ notRecorded: { queueFull: 1, writeFailed: 0, since: SINCE } }),
    })
    await settled()
    expect(one.container.textContent).toContain("failed to record 1 check since it started")
    expect(one.container.textContent).toContain("1 dropped before it reached the store")
    expect(one.container.textContent).not.toContain("they reached")
    one.unmount()

    const many = render_({
      "checkLogs.list": list({ notRecorded: { queueFull: 2, writeFailed: 5, since: SINCE } }),
    })
    await settled()
    expect(many.container.textContent).toContain(
      "2 dropped before they reached the store, 5 because writing them to the store failed"
    )
  })
})
