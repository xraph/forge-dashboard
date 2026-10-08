import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@forge-go/dashboard-kit/components/chart"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import type { UsageEvent } from "../types"

export interface DayTotal {
  /** The UTC calendar day, YYYY-MM-DD. */
  day: string
  label: string
  quantity: number
}

const DAY = 86_400_000
const number = new Intl.NumberFormat()

function dayKey(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/**
 * UTC midnight `days - 1` days before now: the window's first day, whole.
 *
 * UTC because the engine cuts billing periods in UTC and the page shows a
 * month total beside the chart. Columns in the operator's zone would not sum
 * to what is billed at the window's edges, and would drift across daylight
 * saving changes. UTC has no such change, so a day is always 86,400,000 ms.
 */
export function windowStart(days: number, nowMs: number): number {
  const d = new Date(nowMs - (days - 1) * DAY)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Events summed per UTC calendar day across the window, with every day
 * present, including the ones where nothing happened: a missing column would
 * read as a gap in the data rather than a quiet day. `startMs` is a UTC
 * midnight (see windowStart).
 */
export function dailyTotals(
  events: UsageEvent[],
  startMs: number,
  days: number
): DayTotal[] {
  const totals: DayTotal[] = []
  const index = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    const at = new Date(startMs + i * DAY)
    const day = dayKey(at)
    index.set(day, totals.length)
    totals.push({
      day,
      label: at.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      quantity: 0,
    })
  }
  for (const e of events) {
    const i = index.get(dayKey(new Date(e.timestamp)))
    if (i !== undefined) totals[i].quantity += e.quantity
  }
  return totals
}

const config = {
  quantity: { label: "Units", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * The plugin's one chart: units per UTC day, one series, one hue.
 *
 * Built to the dataviz rules the plan records. Columns at most 24px wide
 * with a 4px rounded top and a square base, the kit's --chart-1 as the only
 * fill, horizontal hairline gridlines and nothing else, no legend because
 * the heading already names the series, a tooltip per column, and the same
 * numbers as a table for anybody the chart does not serve. The columns do
 * not animate in: a refetch on every filter change would replay it each time,
 * and the table is there for anybody who wants the numbers without motion.
 */
export function UsageChart({
  totals,
  truncated,
  refreshing,
}: {
  totals: DayTotal[]
  truncated: boolean
  refreshing: boolean
}) {
  return (
    <section aria-label="Usage over time" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-medium">Units per day</h2>
        <p className="text-sm text-muted-foreground">
          Columns are UTC days, the same days billing periods are cut on.
        </p>
      </div>
      <div
        data-refreshing={refreshing ? "true" : "false"}
        className={cn("transition-opacity", refreshing && "opacity-60")}
      >
        <ChartContainer
          config={config}
          role="group"
          aria-label={`Units per UTC day, ${totals.length} days`}
          className="aspect-auto h-[260px] w-full"
        >
          <BarChart
            data={totals}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={16}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              allowDecimals={false}
              tickFormatter={(v: number) => number.format(v)}
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={<ChartTooltipContent />}
            />
            <Bar
              dataKey="quantity"
              fill="var(--color-quantity)"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </div>
      {truncated && (
        <p className="text-sm text-muted-foreground">
          The chart covers the 200 most recent events in this window, and there
          are more. Narrow it to one tenant or one feature to see all of it.
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Show the same numbers as a table
        </summary>
        <table className="mt-2 w-full max-w-sm text-sm">
          <caption className="sr-only">{`Units per day, ${totals.length} ${totals.length === 1 ? "day" : "days"}`}</caption>
          <thead>
            <tr>
              <th className="text-left font-medium">Day (UTC)</th>
              <th className="text-right font-medium">Units</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) => (
              <tr key={t.day}>
                <td>{t.label}</td>
                <td className="text-right tabular-nums">
                  {number.format(t.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
