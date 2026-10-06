import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { UsagePage } from "../src/pages/usage"
import {
  bucketTick,
  bucketTitle,
  formatLatency,
  keyPath,
  rangeBounds,
  USAGE_RANGES,
} from "../src/format"
import type {
  KeySummary,
  KeysList,
  UsageBucket,
  UsageRecordItem,
  UsageRecords,
  UsageSeries,
} from "../src/types"
import { failingClient, renderPage } from "./harness"

/*
 * vitest.config pins TZ=America/Chicago, so every UTC expectation below
 * would come out a different hour or day if the code read local time.
 */

const at = (iso: string) => new Date(iso).getTime()

describe("USAGE_RANGES", () => {
  it("offers 24 hours hourly, 7 and 30 days daily, and 12 months monthly", () => {
    expect(USAGE_RANGES).toEqual([
      { id: "24h", label: "24 hours", period: "hourly", hours: 24 },
      { id: "7d", label: "7 days", period: "daily", days: 7 },
      { id: "30d", label: "30 days", period: "daily", days: 30 },
      { id: "12m", label: "12 months", period: "monthly", months: 12 },
    ])
  })
})

describe("rangeBounds", () => {
  it("24 hours ends at the start of the next hour, so the current hour is in", () => {
    expect(rangeBounds("24h", at("2026-10-05T14:20:00Z"))).toEqual({
      after: "2026-10-04T15:00:00Z",
      before: "2026-10-05T15:00:00Z",
      period: "hourly",
    })
  })

  it("24 hours at exactly the top of an hour still includes that hour", () => {
    expect(rangeBounds("24h", at("2026-10-05T14:00:00Z"))).toEqual({
      after: "2026-10-04T15:00:00Z",
      before: "2026-10-05T15:00:00Z",
      period: "hourly",
    })
  })

  it("24 hours across a year end", () => {
    expect(rangeBounds("24h", at("2026-12-31T23:59:59.999Z"))).toEqual({
      after: "2026-12-31T00:00:00Z",
      before: "2027-01-01T00:00:00Z",
      period: "hourly",
    })
  })

  it("7 days ends at the next UTC midnight and starts seven UTC days before", () => {
    expect(rangeBounds("7d", at("2026-10-05T14:20:00Z"))).toEqual({
      after: "2026-09-29T00:00:00Z",
      before: "2026-10-06T00:00:00Z",
      period: "daily",
    })
  })

  it("7 days uses the UTC day, not the local one", () => {
    // 03:00Z on the 6th is still the 5th in Chicago.
    expect(rangeBounds("7d", at("2026-10-06T03:00:00Z"))).toEqual({
      after: "2026-09-30T00:00:00Z",
      before: "2026-10-07T00:00:00Z",
      period: "daily",
    })
  })

  it("7 days across a short month's end", () => {
    expect(rangeBounds("7d", at("2026-03-01T00:30:00Z"))).toEqual({
      after: "2026-02-23T00:00:00Z",
      before: "2026-03-02T00:00:00Z",
      period: "daily",
    })
  })

  it("30 days across a month end", () => {
    expect(rangeBounds("30d", at("2026-10-05T14:20:00Z"))).toEqual({
      after: "2026-09-06T00:00:00Z",
      before: "2026-10-06T00:00:00Z",
      period: "daily",
    })
  })

  it("12 months ends at the first of next month and starts twelve months before", () => {
    expect(rangeBounds("12m", at("2026-10-05T14:20:00Z"))).toEqual({
      after: "2025-11-01T00:00:00Z",
      before: "2026-11-01T00:00:00Z",
      period: "monthly",
    })
  })

  it("12 months in December ends at the next year's first day", () => {
    expect(rangeBounds("12m", at("2026-12-31T23:30:00Z"))).toEqual({
      after: "2026-01-01T00:00:00Z",
      before: "2027-01-01T00:00:00Z",
      period: "monthly",
    })
  })

  it("12 months in January starts in the year before", () => {
    expect(rangeBounds("12m", at("2026-01-15T00:00:00Z"))).toEqual({
      after: "2025-02-01T00:00:00Z",
      before: "2026-02-01T00:00:00Z",
      period: "monthly",
    })
  })

  it("12 months uses the UTC month at a local month's end", () => {
    // 2026-11-01T02:00Z is still October in Chicago.
    expect(rangeBounds("12m", at("2026-11-01T02:00:00Z"))).toEqual({
      after: "2025-12-01T00:00:00Z",
      before: "2026-12-01T00:00:00Z",
      period: "monthly",
    })
  })
})

describe("bucket labels", () => {
  it("labels axis ticks per period, in UTC", () => {
    expect(bucketTick("2026-10-03T14:00:00Z", "hourly")).toBe("14:00")
    expect(bucketTick("2026-10-03T03:00:00Z", "hourly")).toBe("03:00")
    // Midnight UTC on the 3rd is the evening of the 2nd in Chicago.
    expect(bucketTick("2026-10-03T00:00:00Z", "daily")).toBe("3 Oct")
    expect(bucketTick("2026-10-01T00:00:00Z", "monthly")).toBe("Oct 2026")
  })

  it("titles a bucket in full, saying UTC where there is an hour", () => {
    expect(bucketTitle("2026-10-03T14:00:00Z", "hourly")).toBe(
      "3 Oct 2026, 14:00 UTC",
    )
    expect(bucketTitle("2026-10-03T00:00:00Z", "daily")).toBe("3 Oct 2026")
    expect(bucketTitle("2026-01-01T00:00:00Z", "monthly")).toBe("Jan 2026")
  })

  it("formats latency in whole milliseconds", () => {
    expect(formatLatency(12)).toBe("12 ms")
    expect(formatLatency(0)).toBe("0 ms")
    expect(formatLatency(1500)).toBe("1,500 ms")
  })
})

// ---------------------------------------------------------------------------
// The page

function bucket(start: string, over: Partial<UsageBucket> = {}): UsageBucket {
  return {
    start,
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    succeeded: 0,
    avgLatencyMs: null,
    ...over,
  }
}

const BUCKETS: UsageBucket[] = [
  bucket("2026-10-05T12:00:00Z", {
    requests: 10,
    succeeded: 7,
    clientErrors: 2,
    serverErrors: 1,
    avgLatencyMs: 12,
  }),
  bucket("2026-10-05T13:00:00Z"),
  bucket("2026-10-05T14:00:00Z", {
    requests: 1200,
    succeeded: 1197,
    serverErrors: 3,
    avgLatencyMs: 40,
  }),
]

const SERIES: UsageSeries = { period: "hourly", buckets: BUCKETS, recorded: true }

function key(over: Partial<KeySummary>): KeySummary {
  return {
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
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  }
}

const KEYS: KeysList = {
  keys: [
    key({}),
    key({ id: "akey_partner", name: "Partner sandbox", hint: "42ad" }),
  ],
  total: 2,
}

function record(over: Partial<UsageRecordItem>): UsageRecordItem {
  return {
    id: "kusg_1",
    keyId: "akey_billing",
    method: "GET",
    endpoint: "/v1/invoices",
    statusCode: 200,
    latencyMs: 12,
    ipAddress: "203.0.113.7",
    at: "2026-10-05T14:10:00Z",
    ...over,
  }
}

const RECORDS: UsageRecords = {
  items: [
    record({}),
    record({
      id: "kusg_2",
      keyId: "akey_partner",
      method: "POST",
      endpoint: "/v1/charges",
      statusCode: 503,
      latencyMs: 1500,
      ipAddress: undefined,
      at: "2026-10-05T14:05:00Z",
    }),
  ],
  total: 2,
}

type Answers = {
  series?: (params: Record<string, unknown>) => UsageSeries
  records?: (params: Record<string, unknown>) => UsageRecords
  keys?: KeysList
}

/** Answers the three reads the page makes, and records every one with its params. */
function usageClient(answers: Answers = {}): {
  client: ScopedClient
  sent: { intent: string; params: Record<string, unknown> }[]
} {
  const sent: { intent: string; params: Record<string, unknown> }[] = []
  const series = answers.series ?? (() => SERIES)
  const records = answers.records ?? (() => RECORDS)
  const keys = answers.keys ?? KEYS
  return {
    sent,
    client: {
      extension: "keysmith",
      query: async (intent: string, params?: Record<string, unknown>) => {
        sent.push({ intent, params: params ?? {} })
        if (intent === "usage.series") return series(params ?? {})
        if (intent === "usage.records") return records(params ?? {})
        if (intent === "keys.list") return keys
        throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
      },
      command: async () => {
        throw new ContractError("NOT_FOUND", "no commands")
      },
    } as ScopedClient,
  }
}

function paramsOf(
  sent: { intent: string; params: Record<string, unknown> }[],
  intent: string,
): Record<string, unknown>[] {
  return sent.filter((s) => s.intent === intent).map((s) => s.params)
}

function cellOf(row: HTMLElement, table: HTMLElement, column: string): HTMLElement {
  const headers = within(table)
    .getAllByRole("columnheader")
    .map((h) => h.textContent)
  const index = headers.indexOf(column)
  if (index < 0) throw new Error(`no column ${column}`)
  return within(row).getAllByRole("cell")[index]!
}

function recordsTable(): HTMLElement {
  return screen.getByRole("table", { name: /requests?$/ })
}

function rowWith(table: HTMLElement, text: string): HTMLElement {
  const row = within(table)
    .getAllByRole("row")
    .find((r) => within(r).queryByText(text))
  if (!row) throw new Error(`no row with ${text}`)
  return row
}

describe("UsagePage", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function freezeAt(iso: string) {
    // Only Date: the page's reads still settle on real timers.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(iso))
  }

  it("asks for the last 24 hours, hourly, for every key", async () => {
    freezeAt("2026-10-05T14:20:00Z")
    const { client, sent } = usageClient()
    renderPage(UsagePage, client)
    await screen.findByRole("group", { name: /Requests per hour/ })
    expect(paramsOf(sent, "usage.series")[0]).toEqual({
      period: "hourly",
      after: "2026-10-04T15:00:00Z",
      before: "2026-10-05T15:00:00Z",
    })
  })

  it("asks for each range's period and bounds when the range changes", async () => {
    freezeAt("2026-10-05T14:20:00Z")
    const { client, sent } = usageClient()
    renderPage(UsagePage, client)
    await screen.findByRole("group", { name: /Requests per hour/ })

    const range = screen.getByLabelText("Range")
    expect(
      within(range).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["24 hours", "7 days", "30 days", "12 months"])

    for (const id of ["7d", "30d", "12m"] as const) {
      fireEvent.change(screen.getByLabelText("Range"), { target: { value: id } })
      await screen.findByRole("group", { name: /Requests per hour/ })
      expect(paramsOf(sent, "usage.series").at(-1)).toEqual(
        rangeBounds(id, at("2026-10-05T14:20:00Z")),
      )
    }
  })

  it("offers every key by name and narrows the chart and the records to the chosen one", async () => {
    freezeAt("2026-10-05T14:20:00Z")
    const { client, sent } = usageClient()
    renderPage(UsagePage, client)
    await screen.findByText("Partner sandbox", { selector: "option" })

    expect(paramsOf(sent, "keys.list")[0]).toEqual({ limit: 100 })
    const select = screen.getByLabelText("Key")
    expect(
      within(select).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["All keys", "Billing service", "Partner sandbox"])

    fireEvent.change(select, { target: { value: "akey_partner" } })
    await screen.findByRole("group", { name: /Requests per hour/ })
    expect(paramsOf(sent, "usage.series").at(-1)).toEqual({
      period: "hourly",
      after: "2026-10-04T15:00:00Z",
      before: "2026-10-05T15:00:00Z",
      keyId: "akey_partner",
    })
    await waitFor(() =>
      expect(paramsOf(sent, "usage.records").at(-1)).toMatchObject({
        keyId: "akey_partner",
        offset: 0,
      }),
    )

    // Back to every key: no keyId at all, not an empty string.
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "" } })
    await screen.findByRole("group", { name: /Requests per hour/ })
    expect(paramsOf(sent, "usage.series").at(-1)).not.toHaveProperty("keyId")
  })

  it("keeps key ids out of the address bar", async () => {
    const before = window.location.href
    const { client } = usageClient()
    renderPage(UsagePage, client)
    await screen.findByText("Partner sandbox", { selector: "option" })
    fireEvent.change(screen.getByLabelText("Key"), {
      target: { value: "akey_partner" },
    })
    await screen.findByRole("group", { name: /Requests per hour/ })
    expect(window.location.href).toBe(before)
  })

  it("says usage appears once the application calls RecordUsage, and draws no chart", async () => {
    const { client } = usageClient({
      series: () => ({
        period: "hourly",
        buckets: BUCKETS.map((b) => bucket(b.start)),
        recorded: false,
      }),
    })
    const { container } = renderPage(UsagePage, client)
    expect(await screen.findByText("No usage recorded yet.")).toBeTruthy()
    expect(
      screen.getByText("Usage appears once your application calls RecordUsage."),
    ).toBeTruthy()
    expect(container.querySelector("[data-chart]")).toBeNull()
    expect(screen.queryByRole("button", { name: "Table" })).toBeNull()
    expect(screen.queryByText("No requests in this range.")).toBeNull()
  })

  it("draws a chart of zeros and says so when this range has no requests", async () => {
    const zeros = BUCKETS.map((b) => bucket(b.start))
    const { client } = usageClient({
      series: () => ({ period: "hourly", buckets: zeros, recorded: true }),
      records: () => ({ items: [], total: 0 }),
    })
    const { container } = renderPage(UsagePage, client)
    expect(await screen.findByText("No requests in this range.")).toBeTruthy()
    expect(container.querySelector("[data-chart]")).not.toBeNull()
    expect(screen.queryByText("No usage recorded yet.")).toBeNull()
  })

  it("does not say the range is empty when it has requests", async () => {
    const { client } = usageClient()
    renderPage(UsagePage, client)
    await screen.findByRole("group", { name: /Requests per hour/ })
    expect(screen.queryByText("No requests in this range.")).toBeNull()
  })

  it("shows the same buckets as a table behind the Table toggle", async () => {
    const { client } = usageClient()
    const { container } = renderPage(UsagePage, client)
    const toggle = await screen.findByRole("button", { name: "Table" })
    expect(toggle.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(toggle)
    expect(screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe("true")
    expect(container.querySelector("[data-chart]")).toBeNull()

    const table = screen.getByRole("table", { name: "3 hourly buckets, UTC" })
    expect(
      within(table).getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["Bucket start", "Succeeded", "4xx", "5xx", "Requests", "Avg latency"])

    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(BUCKETS.length)
    expect(
      rows.map((r) =>
        within(r).getAllByRole("cell").map((c) => c.textContent),
      ),
    ).toEqual([
      ["5 Oct 2026, 12:00 UTC", "7", "2", "1", "10", "12 ms"],
      ["5 Oct 2026, 13:00 UTC", "0", "0", "0", "0", "–"],
      ["5 Oct 2026, 14:00 UTC", "1,197", "0", "3", "1,200", "40 ms"],
    ])
    expect(within(rows[1]!).getByLabelText("no requests")).toBeTruthy()

    // And back to the chart.
    fireEvent.click(screen.getByRole("button", { name: "Table" }))
    expect(container.querySelector("[data-chart]")).not.toBeNull()
  })

  it("lists the records with their columns, identifiers in mono", async () => {
    const { client } = usageClient()
    renderPage(UsagePage, client)
    await screen.findByText("/v1/charges")
    const table = recordsTable()
    expect(
      within(table).getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["Time", "Key", "Method", "Endpoint", "Status", "Latency", "IP"])
    expect(within(table).getByText("2 requests")).toBeTruthy()

    const row = rowWith(table, "/v1/invoices")
    expect(cellOf(row, table, "Time").textContent).toBe(
      formatTimestamp("2026-10-05T14:10:00Z"),
    )
    const link = within(cellOf(row, table, "Key")).getByRole("link", {
      name: "akey_billing",
    })
    expect(link.getAttribute("href")).toBe(keyPath("akey_billing"))
    expect(link.className).toMatch(/font-mono/)
    expect(link.className).toMatch(/text-xs/)
    expect(cellOf(row, table, "Method").textContent).toBe("GET")
    const endpoint = within(cellOf(row, table, "Endpoint")).getByText("/v1/invoices")
    expect(endpoint.className).toMatch(/font-mono/)
    expect(endpoint.className).toMatch(/text-xs/)
    expect(cellOf(row, table, "Status").textContent).toBe("200")
    expect(cellOf(row, table, "Latency").textContent).toBe("12 ms")
    const ip = within(cellOf(row, table, "IP")).getByText("203.0.113.7")
    expect(ip.className).toMatch(/font-mono/)
    expect(ip.className).toMatch(/text-xs/)

    const other = rowWith(table, "/v1/charges")
    expect(cellOf(other, table, "Status").textContent).toBe("503")
    expect(cellOf(other, table, "Latency").textContent).toBe("1,500 ms")
    expect(
      within(cellOf(other, table, "IP")).getByLabelText("no IP address recorded"),
    ).toBeTruthy()
  })

  it("asks for the range's records, 25 at a time, newest first", async () => {
    freezeAt("2026-10-05T14:20:00Z")
    const { client, sent } = usageClient()
    renderPage(UsagePage, client)
    await screen.findByText("/v1/charges")
    expect(paramsOf(sent, "usage.records")[0]).toEqual({
      limit: 25,
      offset: 0,
      after: "2026-10-04T15:00:00Z",
      before: "2026-10-05T15:00:00Z",
    })
  })

  it("pages the records by their total", async () => {
    const { client, sent } = usageClient({
      records: (params) =>
        params.offset === 25
          ? { items: [record({ id: "kusg_26", endpoint: "/v1/page-two" })], total: 26 }
          : { items: [record({})], total: 26 },
    })
    renderPage(UsagePage, client)
    await screen.findByText("/v1/invoices")
    expect(screen.getByText(/Page 1 of 2, 26 total/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /Next/ }))
    expect(await screen.findByText("/v1/page-two")).toBeTruthy()
    expect(paramsOf(sent, "usage.records").at(-1)).toMatchObject({
      limit: 25,
      offset: 25,
    })
  })

  it("goes back to the first page of records when the range changes", async () => {
    const { client, sent } = usageClient({
      records: () => ({ items: [record({})], total: 26 }),
    })
    renderPage(UsagePage, client)
    await screen.findByText("/v1/invoices")
    fireEvent.click(screen.getByRole("button", { name: /Next/ }))
    await screen.findByText(/Page 2 of 2/)

    fireEvent.change(screen.getByLabelText("Range"), { target: { value: "7d" } })
    await screen.findByText(/Page 1 of 2/)
    expect(paramsOf(sent, "usage.records").at(-1)).toMatchObject({ offset: 0 })
  })

  it("says so when the range has no records", async () => {
    const { client } = usageClient({
      records: () => ({ items: [], total: 0 }),
    })
    renderPage(UsagePage, client)
    expect(
      await screen.findByText("No requests recorded in this range."),
    ).toBeTruthy()
  })

  it("shows the contract's error when the reads fail", async () => {
    renderPage(
      UsagePage,
      failingClient(new ContractError("INTERNAL", "an internal error occurred")),
    )
    expect(await screen.findByText("Usage unavailable")).toBeTruthy()
    expect(screen.getByText("Usage records unavailable")).toBeTruthy()
    expect(
      screen.getAllByText("INTERNAL: an internal error occurred").length,
    ).toBeGreaterThanOrEqual(2)
    // The key filter still offers every key, with no names to add.
    expect(
      within(screen.getByLabelText("Key")).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["All keys"])
  })

  it("names the page", async () => {
    const { client } = usageClient()
    renderPage(UsagePage, client)
    expect(await screen.findByRole("heading", { name: "Usage" })).toBeTruthy()
  })
})
