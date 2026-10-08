import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { LedgerUsagePage } from "../src/pages/usage"
import type { EntitlementResult } from "../src/types"
import { renderPage, scriptedClient } from "./harness"
import { aPage } from "./fixtures"

const EVENTS = aPage([
  {
    id: "evt_1",
    tenant_id: "acme",
    app_id: "app_ledger",
    feature_key: "api_calls",
    quantity: 400,
    timestamp: new Date().toISOString(),
  },
  {
    id: "evt_2",
    tenant_id: "acme",
    app_id: "app_ledger",
    feature_key: "api_calls",
    quantity: 50,
    timestamp: new Date().toISOString(),
  },
])

type Sent = { intent: string; params?: Record<string, unknown> }

function open(
  extra: Record<string, unknown> = {},
  commands: Record<string, unknown> = {}
) {
  const queries: Sent[] = []
  const { client, sent } = scriptedClient(
    { "usage.events": EVENTS, ...extra },
    commands
  )
  const inner = client.query
  client.query = ((intent: string, params?: Record<string, unknown>) => {
    queries.push({ intent, params })
    return inner(intent, params)
  }) as typeof client.query
  const view = renderPage(LedgerUsagePage, client)
  return { queries, sent, ...view }
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function result(over: Partial<EntitlementResult>): EntitlementResult {
  return {
    allowed: true,
    feature: "api_calls",
    used: 400,
    limit: 1000,
    remaining: 600,
    soft_limit: false,
    ...over,
  }
}

async function check(answer: EntitlementResult) {
  open({ "entitlements.check": answer })
  await screen.findByText("evt_1")
  type("Tenant ID", "acme")
  type("Feature key", answer.feature)
  fireEvent.click(screen.getByRole("button", { name: "Check entitlement" }))
  await screen.findByText(/^(Allowed|Refused)/)
}

afterEach(() => {
  vi.useRealTimers()
})

describe("LedgerUsagePage", () => {
  it("reads the last 30 days for the chart and the first page for the log", async () => {
    const { queries } = open()
    await screen.findByText("evt_1")
    const events = queries
      .filter((q) => q.intent === "usage.events")
      .map((q) => q.params!)
    expect(events).toContainEqual(
      expect.objectContaining({ limit: 200, offset: 0 })
    )
    expect(events).toContainEqual(
      expect.objectContaining({ limit: 50, offset: 0 })
    )
    const start = Date.parse(String(events[0].start))
    expect(Date.now() - start).toBeGreaterThan(29 * 86_400_000)
    expect(Date.now() - start).toBeLessThan(31 * 86_400_000)
    expect(new Date(start).getUTCHours()).toBe(0)
    expect(new Date(start).getUTCMinutes()).toBe(0)
    expect(screen.getByText("2 events")).toBeTruthy()
  })

  it("narrows every read to the tenant, the feature and the window", async () => {
    const { queries } = open({
      "usage.aggregate": { period: "monthly", totals: { api_calls: 450 } },
    })
    await screen.findByText("evt_1")
    type("Tenant ID", " acme ")
    type("Feature key", "api_calls")
    type("Window", "7")
    await waitFor(() => {
      const last = queries
        .filter((q) => q.intent === "usage.events")
        .at(-1)!.params!
      expect(last).toMatchObject({
        tenant_id: "acme",
        feature_key: "api_calls",
      })
      expect(Date.now() - Date.parse(String(last.start))).toBeLessThan(
        8 * 86_400_000
      )
    })
    // The chart's table also holds 450 (today's two events), so read the card by its label.
    const card = (
      await screen.findByText("api_calls this month, acme")
    ).closest("[data-slot=card]")!
    expect(within(card as HTMLElement).getByText("450")).toBeTruthy()
    expect(queries.find((q) => q.intent === "usage.aggregate")?.params).toEqual(
      { tenant_id: "acme", feature_keys: ["api_calls"], period: "monthly" }
    )
  })

  const SETTINGS = {
    meter_batch_size: 100,
    meter_flush_interval: "5s",
    entitlement_cache_ttl: "1m0s",
    app_id: "app_ledger",
    require_app_claim: false,
    providers: [],
    invoice_formats: [],
  }

  async function openMonthTotal(settings: Record<string, unknown> | undefined) {
    const { queries } = open({
      "usage.aggregate": { period: "monthly", totals: { api_calls: 450 } },
      ...(settings === undefined ? {} : { "settings.detail": settings }),
    })
    await screen.findByText("evt_1")
    type("Tenant ID", "acme")
    type("Feature key", "api_calls")
    await screen.findByText("api_calls this month, acme")
    return queries
  }

  // The neutral hint is also what shows while the settings read is in flight, so
  // a test that expects it must let that read settle before it looks.
  async function settled(queries: Sent[]) {
    await waitFor(() =>
      expect(queries.some((q) => q.intent === "settings.detail")).toBe(true)
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  it("says the month total starts at the UTC month when the ledger runs the lifecycle clock", async () => {
    await openMonthTotal({ ...SETTINGS, lifecycle_interval: "1m0s" })
    expect(
      await screen.findByText("Since the start of the month, UTC")
    ).toBeTruthy()
    cleanup()
    // Off still names a clock-era ledger: every store opens months in UTC.
    await openMonthTotal({ ...SETTINGS, lifecycle_interval: "off" })
    expect(
      await screen.findByText("Since the start of the month, UTC")
    ).toBeTruthy()
  })

  it("names no zone against a ledger older than the clock, which opened months in server time", async () => {
    await settled(await openMonthTotal(SETTINGS))
    expect(screen.getByText("Since the start of the month")).toBeTruthy()
    expect(
      screen.queryByText(/UTC/, { selector: "[data-slot=card] *" })
    ).toBeNull()
  })

  it("names no zone when the settings read is refused", async () => {
    await settled(await openMonthTotal(undefined))
    expect(screen.getByText("Since the start of the month")).toBeTruthy()
  })

  it("does not ask for a month total until a tenant and a feature are named", async () => {
    const { queries } = open()
    await screen.findByText("evt_1")
    type("Tenant ID", "acme")
    expect(queries.some((q) => q.intent === "usage.aggregate")).toBe(false)
  })

  it("links the filter help text to both filters", async () => {
    open()
    await screen.findByText("evt_1")
    for (const label of ["Tenant ID", "Feature key"]) {
      const id = screen.getByLabelText(label).getAttribute("aria-describedby")
      expect(id).toBeTruthy()
      expect(document.getElementById(id!)?.textContent).toMatch(/match exactly/)
    }
  })

  it("shows the log's times in UTC, the zone the chart's columns are cut in", async () => {
    open({
      "usage.events": aPage([
        {
          id: "evt_late",
          tenant_id: "acme",
          app_id: "app_ledger",
          feature_key: "api_calls",
          quantity: 3,
          timestamp: "2026-09-27T23:30:00Z",
        },
      ]),
    })
    await screen.findByText("evt_late")
    expect(
      screen.getByRole("columnheader", { name: "When (UTC)" })
    ).toBeTruthy()
    expect(screen.getByText(/Sep 27, 2026.*11:30:00.PM/)).toBeTruthy()
  })

  it("buckets what it read into UTC days in the chart's table", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.UTC(2026, 8, 29, 0, 30))
    open({
      "usage.events": aPage([
        {
          id: "evt_a",
          tenant_id: "acme",
          app_id: "app_ledger",
          feature_key: "api_calls",
          quantity: 4,
          timestamp: "2026-09-29T00:10:00Z",
        },
        {
          id: "evt_b",
          tenant_id: "acme",
          app_id: "app_ledger",
          feature_key: "api_calls",
          quantity: 3,
          timestamp: "2026-09-28T23:30:00Z",
        },
      ]),
    })
    await screen.findByText("evt_a")
    type("Window", "7")
    // Seven columns and the header row, once the 7-day read has landed.
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("table", { name: "Units per day, 7 days" })
        ).getAllByRole("row")
      ).toHaveLength(8)
    )
    const table = screen.getByRole("table", { name: "Units per day, 7 days" })
    const row = (label: string) => within(table).getByText(label).closest("tr")!
    expect(within(row("Sep 28")).getByText("3")).toBeTruthy()
    expect(within(row("Sep 29")).getByText("4")).toBeTruthy()
    expect(within(row("Sep 27")).getByText("0")).toBeTruthy()
  })

  it("says the chart is cut off when the read had more", async () => {
    open({ "usage.events": aPage(EVENTS.items, { has_more: true }) })
    expect(
      await screen.findByText(
        /The chart covers the 200 most recent events in this window/
      )
    ).toBeTruthy()
  })

  it("shows a refused read as an error, never as an empty log or chart", async () => {
    open({
      "usage.events": new ContractError("PERMISSION_DENIED", "no app selected"),
    })
    const errors = await screen.findAllByText(
      /PERMISSION_DENIED: no app selected/
    )
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText("No usage in this window.")).toBeNull()
    expect(screen.queryByText("0 events")).toBeNull()
    expect(screen.queryByRole("heading", { name: "Units per day" })).toBeNull()
  })

  it("holds the previous chart, dimmed, while a changed filter loads", async () => {
    // The chart and the log are two reads; the slow filter holds both open.
    const releases: ((page: unknown) => void)[] = []
    const client = {
      extension: "ledger",
      query: (intent: string, params?: Record<string, unknown>) => {
        if (intent === "usage.events" && params?.feature_key === "slow")
          return new Promise((resolve) => releases.push(resolve))
        return Promise.resolve(EVENTS)
      },
      command: async () => ({ ok: true }),
    } as unknown as ScopedClient
    const { container } = render(
      <PluginProvider client={client}>
        <LedgerUsagePage />
      </PluginProvider>
    )
    await screen.findByText("evt_1")
    expect(container.querySelector("[data-refreshing='false']")).not.toBeNull()
    const details = container.querySelector("details")!
    details.open = true
    type("Feature key", "slow")
    await waitFor(() =>
      expect(
        container.querySelector("[data-refreshing='true']")?.className
      ).toMatch(/opacity-60/)
    )
    expect(screen.getByRole("heading", { name: "Units per day" })).toBeTruthy()
    await act(async () => releases.forEach((release) => release(aPage([]))))
    await waitFor(() =>
      expect(
        container.querySelector("[data-refreshing='false']")
      ).not.toBeNull()
    )
    // The same chart throughout, not a remount: the table the operator opened is still open.
    expect(container.querySelector("details")).toBe(details)
    expect(details.open).toBe(true)
  })
})

/** A client whose usage.events answer is computed from the params, so paging can be followed. */
function pagedClient(answer: (params: Record<string, unknown>) => unknown) {
  const queries: Sent[] = []
  const client = {
    extension: "ledger",
    query: async (intent: string, params?: Record<string, unknown>) => {
      queries.push({ intent, params })
      if (intent === "usage.events") return answer(params ?? {})
      throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
    },
    command: async () => ({ ok: true }),
  } as unknown as ScopedClient
  render(
    <PluginProvider client={client}>
      <LedgerUsagePage />
    </PluginProvider>
  )
  const logReads = () =>
    queries
      .filter((q) => q.intent === "usage.events" && q.params?.limit === 50)
      .map((q) => q.params!)
  return { queries, logReads }
}

const event = (id: string) => ({
  id,
  tenant_id: "acme",
  app_id: "app_ledger",
  feature_key: "api_calls",
  quantity: 1,
  timestamp: new Date().toISOString(),
})

describe("the event log's paging", () => {
  it("asks for the next fifty when Next is pressed", async () => {
    const { logReads } = pagedClient((p) =>
      p.limit === 50
        ? aPage([event(`evt_${p.offset}`)], { has_more: p.offset === 0 })
        : aPage([event("evt_chart")])
    )
    await screen.findByText("evt_0")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("evt_50")
    expect(logReads().at(-1)).toMatchObject({ limit: 50, offset: 50 })
    expect(screen.getByText("Page 2")).toBeTruthy()
  })

  it.each([
    ["Tenant ID", "acme"],
    ["Window", "7"],
  ])("returns to the first page when %s changes", async (label, value) => {
    const { logReads } = pagedClient((p) =>
      p.limit === 50
        ? aPage([event(`evt_${p.offset}`)], { has_more: true })
        : aPage([event("evt_chart")])
    )
    await screen.findByText("evt_0")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("evt_50")
    type(label, value)
    await screen.findByText("evt_0")
    expect(logReads().at(-1)).toMatchObject({ limit: 50, offset: 0 })
    expect(screen.getByText("Page 1")).toBeTruthy()
  })

  it("says so when a page past the end is empty, rather than that no usage exists", async () => {
    pagedClient((p) =>
      p.limit === 50
        ? aPage(p.offset === 0 ? [event("evt_0")] : [], {
            has_more: p.offset === 0,
          })
        : aPage([event("evt_chart")])
    )
    await screen.findByText("evt_0")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(await screen.findByText("Nothing on page 2.")).toBeTruthy()
    expect(screen.queryByText("No usage in this window.")).toBeNull()
    expect(
      (
        screen.getByRole("button", {
          name: "Previous page",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
    expect(
      (screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })

  it("tells an empty window from an empty filter", async () => {
    pagedClient(() => aPage([]))
    expect(await screen.findByText("No usage in this window.")).toBeTruthy()
    type("Tenant ID", "nobody")
    expect(
      await screen.findByText("No events match these filters in this window.")
    ).toBeTruthy()
    expect(screen.queryByText("No usage in this window.")).toBeNull()
  })

  it("shows an event with no usable time as none, not as the text it arrived as", async () => {
    open({
      "usage.events": aPage([
        { ...event("evt_blank"), timestamp: "" },
        { ...event("evt_junk"), timestamp: "soon" },
      ]),
    })
    await screen.findByText("evt_blank")
    expect(screen.getAllByLabelText("no time")).toHaveLength(2)
    expect(screen.queryByText("soon")).toBeNull()
  })
})

describe("entitlement tools", () => {
  it("checks an entitlement fresh and says what it found", async () => {
    const { queries } = open({
      "entitlements.check": {
        allowed: false,
        feature: "api_calls",
        used: 1200,
        limit: 1000,
        remaining: 0,
        soft_limit: false,
        reason: "quota exceeded",
      },
    })
    await screen.findByText("evt_1")
    type("Tenant ID", "acme")
    type("Feature key", "api_calls")
    fireEvent.click(screen.getByRole("button", { name: "Check entitlement" }))
    expect(await screen.findByText("Refused: quota exceeded")).toBeTruthy()
    expect(screen.getByText("1,200 of 1,000 used")).toBeTruthy()
    expect(
      queries.find((q) => q.intent === "entitlements.check")?.params
    ).toEqual({ tenant_id: "acme", feature_key: "api_calls" })
  })

  it("asks again on a second click rather than repeating the answer it has", async () => {
    const { queries } = open({ "entitlements.check": result({}) })
    await screen.findByText("evt_1")
    type("Tenant ID", "acme")
    type("Feature key", "api_calls")
    const button = screen.getByRole("button", { name: "Check entitlement" })
    fireEvent.click(button)
    await screen.findByText("Allowed")
    fireEvent.click(button)
    await waitFor(() =>
      expect(
        queries.filter((q) => q.intent === "entitlements.check")
      ).toHaveLength(2)
    )
    await screen.findByText("Allowed")
  })

  it("drops the answer on screen when the tenant or feature is edited", async () => {
    await check(result({}))
    type("Tenant ID", "globex")
    expect(screen.queryByText("Allowed")).toBeNull()
  })

  it("keeps the check off until a tenant and a feature are named, and links the reason to the buttons", async () => {
    open()
    await screen.findByText("evt_1")
    const button = screen.getByRole("button", {
      name: "Check entitlement",
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    const described = button
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
    expect(described).toMatch(/Name a tenant/)
    expect(described).toMatch(/skipping the cache/)
    type("Tenant ID", "acme")
    expect(button.disabled).toBe(true)
    type("Feature key", "api_calls")
    expect(button.disabled).toBe(false)
  })

  it("reads an allowed metered answer with what is left", async () => {
    await check(result({}))
    expect(screen.getByText("Allowed")).toBeTruthy()
    expect(screen.getByText("400 of 1,000 used")).toBeTruthy()
    expect(screen.getByText("600 remaining")).toBeTruthy()
  })

  it("reads an over-soft-limit answer as allowed, not refused", async () => {
    await check(
      result({
        used: 1200,
        remaining: 0,
        soft_limit: true,
        reason: "over soft limit",
      })
    )
    expect(screen.getByText("Allowed")).toBeTruthy()
    expect(screen.queryByText(/Refused/)).toBeNull()
    expect(
      screen.getByText(/At or past the soft limit. Use is not blocked/)
    ).toBeTruthy()
    expect(screen.getByText("1,200 of 1,000 used")).toBeTruthy()
  })

  it("reads an unlimited feature without a limit to divide by", async () => {
    await check(result({ used: 40, limit: -1, remaining: -1 }))
    expect(screen.getByText("Allowed")).toBeTruthy()
    expect(screen.getByText("40 used, no limit")).toBeTruthy()
    expect(screen.queryByText(/remaining/)).toBeNull()
  })

  it("reads an included boolean feature as included, with no usage to count", async () => {
    await check(result({ feature: "sso", used: 0, limit: 1, remaining: 0 }))
    expect(screen.getByText("Allowed")).toBeTruthy()
    expect(
      screen.getByText("Included in the plan. There is nothing to count.")
    ).toBeTruthy()
    expect(screen.queryByText(/of 1 used/)).toBeNull()
  })

  it("names a switched-off boolean feature even though the engine sends no reason", async () => {
    await check(
      result({
        allowed: false,
        feature: "sso",
        used: 0,
        limit: 0,
        remaining: 0,
      })
    )
    expect(
      screen.getByText(
        "Refused: this feature is switched off in the tenant's plan"
      )
    ).toBeTruthy()
    expect(screen.queryByText(/no reason given/)).toBeNull()
    expect(screen.queryByText(/of 0 used/)).toBeNull()
  })

  it.each(["no active subscription", "plan not found", "feature not in plan"])(
    "says %s and does not invent a usage line",
    async (reason) => {
      await check(
        result({ allowed: false, used: 0, limit: 0, remaining: 0, reason })
      )
      expect(screen.getByText(`Refused: ${reason}`)).toBeTruthy()
      expect(screen.queryByText(/of 0 used/)).toBeNull()
    }
  )

  it("shows a refused check as an error, not as an answer", async () => {
    open({
      "entitlements.check": new ContractError(
        "PERMISSION_DENIED",
        "no app selected"
      ),
    })
    await screen.findByText("evt_1").catch(() => undefined)
    type("Tenant ID", "acme")
    type("Feature key", "api_calls")
    fireEvent.click(screen.getByRole("button", { name: "Check entitlement" }))
    expect(
      (await screen.findAllByText(/PERMISSION_DENIED: no app selected/)).length
    ).toBeGreaterThanOrEqual(1)
  })

  it("keeps both live regions mounted from the first render, empty until there is something to say", async () => {
    open(
      { "entitlements.check": result({}) },
      { "entitlements.invalidate": { ok: true } }
    )
    await screen.findByText("evt_1")
    const answer = screen.getByRole("status", { name: "Entitlement answer" })
    const live = screen
      .getAllByRole("status")
      .filter(
        (el) => el.getAttribute("aria-live") === "polite" && el !== answer
      )
    expect(live).toHaveLength(1)
    expect(answer.textContent).toBe("")
    expect(live[0].textContent).toBe("")
    type("Tenant ID", "acme")
    type("Feature key", "api_calls")
    fireEvent.click(screen.getByRole("button", { name: "Check entitlement" }))
    await screen.findByText("Allowed")
    fireEvent.click(
      screen.getByRole("button", { name: "Clear cached answers" })
    )
    await screen.findByText("Cached answers for acme (api_calls) were cleared.")
    // The same nodes, filled in place, not new ones inserted.
    expect(screen.getByRole("status", { name: "Entitlement answer" })).toBe(
      answer
    )
    expect(live[0].isConnected).toBe(true)
    expect(live[0].textContent).toMatch(/were cleared/)
  })

  it("clears cached answers for the tenant", async () => {
    const { sent } = open({}, { "entitlements.invalidate": { ok: true } })
    await screen.findByText("evt_1")
    type("Tenant ID", "acme")
    fireEvent.click(
      screen.getByRole("button", { name: "Clear cached answers" })
    )
    expect(
      await screen.findByText("Cached answers for acme were cleared.")
    ).toBeTruthy()
    expect(sent).toEqual([
      { intent: "entitlements.invalidate", payload: { tenant_id: "acme" } },
    ])
  })

  it("clears one feature only when a feature key is named, and says so", async () => {
    const { sent } = open({}, { "entitlements.invalidate": { ok: true } })
    await screen.findByText("evt_1")
    type("Tenant ID", "acme")
    type("Feature key", "api_calls")
    fireEvent.click(
      screen.getByRole("button", { name: "Clear cached answers" })
    )
    expect(
      await screen.findByText(
        "Cached answers for acme (api_calls) were cleared."
      )
    ).toBeTruthy()
    expect(sent).toEqual([
      {
        intent: "entitlements.invalidate",
        payload: { tenant_id: "acme", feature_key: "api_calls" },
      },
    ])
  })

  it("shows a refused clear as an alert and does not claim it worked", async () => {
    open(
      {},
      {
        "entitlements.invalidate": new ContractError(
          "PERMISSION_DENIED",
          "no app selected"
        ),
      }
    )
    await screen.findByText("evt_1")
    type("Tenant ID", "acme")
    fireEvent.click(
      screen.getByRole("button", { name: "Clear cached answers" })
    )
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/Could not clear the cache/)
    expect(alert.textContent).toMatch(/no app selected/)
    expect(screen.queryByText(/were cleared/)).toBeNull()
  })

  it("keeps the clear off until a tenant is named", async () => {
    open()
    await screen.findByText("evt_1")
    expect(
      (
        screen.getByRole("button", {
          name: "Clear cached answers",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })
})
