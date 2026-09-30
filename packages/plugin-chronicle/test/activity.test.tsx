import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { describe, expect, it } from "vitest"
import { ActivityPage } from "../src/pages/activity"
import { renderPage, scriptedClient } from "./harness"

const stats = {
  totalEvents: 12431, criticalEvents: 21, failedEvents: 40, deniedEvents: 12, erasureCount: 2,
  categories: [{ category: "auth", count: 5000 }, { category: "data", count: 7431 }],
  severities: [{ severity: "info", count: 12000 }], outcomes: [{ outcome: "success", count: 12379 }],
}

function client(over: Partial<Record<string, unknown>> = {}) {
  return scriptedClient({
    "overview.stats": stats,
    "events.aggregate": (p) =>
      (p.groupBy as string[])[0] === "hour"
        ? { groups: [{ bucket: "2026-09-28T02:00:00Z", count: 4 }, { bucket: "2026-09-28T04:00:00Z", count: 2 }], total: 6 }
        : { groups: [{ bucket: "2026-09-28", count: 6 }], total: 6 },
    ...over,
  })
}

const NOW = new Date("2026-09-28T05:00:00Z")

function renderAt(c: ReturnType<typeof client>) {
  return render(
    <PluginProvider client={c.client}>
      <ActivityPage params={{}} now={NOW} />
    </PluginProvider>,
  )
}

describe("ActivityPage", () => {
  it("shows the four counts as stat tiles, with failed and denied summed and labelled", async () => {
    renderPage(ActivityPage, client().client)
    await waitFor(() => expect(screen.getByText("12,431")).toBeTruthy())
    expect(screen.getByText("Failed or denied")).toBeTruthy()
    expect(screen.getByText("52")).toBeTruthy()
    expect(screen.getByText("40 failed, 12 denied")).toBeTruthy()
    expect(screen.getByText("21")).toBeTruthy()
    expect(screen.getByText("Erasures")).toBeTruthy()
  })

  it("states each breakdown's numbers in the chart's own label, sorted by count", async () => {
    renderPage(ActivityPage, client().client)
    expect(await screen.findByRole("img", { name: "By category: data 7,431, auth 5,000" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "By severity: info 12,000" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "By outcome: success 12,379" })).toBeTruthy()
  })

  it("asks for volume by day over the last 30 days by default", async () => {
    const c = client()
    renderPage(ActivityPage, c.client)
    await waitFor(() => expect(c.queried.some((q) => q.intent === "events.aggregate")).toBe(true))
    const p = c.queried.find((q) => q.intent === "events.aggregate")!.params
    expect(p.groupBy).toEqual(["day"])
    expect(typeof p.after).toBe("string")
  })

  it("asks for the last 48 hours of now when switched to hours", async () => {
    const c = client()
    renderAt(c)
    fireEvent.click(await screen.findByRole("button", { name: "By hour" }))
    await waitFor(() => expect(c.queried.some((q) => (q.params.groupBy as string[])?.[0] === "hour")).toBe(true))
    const p = c.queried.find((q) => (q.params.groupBy as string[])?.[0] === "hour")!.params
    expect(p.after).toBe("2026-09-26T05:00:00.000Z")
  })

  it("queries from the start of a UTC hour, so the first hour is queried whole", async () => {
    const c = client()
    render(
      <PluginProvider client={c.client}>
        <ActivityPage params={{}} now={new Date("2026-09-28T05:30:00Z")} />
      </PluginProvider>,
    )
    fireEvent.click(await screen.findByRole("button", { name: "By hour" }))
    await waitFor(() => expect(c.queried.some((q) => (q.params.groupBy as string[])?.[0] === "hour")).toBe(true))
    const p = c.queried.find((q) => (q.params.groupBy as string[])?.[0] === "hour")!.params
    expect(p.after).toBe("2026-09-26T05:00:00.000Z")
  })

  it("names the hours in which nothing was recorded", async () => {
    const c = client()
    renderAt(c)
    fireEvent.click(await screen.findByRole("button", { name: "By hour" }))
    const sentence = await screen.findByText(/Nothing was recorded in/)
    expect(sentence.textContent).toMatch(/of these hours/)
    expect(sentence.textContent).toMatch(/28 Sep 03:00/)
    // 49 hours are in range and two of them hold events.
    expect(sentence.textContent).toMatch(/in 47 of these hours/)
  })

  it("names an empty day", async () => {
    const full = client({
      "events.aggregate": { groups: [{ bucket: "2026-09-28", count: 6 }], total: 6 },
    })
    renderAt(full)
    expect((await screen.findByText(/Nothing was recorded in/)).textContent).toMatch(/of these days/)
  })

  it("says nothing about empty days when every day in range holds events", async () => {
    // 30 days back from the 28th, floored to a day, is 29 Aug: 31 days in all.
    const groups = Array.from({ length: 31 }, (_, i) => ({
      bucket: new Date(Date.UTC(2026, 7, 29 + i)).toISOString().slice(0, 10),
      count: 1,
    }))
    const c = client({ "events.aggregate": { groups, total: 31 } })
    renderAt(c)
    await waitFor(() => expect(screen.getByRole("img", { name: /^Events per day: 29 Aug 1, 30 Aug 1/ })).toBeTruthy())
    expect(screen.queryByText(/Nothing was recorded in/)).toBeNull()
  })

  it("queries from the start of a UTC day, so the first day is queried whole", async () => {
    const c = client()
    render(
      <PluginProvider client={c.client}>
        <ActivityPage params={{}} now={new Date("2026-09-28T05:30:00Z")} />
      </PluginProvider>,
    )
    await waitFor(() => expect(c.queried.some((q) => q.intent === "events.aggregate")).toBe(true))
    expect(c.queried.find((q) => q.intent === "events.aggregate")!.params.after).toBe("2026-08-29T00:00:00.000Z")
  })

  it("says so when the period holds no events, instead of drawing an empty plot", async () => {
    renderAt(client({ "events.aggregate": { groups: [], total: 0 } }))
    expect(await screen.findByText("No events in this period.")).toBeTruthy()
    expect(screen.queryByText(/Nothing was recorded in/)).toBeNull()
  })
})
