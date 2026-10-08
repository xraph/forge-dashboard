import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { chartGeometry } from "../src/charts/geometry"
import { UsageCharts, ExactTooltip } from "../src/charts/usage-charts"
import type { SeriesPoint } from "../src/types"

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)
const point = (costUsd: string): SeriesPoint => ({
  start: "2026-10-08T00:00:00Z",
  requests: 3,
  tokens: 12,
  costUsd,
  unpriced: 1,
})
it("preserves exact costs while producing finite chart geometry", () => {
  const huge = "9007199254740993.000000150"
  const data = chartGeometry([point("0.000000150"), point(huge)])
  expect(data.renderable).toBe(true)
  expect(data.rows.map((p) => p.costUsd)).toEqual(["0.000000150", huge])
  expect(data.rows[0].spendHeight).toBeGreaterThan(0)
  expect(data.rows[1].spendHeight).toBe(100)
  expect(chartGeometry([point("0")]).rows[0].spendHeight).toBe(0)
  expect(chartGeometry([point("9".repeat(400))]).renderable).toBe(false)
  expect(chartGeometry([point(`0.${"0".repeat(400)}1`)]).renderable).toBe(false)
})
it("shows every digit of the source cost in the tooltip", () => {
  const cost = "9007199254740993.000000150"
  render(
    <ExactTooltip active payload={[{ payload: point(cost) }]} metric="spend" />
  )
  expect(screen.getByText(`$${cost}`)).toBeTruthy()
  expect(screen.getByText(/1 unpriced request/)).toBeTruthy()
})
it("offers exact table values for normal and unrenderable ranges", () => {
  const { rerender } = render(<UsageCharts items={[point("0.000000150")]} />)
  expect(document.querySelectorAll('[data-slot="chart"]')).toHaveLength(2)
  fireEvent.click(screen.getByRole("button", { name: "Table view" }))
  expect(screen.getByRole("table").textContent?.includes("$0.000000150")).toBe(
    true
  )
  rerender(<UsageCharts items={[point("9".repeat(400))]} />)
  expect(screen.getByText(/outside the chart range/)).toBeTruthy()
  expect(screen.getByRole("table")).toBeTruthy()
})
