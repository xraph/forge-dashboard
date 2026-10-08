import { useState } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  ChartContainer,
  ChartTooltip,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "@forge-go/dashboard-kit/components/chart"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Money } from "../components/money"
import { count, Notice } from "../components/read"
import type { SeriesPoint } from "../types"
import { chartGeometry } from "./geometry"

export function ExactTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean
  payload?: readonly { payload?: SeriesPoint }[]
  metric: "spend" | "requests"
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <p className="mb-1 text-muted-foreground">
        {point.start ?? "Unknown time"}
      </p>
      {metric === "spend" ? (
        <Money value={point.costUsd} />
      ) : (
        <span>{count(point.requests)} requests</span>
      )}
      <p className="mt-1 text-muted-foreground">
        {count(point.unpriced)} unpriced requests excluded from spend
      </p>
    </div>
  )
}

function tick(value: string | null) {
  return value ? value.slice(5, 16).replace("T", " ") : "Unknown"
}

export function UsageCharts({ items }: { items: SeriesPoint[] }) {
  const [table, setTable] = useState(false)
  const data = chartGeometry(items)
  const showTable = table || !data.renderable
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          UTC buckets. Bars start at zero; spend heights are relative to the
          peak.
        </span>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={showTable}
          disabled={!data.renderable}
          onClick={() => setTable(!table)}
        >
          {showTable ? "Chart view" : "Table view"}
        </Button>
      </div>
      {!data.renderable && (
        <Notice>
          These amounts are outside the chart range. Exact values are available
          in the table.
        </Notice>
      )}
      {showTable ? (
        <ResourceTable
          density="compact"
          rows={items}
          rowKey={(r) => r.start ?? "unknown"}
          emptyMessage="No usage buckets"
          columns={[
            {
              id: "start",
              header: "Bucket start (UTC)",
              cell: (r) => r.start ?? "Unavailable",
            },
            {
              id: "spend",
              header: "Spend",
              align: "end",
              cell: (r) => <Money value={r.costUsd} />,
            },
            {
              id: "requests",
              header: "Requests",
              align: "end",
              cell: (r) => count(r.requests),
            },
            {
              id: "tokens",
              header: "Tokens",
              align: "end",
              cell: (r) => count(r.tokens),
            },
            {
              id: "unpriced",
              header: "Unpriced",
              align: "end",
              cell: (r) => count(r.unpriced),
            },
          ]}
        />
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          <figure className="min-w-0 space-y-1">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">Spend per bucket</span>
              <span>
                Peak <Money value={data.peak} />
              </span>
            </figcaption>
            <ChartContainer
              className="aspect-auto h-48 w-full"
              config={{
                spendHeight: { label: "Spend", color: "var(--chart-1)" },
              }}
              aria-label="Spend per bucket"
            >
              <BarChart
                data={data.rows}
                accessibilityLayer
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="start"
                  tickFormatter={tick}
                  minTickGap={32}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis hide domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
                <ChartTooltip content={<ExactTooltip metric="spend" />} />
                <Bar
                  dataKey="spendHeight"
                  fill="var(--color-spendHeight)"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </figure>
          <figure className="min-w-0 space-y-1">
            <figcaption className="text-xs font-medium">
              Requests per bucket
            </figcaption>
            <ChartContainer
              className="aspect-auto h-48 w-full"
              config={{
                requests: { label: "Requests", color: "var(--chart-2)" },
              }}
              aria-label="Requests per bucket"
            >
              <BarChart
                data={data.rows}
                accessibilityLayer
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="start"
                  tickFormatter={tick}
                  minTickGap={32}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, "dataMax"]}
                  allowDecimals={false}
                  width={36}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip content={<ExactTooltip metric="requests" />} />
                <Bar
                  dataKey="requests"
                  fill="var(--color-requests)"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </figure>
        </div>
      )}
    </div>
  )
}
