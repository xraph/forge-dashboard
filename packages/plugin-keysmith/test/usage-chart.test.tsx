import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  countTicks,
  segmentShape,
  tooltipOrder,
  tooltipTitle,
  USAGE_CHART_CONFIG,
  UsageChart,
} from "../src/components/usage-chart"
import type { UsageBucket } from "../src/types"

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

// Counts of the same order, so every segment is taller than its own corners.
const BUCKETS: UsageBucket[] = [
  bucket("2026-10-05T12:00:00Z", {
    requests: 90,
    succeeded: 40,
    clientErrors: 30,
    serverErrors: 20,
    avgLatencyMs: 12,
  }),
  bucket("2026-10-05T13:00:00Z"),
  bucket("2026-10-05T14:00:00Z", {
    requests: 80,
    succeeded: 50,
    clientErrors: 30,
    avgLatencyMs: 40,
  }),
]

/** The CSS the kit's ChartContainer writes from the config it was handed. */
function chartCss(container: HTMLElement): string {
  return container.querySelector("[data-chart] style")?.textContent ?? ""
}

describe("USAGE_CHART_CONFIG", () => {
  it("stacks succeeded, then 4xx, then 5xx, in the spec's three colours", () => {
    expect(Object.keys(USAGE_CHART_CONFIG)).toEqual([
      "succeeded",
      "clientErrors",
      "serverErrors",
    ])
    expect(USAGE_CHART_CONFIG.succeeded.color).toBe("#71717b")
    expect(USAGE_CHART_CONFIG.clientErrors.color).toBe("#ec835a")
    expect(USAGE_CHART_CONFIG.serverErrors.color).toBe("#d03b3b")
  })

  it("labels each series in words, so the legend never relies on colour", () => {
    expect(USAGE_CHART_CONFIG.succeeded.label).toBe("Succeeded")
    expect(USAGE_CHART_CONFIG.clientErrors.label).toBe("4xx client errors")
    expect(USAGE_CHART_CONFIG.serverErrors.label).toBe("5xx server errors")
  })
})

describe("UsageChart", () => {
  it("hands the three colours to the chart container for light and dark alike", () => {
    const { container } = render(
      <UsageChart buckets={BUCKETS} period="hourly" />
    )
    const css = chartCss(container)
    // One block per theme, each carrying the same fixed hex.
    expect(css.match(/--color-succeeded:\s*#71717b;/g)).toHaveLength(2)
    expect(css.match(/--color-clientErrors:\s*#ec835a;/g)).toHaveLength(2)
    expect(css.match(/--color-serverErrors:\s*#d03b3b;/g)).toHaveLength(2)
  })

  it("draws three stacked series, filled from those colours", () => {
    const { container } = render(
      <UsageChart buckets={BUCKETS} period="hourly" />
    )
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(3)
    const fills = new Set(
      [...container.querySelectorAll("path[data-series]")].map((p) =>
        p.getAttribute("fill")
      )
    )
    expect(fills).toEqual(
      new Set([
        "var(--color-succeeded)",
        "var(--color-clientErrors)",
        "var(--color-serverErrors)",
      ])
    )
  })

  it("keeps every column at most 24px wide", () => {
    const { container } = render(
      <UsageChart buckets={BUCKETS} period="hourly" />
    )
    const segments = [...container.querySelectorAll("path[data-series]")]
    expect(segments.length).toBeGreaterThan(0)
    for (const s of segments) {
      expect(Number(s.getAttribute("data-width"))).toBeLessThanOrEqual(24)
    }
  })

  it("shows a legend naming all three series, in stack order", () => {
    const { container } = render(
      <UsageChart buckets={BUCKETS} period="hourly" />
    )
    const legend = container.querySelector(".recharts-legend-wrapper")
    expect(legend).not.toBeNull()
    expect(legend?.textContent).toBe(
      "Succeeded4xx client errors5xx server errors"
    )
  })

  it("mounts a tooltip and draws horizontal gridlines only", () => {
    const { container } = render(
      <UsageChart buckets={BUCKETS} period="hourly" />
    )
    expect(container.querySelector(".recharts-tooltip-wrapper")).not.toBeNull()
    expect(
      container.querySelector(".recharts-cartesian-grid-horizontal")
    ).not.toBeNull()
    expect(
      container.querySelector(".recharts-cartesian-grid-vertical")
    ).toBeNull()
  })

  it("names the plot with its period and bucket count", () => {
    render(<UsageChart buckets={BUCKETS} period="hourly" />)
    expect(
      screen.getByRole("group", {
        name: "Requests per hour by outcome, UTC, 3 buckets",
      })
    ).toBeTruthy()
  })

  it("names a daily and a monthly plot by their period", () => {
    const { unmount } = render(<UsageChart buckets={BUCKETS} period="daily" />)
    expect(
      screen.getByRole("group", { name: /^Requests per day by outcome/ })
    ).toBeTruthy()
    unmount()
    render(<UsageChart buckets={BUCKETS.slice(0, 1)} period="monthly" />)
    expect(
      screen.getByRole("group", {
        name: "Requests per month by outcome, UTC, 1 bucket",
      })
    ).toBeTruthy()
  })

  it("labels the value axis with round counts, thousands separated", () => {
    const busy = [
      bucket("2026-10-05T12:00:00Z", {
        requests: 1200,
        succeeded: 1197,
        serverErrors: 3,
      }),
      bucket("2026-10-05T13:00:00Z"),
    ]
    const { container } = render(<UsageChart buckets={busy} period="hourly" />)
    expect(
      [...container.querySelectorAll(".recharts-yAxis-tick-labels text")].map(
        (t) => t.textContent
      )
    ).toEqual(["0", "500", "1,000", "1,500"])
  })

  it("labels the time axis per period, in UTC", () => {
    const { container } = render(
      <UsageChart
        buckets={[
          bucket("2026-10-03T00:00:00Z"),
          bucket("2026-10-04T00:00:00Z"),
        ]}
        period="daily"
      />
    )
    expect(
      [...container.querySelectorAll(".recharts-xAxis-tick-labels text")].map(
        (t) => t.textContent
      )
    ).toEqual(["3 Oct", "4 Oct"])
  })

  it("shows axes in the full form", () => {
    const { container } = render(
      <UsageChart buckets={BUCKETS} period="hourly" />
    )
    expect(container.querySelector(".recharts-xAxis")).not.toBeNull()
    expect(container.querySelector(".recharts-yAxis")).not.toBeNull()
  })

  it("hides the axes, gridlines and legend when compact, and keeps the colours", () => {
    const { container } = render(
      <UsageChart buckets={BUCKETS} period="hourly" compact />
    )
    expect(container.querySelector(".recharts-xAxis")).toBeNull()
    expect(container.querySelector(".recharts-yAxis")).toBeNull()
    expect(container.querySelector(".recharts-cartesian-grid")).toBeNull()
    expect(container.querySelector(".recharts-legend-wrapper")).toBeNull()
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(3)
    expect(chartCss(container)).toMatch(/--color-serverErrors:\s*#d03b3b;/)
  })

  it("keeps every bucket and a baseline when every bucket is empty", () => {
    const zeros = [
      bucket("2026-10-05T12:00:00Z"),
      bucket("2026-10-05T13:00:00Z"),
    ]
    const { container } = render(<UsageChart buckets={zeros} period="hourly" />)
    const ticks = (axis: string) =>
      [...container.querySelectorAll(`.recharts-${axis}-tick-labels text`)].map(
        (t) => t.textContent
      )
    // One tick per bucket, so a quiet hour is a zero and not a gap.
    expect(ticks("xAxis")).toEqual(["12:00", "13:00"])
    // A 0 to 1 scale rather than one with no height, and the three series
    // still mounted, so the tooltip still lists them.
    expect(ticks("yAxis")).toEqual(["0", "1"])
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(3)
    expect(
      screen.getByRole("group", {
        name: "Requests per hour by outcome, UTC, 2 buckets",
      })
    ).toBeTruthy()
  })
})

describe("the tooltip", () => {
  it("lists the series in stack order, not alphabetically", () => {
    // Alphabetical would read clientErrors, serverErrors, succeeded.
    const items = [
      { dataKey: "serverErrors" },
      { dataKey: "succeeded" },
      { dataKey: "clientErrors" },
    ]
    const sorted = [...items].sort((a, b) => tooltipOrder(a) - tooltipOrder(b))
    expect(sorted.map((i) => i.dataKey)).toEqual([
      "succeeded",
      "clientErrors",
      "serverErrors",
    ])
  })

  it("titles the hovered column with its bucket in full, in UTC", () => {
    const payload = [{ payload: { start: "2026-10-05T03:00:00Z" } }]
    // 03:00Z is the evening of the 4th in Chicago.
    expect(tooltipTitle(payload, "hourly")).toBe("5 Oct 2026, 03:00 UTC")
    expect(tooltipTitle(payload, "daily")).toBe("5 Oct 2026")
    expect(tooltipTitle(payload, "monthly")).toBe("Oct 2026")
  })

  it("has no title without a bucket", () => {
    expect(tooltipTitle(undefined, "hourly")).toBeNull()
    expect(tooltipTitle([], "hourly")).toBeNull()
  })
})

describe("countTicks", () => {
  it("steps by 1, 2 or 5 times a power of ten, ending at or above the tallest column", () => {
    expect(countTicks(2400)).toEqual([0, 1000, 2000, 3000])
    expect(countTicks(1200)).toEqual([0, 500, 1000, 1500])
    expect(countTicks(55)).toEqual([0, 20, 40, 60])
    expect(countTicks(40)).toEqual([0, 10, 20, 30, 40])
  })

  it("never steps by less than one request", () => {
    expect(countTicks(3)).toEqual([0, 1, 2, 3])
    expect(countTicks(1)).toEqual([0, 1])
  })

  it("is 0 and 1 for a range with no requests", () => {
    expect(countTicks(0)).toEqual([0, 1])
  })
})

describe("segmentShape", () => {
  const rect = { x: 10, y: 20, width: 24, height: 50, fill: "var(--color-x)" }

  it("rounds the top two corners of the topmost non-empty segment and leaves the base square", () => {
    const shape = segmentShape("clientErrors")
    const { container } = render(
      <svg>
        {shape({
          ...rect,
          payload: { succeeded: 5, clientErrors: 3, serverErrors: 0 },
        })}
      </svg>
    )
    const path = container.querySelector("path")!
    expect(path.getAttribute("d")?.match(/A\s*4,4/g)).toHaveLength(2)
    expect(path.getAttribute("data-top")).toBe("true")
    expect(path.getAttribute("fill")).toBe("var(--color-x)")
  })

  it("leaves a 2px surface gap above a segment with another one stacked on it", () => {
    const shape = segmentShape("succeeded")
    const { container } = render(
      <svg>
        {shape({
          ...rect,
          payload: { succeeded: 5, clientErrors: 3, serverErrors: 0 },
        })}
      </svg>
    )
    const path = container.querySelector("path")!
    expect(path.getAttribute("data-top")).toBe("false")
    // Square corners, starting 2px below the segment's top edge.
    expect(path.getAttribute("d")).not.toMatch(/A/)
    expect(path.getAttribute("d")).toBe("M10,22h24v48h-24Z")
  })

  it("draws nothing for an empty segment", () => {
    const shape = segmentShape("serverErrors")
    const { container } = render(
      <svg>
        {shape({
          ...rect,
          height: 0,
          payload: { succeeded: 5, clientErrors: 3, serverErrors: 0 },
        })}
      </svg>
    )
    expect(container.querySelector("path")).toBeNull()
  })

  it("keeps the corner radius inside a short segment", () => {
    const shape = segmentShape("serverErrors")
    const { container } = render(
      <svg>
        {shape({
          ...rect,
          height: 3,
          payload: { succeeded: 0, clientErrors: 0, serverErrors: 1 },
        })}
      </svg>
    )
    expect(container.querySelector("path")?.getAttribute("d")).toMatch(
      /A\s*3,3/
    )
  })
})
