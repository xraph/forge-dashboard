import { useState, type ComponentType } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@forge-go/dashboard-kit/components/card"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { AggregateGroup, AggregateResponse, OverviewStats } from "../types"
import { HorizontalBars, VolumeBars } from "../charts/bars"
import { breakdown, bucketRuns, bucketSeries, emptyBuckets, floorBucket, formatBucket, type BucketUnit } from "../charts/series"
import { formatSeq } from "../format"

const RANGE: Record<BucketUnit, { label: string; span: number; noun: string }> = {
  day: { label: "By day", span: 30 * 86_400_000, noun: "days" },
  hour: { label: "By hour", span: 48 * 3_600_000, noun: "hours" },
}

function Breakdown({ title, groups, by }: { title: string; groups: AggregateGroup[]; by: "category" | "severity" | "outcome" }) {
  const data = breakdown(groups, by)
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events.</p>
        ) : (
          <HorizontalBars data={data} label={title} />
        )}
      </CardContent>
    </Card>
  )
}

/** The empty buckets as a sentence. It is the finding, so it is text and not a tooltip. */
function emptyNote(empty: string[], unit: BucketUnit): string {
  const spans = bucketRuns(empty, unit).map((r) =>
    r.from === r.to ? formatBucket(r.from, true) : `${formatBucket(r.from, true)} to ${formatBucket(r.to, true)}`,
  )
  return `Nothing was recorded in ${empty.length} of these ${RANGE[unit].noun}: ${spans.join(", ")}`
}

/**
 * Counts, breakdowns and volume over time.
 *
 * `now` anchors the volume range. It is read once, because a range that moved
 * on every render would be a new query on every render.
 */
export const ActivityPage: ComponentType<PluginPageProps & { now?: Date }> = ({ now }) => {
  const [anchor] = useState(() => now ?? new Date())
  const [unit, setUnit] = useState<BucketUnit>("day")
  // Floored before it is queried as well as before it is bucketed: a query
  // that starts mid-bucket sees only part of the first bucket, and would name
  // it empty although events exist earlier in it.
  const from = floorBucket(new Date(anchor.getTime() - RANGE[unit].span), unit)
  const stats = useQuery<OverviewStats>("overview.stats", {})
  const volume = useQuery<AggregateResponse>("events.aggregate", { groupBy: [unit], after: from.toISOString() })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Activity" description="How much was recorded, and when nothing was." />
      <QueryBoundary title="activity counts" query={stats} skeletonRows={4}>
        {(s) => (
          <>
            <StatGrid
              items={[
                // The counts cover the whole scope and the volume chart below a
                // shorter period, so each count says it is all time.
                { label: "Total events", value: formatSeq(s.totalEvents), hint: "All time" },
                { label: "Critical", value: formatSeq(s.criticalEvents), hint: "All time" },
                {
                  label: "Failed or denied",
                  value: formatSeq(s.failedEvents + s.deniedEvents),
                  hint: `All time: ${formatSeq(s.failedEvents)} failed, ${formatSeq(s.deniedEvents)} denied`,
                },
                { label: "Erasures", value: formatSeq(s.erasureCount), hint: "All time" },
              ]}
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Breakdown title="By category" groups={s.categories} by="category" />
              <Breakdown title="By severity" groups={s.severities} by="severity" />
              <Breakdown title="By outcome" groups={s.outcomes} by="outcome" />
            </div>
          </>
        )}
      </QueryBoundary>
      <Card size="sm">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Volume over time</CardTitle>
          <div className="flex gap-1">
            {(Object.keys(RANGE) as BucketUnit[]).map((u) => (
              <Button key={u} size="sm" variant={u === unit ? "secondary" : "outline"} aria-pressed={u === unit} onClick={() => setUnit(u)}>
                {RANGE[u].label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <QueryBoundary title="event volume" query={volume} skeletonRows={4}>
            {(agg) => {
              if (agg.total === 0) return <p className="text-sm text-muted-foreground">No events in this period.</p>
              const series = bucketSeries(agg.groups, from, anchor, unit)
              const empty = emptyBuckets(series)
              return (
                <>
                  <VolumeBars series={series} label={`Events per ${unit}`} />
                  {empty.length > 0 && <p className="text-sm">{emptyNote(empty, unit)}</p>}
                </>
              )
            }}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  )
}

export default ActivityPage
