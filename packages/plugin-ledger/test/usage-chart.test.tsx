import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { dailyTotals, UsageChart, windowStart } from "../src/components/usage-chart"
import type { UsageEvent } from "../src/types"

function event(at: number, quantity: number): UsageEvent {
  return { id: `evt_${at}_${quantity}`, tenant_id: "acme", app_id: "app_ledger", feature_key: "api_calls", quantity, timestamp: new Date(at).toISOString() }
}

/*
 * Every instant below is built with Date.UTC, never the local Date
 * constructor, and the suite is also run under TZ=America/Chicago and
 * TZ=Pacific/Auckland: the engine cuts billing periods in UTC, so a column is
 * a UTC day whatever zone the operator's machine is in.
 */
describe("dailyTotals", () => {
  const start = Date.UTC(2026, 8, 27)

  it("sums each UTC day and keeps days with nothing at zero", () => {
    const totals = dailyTotals(
      [event(Date.UTC(2026, 8, 27, 9), 10), event(Date.UTC(2026, 8, 27, 18), 5), event(Date.UTC(2026, 8, 29, 1), 7)],
      start,
      3,
    )
    expect(totals.map((t) => t.quantity)).toEqual([15, 0, 7])
    expect(totals.map((t) => t.day)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29"])
  })

  it("puts 23:30 UTC and 00:30 UTC the next day in different columns, whatever the machine zone", () => {
    const totals = dailyTotals([event(Date.UTC(2026, 8, 27, 23, 30), 3), event(Date.UTC(2026, 8, 28, 0, 30), 4)], start, 3)
    expect(totals.map((t) => t.quantity)).toEqual([3, 4, 0])
  })

  it("keeps an event stamped exactly at midnight UTC in the day it opens", () => {
    const totals = dailyTotals([event(Date.UTC(2026, 8, 28), 6)], start, 3)
    expect(totals.map((t) => t.quantity)).toEqual([0, 6, 0])
  })

  it("labels each column with its UTC date", () => {
    const totals = dailyTotals([], start, 2)
    expect(totals.map((t) => t.label)).toEqual(["Sep 27", "Sep 28"])
  })

  it("does not skip or repeat a day across a daylight saving change", () => {
    // 2026-11-01 is the US fall-back day and 2026-03-08 the spring-forward day.
    expect(dailyTotals([], Date.UTC(2026, 9, 31), 3).map((t) => t.day)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"])
    expect(dailyTotals([], Date.UTC(2026, 2, 7), 3).map((t) => t.day)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"])
  })

  it("ignores events outside the window", () => {
    const totals = dailyTotals([event(Date.UTC(2026, 8, 20), 99), event(Date.UTC(2026, 9, 5), 99)], start, 3)
    expect(totals.map((t) => t.quantity)).toEqual([0, 0, 0])
  })

  it("ignores an event whose timestamp does not parse", () => {
    const bad = { ...event(start, 5), timestamp: "not a date" }
    expect(dailyTotals([bad], start, 2).map((t) => t.quantity)).toEqual([0, 0])
  })
})

describe("windowStart", () => {
  it("is UTC midnight, days - 1 days before now, whatever the hour", () => {
    expect(windowStart(3, Date.UTC(2026, 8, 29, 23, 30))).toBe(Date.UTC(2026, 8, 27))
    expect(windowStart(3, Date.UTC(2026, 8, 29, 0, 30))).toBe(Date.UTC(2026, 8, 27))
  })

  it("makes the last column the UTC day of now", () => {
    const now = Date.UTC(2026, 8, 29, 0, 30)
    const totals = dailyTotals([event(now, 8)], windowStart(7, now), 7)
    expect(totals).toHaveLength(7)
    expect(totals[0].day).toBe("2026-09-23")
    expect(totals[6]).toMatchObject({ day: "2026-09-29", quantity: 8 })
  })
})

describe("UsageChart", () => {
  const totals = [
    { day: "2026-09-27", label: "Sep 27", quantity: 15 },
    { day: "2026-09-28", label: "Sep 28", quantity: 0 },
    { day: "2026-09-29", label: "Sep 29", quantity: 1200 },
  ]

  it("names the series in its heading, says the days are UTC, and has no legend", () => {
    render(<UsageChart totals={totals} truncated={false} refreshing={false} />)
    expect(screen.getByRole("heading", { name: "Units per day" })).toBeTruthy()
    expect(screen.getByText(/UTC days/)).toBeTruthy()
    expect(document.querySelector(".recharts-legend-wrapper")).toBeNull()
  })

  it("offers the same numbers as a table", () => {
    render(<UsageChart totals={totals} truncated={false} refreshing={false} />)
    const table = screen.getByRole("table", { name: "Units per day" })
    expect(within(table).getByRole("columnheader", { name: "Day (UTC)" })).toBeTruthy()
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[2]).getByText("1,200").className).toMatch(/tabular-nums/)
  })

  it("draws one series of columns, at most 24px wide, filled from the chart colour, with horizontal gridlines only", () => {
    // Quantities of the same order, so no column is shorter than its own 4px radius.
    const even = [
      { day: "2026-09-27", label: "Sep 27", quantity: 40 },
      { day: "2026-09-28", label: "Sep 28", quantity: 0 },
      { day: "2026-09-29", label: "Sep 29", quantity: 80 },
    ]
    const { container } = render(<UsageChart totals={even} truncated={false} refreshing={false} />)
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(1)
    const columns = [...container.querySelectorAll(".recharts-bar-rectangle path")]
    expect(columns.length).toBeGreaterThan(0)
    for (const c of columns) {
      expect(c.getAttribute("fill")).toBe("var(--color-quantity)")
      expect(Number(c.getAttribute("width"))).toBeLessThanOrEqual(24)
      // A 4px radius on the two top corners and none on the base: two arcs.
      // A day with nothing in it is a zero-height column with no corner to round.
      if (Number(c.getAttribute("height")) > 0) expect(c.getAttribute("d")?.match(/A\s*4,4/g)).toHaveLength(2)
    }
    expect(container.querySelector(".recharts-cartesian-grid-horizontal")).not.toBeNull()
    expect(container.querySelector(".recharts-cartesian-grid-vertical")).toBeNull()
  })

  it("maps the series colour to the chart token and mounts a tooltip", () => {
    const { container } = render(<UsageChart totals={totals} truncated={false} refreshing={false} />)
    const css = container.querySelector("[data-chart] style, style")?.textContent ?? ""
    expect(css).toMatch(/--color-quantity:\s*var\(--chart-1\)/)
    expect(container.querySelector(".recharts-tooltip-wrapper")).not.toBeNull()
  })

  it("names the plot and says the table holds the same numbers", () => {
    render(<UsageChart totals={totals} truncated={false} refreshing={false} />)
    expect(screen.getByRole("group", { name: "Units per UTC day, 3 days" })).toBeTruthy()
    expect(screen.getByText("Show the same numbers as a table")).toBeTruthy()
  })

  it("says when the events it drew from were cut off", () => {
    render(<UsageChart totals={totals} truncated refreshing={false} />)
    expect(screen.getByText(/The chart covers the 200 most recent events in this window/)).toBeTruthy()
  })

  it("keeps the previous render, dimmed, while refreshing", () => {
    const { container } = render(<UsageChart totals={totals} truncated={false} refreshing />)
    expect(container.querySelector("[data-refreshing='true']")?.className).toMatch(/opacity-60/)
  })

  it("is not dimmed when settled", () => {
    const { container } = render(<UsageChart totals={totals} truncated={false} refreshing={false} />)
    expect(container.querySelector("[data-refreshing='false']")?.className).not.toMatch(/opacity-60/)
  })
})
