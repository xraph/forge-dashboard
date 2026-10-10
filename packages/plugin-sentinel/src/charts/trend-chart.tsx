import type { KeyboardEvent } from "react"
import {
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  type ChartConfig,
} from "@forge-go/dashboard-kit/components/chart"
import { formatDay, formatScore, shortRunId } from "../format"
import type { BaselineRef, TrendPoint } from "../types"
import { LineKey } from "./chart-frame"

/**
 * Pass rate is the point, so it wears the ink; average score recedes into the
 * muted grey and is named at its end. Neither is a status, so neither is red.
 * Contrast of both against the surface was checked with the dataviz validator
 * in light and dark (both above 3:1).
 */
const config = {
  passRate: { label: "Pass rate", color: "var(--foreground)" },
  avgScore: { label: "Avg score", color: "var(--muted-foreground)" },
} satisfies ChartConfig

const TICKS = [0, 0.25, 0.5, 0.75, 1]

interface Row {
  index: number
  runId: string
  day: string
  passRate: number
  avgScore: number
}

/**
 * Completed runs in the order they ran, not on a time axis: runs are
 * irregular, and a time axis would crush a burst of ten runs into one cluster.
 * The dated tick labels are how a quiet month still shows. Each pass-rate
 * marker is a link to its run, reachable by keyboard, with a hit area wider
 * than the dot.
 */
export default function TrendChart({
  points,
  baseline,
  onOpenRun,
}: {
  points: TrendPoint[]
  baseline?: BaselineRef
  onOpenRun: (runId: string) => void
}) {
  const rows: Row[] = points.map((p, index) => ({
    index,
    runId: p.runId,
    day: formatDay(p.createdAt),
    passRate: p.passRate,
    avgScore: p.avgScore,
  }))
  const last = rows.length - 1
  // The baseline's label and the average score's end label both sit just past
  // the plot's right edge. When the two values are close they would overlap,
  // so the average's label moves below or above the baseline's.
  const lastAvg = rows[last]?.avgScore
  const nudge =
    baseline &&
    lastAvg !== undefined &&
    Math.abs(lastAvg - baseline.passRate) < 0.08
      ? lastAvg < baseline.passRate
        ? 14
        : -8
      : 4
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-4">
        <LineKey color="var(--foreground)" label="Pass rate" />
        <LineKey color="var(--muted-foreground)" label="Avg score" />
        {baseline && (
          <LineKey
            color="var(--muted-foreground)"
            label={`Baseline "${baseline.name}"`}
            thin
          />
        )}
      </div>
      <ChartContainer config={config} className="aspect-auto h-56 w-full">
        {/* The right margin holds the end labels ("Avg score 0.53", "Baseline 0.88"). */}
        <LineChart
          data={rows}
          margin={{ top: 12, right: 104, bottom: 0, left: 0 }}
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="index"
            tickFormatter={(i: number) => rows[i]?.day ?? ""}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            domain={[0, 1]}
            ticks={TICKS}
            width={36}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatScore}
          />
          {baseline && (
            <ReferenceLine
              y={baseline.passRate}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              ifOverflow="extendDomain"
              label={{
                value: `Baseline ${formatScore(baseline.passRate)}`,
                position: "right",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
          )}
          <ChartTooltip
            cursor={{ stroke: "var(--border)" }}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as Row | undefined
                  return row ? `${row.day}, run ${shortRunId(row.runId)}` : ""
                }}
                formatter={(value, name) => (
                  <span className="flex w-full justify-between gap-4">
                    <span className="text-muted-foreground">
                      {config[name as keyof typeof config]?.label ?? name}
                    </span>
                    <span className="font-mono font-medium tabular-nums">
                      {typeof value === "number" ? formatScore(value) : ""}
                    </span>
                  </span>
                )}
              />
            }
          />
          <Line
            dataKey="avgScore"
            stroke="var(--color-avgScore)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            label={(props: {
              x?: number | string
              y?: number | string
              index?: number
              value?: unknown
            }) =>
              props.index === last && typeof props.value === "number" ? (
                <text
                  key="avg-end"
                  x={Number(props.x) + 8}
                  y={Number(props.y)}
                  dy={nudge}
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {`Avg score ${formatScore(props.value)}`}
                </text>
              ) : (
                <g key={`avg-${props.index}`} />
              )
            }
          />
          <Line
            dataKey="passRate"
            stroke="var(--color-passRate)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            activeDot={false}
            isAnimationActive={false}
            dot={(props: {
              cx?: number
              cy?: number
              index?: number
              payload?: Row
            }) => (
              <RunMarker
                key={`dot-${props.index}`}
                cx={props.cx}
                cy={props.cy}
                row={props.payload}
                onOpen={onOpenRun}
              />
            )}
          />
        </LineChart>
      </ChartContainer>
    </div>
  )
}

/** An 8px marker with a 2px surface ring, inside a 24px hit area that is a link. */
function RunMarker({
  cx,
  cy,
  row,
  onOpen,
}: {
  cx?: number
  cy?: number
  row?: Row
  onOpen: (runId: string) => void
}) {
  if (cx === undefined || cy === undefined || !row) return <g />
  const open = () => onOpen(row.runId)
  return (
    <g
      role="link"
      tabIndex={0}
      aria-label={`Run ${shortRunId(row.runId)}, ${row.day}, pass rate ${formatScore(row.passRate)}`}
      className="cursor-pointer outline-none [&:focus-visible>.ring]:opacity-100"
      onClick={open}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          open()
        }
      }}
    >
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle
        className="opacity-0 ring"
        cx={cx}
        cy={cy}
        r={8}
        fill="none"
        stroke="var(--ring)"
        strokeWidth={2}
      />
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill="var(--foreground)"
        stroke="var(--background)"
        strokeWidth={2}
      />
    </g>
  )
}
