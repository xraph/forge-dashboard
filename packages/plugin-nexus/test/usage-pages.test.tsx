import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import UsagePage from "../src/pages/usage"
import { RecordsPage } from "../src/pages/records"
import type { UsageSummary, UsageRecords } from "../src/types"
import { answer, fixtureClient } from "./fixtures"
import { renderWithClient } from "./harness"

afterEach(() => window.history.replaceState(null, "", "/"))

it("keeps the previous usage scope visible until both new reads resolve", async () => {
  let resolveDay!: (v: UsageSummary) => void
  const day = new Promise<UsageSummary>((resolve) => {
    resolveDay = resolve
  })
  const { client, sent } = fixtureClient({
    "usage.summary": (p: Record<string, unknown>) =>
      p.period === "day" ? day : answer("usage.summary", p),
  })
  renderWithClient(<UsagePage />, client)
  await screen.findByText("Spend by provider")
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
    target: { value: "day" },
  })
  expect(await screen.findByText(/Showing the previous selection/)).toBeTruthy()
  expect(document.querySelector('[aria-busy="true"]')?.className).toContain(
    "opacity-60"
  )
  expect(screen.getByText("Spend by provider")).toBeTruthy()
  fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
    target: { value: "week" },
  })
  await waitFor(() =>
    expect(screen.queryByText(/Showing the previous selection/)).toBeNull()
  )
  await act(async () => {
    resolveDay({
      ...answer<UsageSummary>("usage.summary", { period: "day" }),
      totalCostUsd: "999999999",
    })
    await day
  })
  expect(screen.queryByText("$999999999")).toBeNull()
  expect(
    sent.some(
      (x) =>
        x.intent === "usage.series" &&
        x.params?.period === "day" &&
        x.params.bucket === "hour"
    )
  ).toBe(true)
})

it("shows zero requests separately from collection off", async () => {
  const summary = {
    ...answer<UsageSummary>("usage.summary", { period: "month" }),
    totalRequests: 0,
    totalCostUsd: "0",
    byProvider: [],
    byModel: [],
  }
  renderWithClient(
    <UsagePage />,
    fixtureClient({
      "usage.summary": summary,
      "usage.series": { usageEnabled: true, items: [] },
    }).client
  )
  expect(await screen.findByText("No requests in this period")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Refresh usage" })).toBeTruthy()
})

it("loads more log rows without duplicates and resets them when filters change", async () => {
  const { client, sent } = fixtureClient()
  renderWithClient(<RecordsPage />, client)
  fireEvent.click(
    await screen.findByRole("button", { name: "Load more requests" })
  )
  await screen.findByText("50 requests shown")
  fireEvent.change(screen.getByRole("combobox", { name: "Outcome" }), {
    target: { value: "refused" },
  })
  await waitFor(() =>
    expect(screen.queryByText("50 requests shown")).toBeNull()
  )
  expect((await screen.findAllByText("rate_limit")).length).toBe(15)
  const last = sent.filter((x) => x.intent === "usage.records").at(-1)
  expect(last?.params?.cursor).toBeUndefined()
  expect(last?.params?.outcome).toBe("refused")
})

it("opens a key-scoped deep link and applies provider, model and time bounds", async () => {
  const record = answer<UsageRecords>("usage.records").items[0]
  window.history.replaceState(
    null,
    "",
    `/?tenantId=${record.tenantId}&keyId=${record.keyId}`
  )
  const { client, sent } = fixtureClient()
  renderWithClient(<RecordsPage />, client)
  await screen.findByRole("button", { name: "Apply filters" })
  fireEvent.change(screen.getByRole("textbox", { name: "Provider" }), {
    target: { value: "cloud" },
  })
  fireEvent.change(screen.getByRole("textbox", { name: "Model" }), {
    target: { value: "swift-chat" },
  })
  fireEvent.change(screen.getByLabelText("From (local time)"), {
    target: { value: "2026-10-01T00:00" },
  })
  fireEvent.change(screen.getByLabelText("To (local time)"), {
    target: { value: "2026-11-01T00:00" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }))
  await waitFor(() =>
    expect(
      sent.filter((x) => x.intent === "usage.records").at(-1)?.params?.provider
    ).toBe("cloud")
  )
  expect(
    sent.filter((x) => x.intent === "usage.records").at(-1)?.params
  ).toMatchObject({
    tenantId: record.tenantId,
    keyId: record.keyId,
    model: "swift-chat",
    from: new Date("2026-10-01T00:00").toISOString(),
    to: new Date("2026-11-01T00:00").toISOString(),
  })
})

it("an explicit blank scope never opens an operator-wide request log", async () => {
  window.history.replaceState(null, "", "/?tenantId=")
  const { client, sent } = fixtureClient()
  renderWithClient(<RecordsPage />, client)
  expect(screen.getByText("Invalid request-log scope")).toBeTruthy()
  expect(sent.filter((x) => x.intent === "usage.records")).toEqual([])
})

it("a late next page cannot append rows after the outcome changes", async () => {
  let resolvePage!: (v: UsageRecords) => void
  const delayed = new Promise<UsageRecords>((resolve) => {
    resolvePage = resolve
  })
  const { client } = fixtureClient({
    "usage.records": (p: Record<string, unknown>) =>
      p.cursor ? delayed : answer("usage.records", p),
  })
  renderWithClient(<RecordsPage />, client)
  fireEvent.click(
    await screen.findByRole("button", { name: "Load more requests" })
  )
  expect(screen.getByText("25 requests shown")).toBeTruthy()
  fireEvent.change(screen.getByRole("combobox", { name: "Outcome" }), {
    target: { value: "refused" },
  })
  await screen.findByText("15 requests shown")
  await act(async () => {
    resolvePage(answer<UsageRecords>("usage.records"))
    await delayed
  })
  expect(screen.getByText("15 requests shown")).toBeTruthy()
  expect(screen.queryByText("Unknown cost")).toBeNull()
})

it("reloads the accumulated request sequence after tenant-label invalidation", async () => {
  const { queryStore } = await import("@forge-go/dashboard-plugin")
  const tenantId = answer<UsageRecords>("usage.records").items[0].tenantId!
  const { client } = fixtureClient()
  renderWithClient(<RecordsPage />, client)
  fireEvent.click(
    await screen.findByRole("button", { name: "Load more requests" })
  )
  await screen.findByText("50 requests shown")
  await act(async () => {
    answer("tenants.update", { id: tenantId, name: "Orbit Renamed" })
    queryStore.invalidate("nexus", ["usage.records"])
  })
  await waitFor(() =>
    expect(screen.queryAllByText("Orbit Labs")).toHaveLength(0)
  )
  expect(screen.getAllByText("Orbit Renamed").length).toBeGreaterThan(0)
  expect(screen.getByText("25 requests shown")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Load more requests" }))
  await screen.findByText("50 requests shown")
  expect(screen.queryAllByText("Orbit Labs")).toHaveLength(0)
})
