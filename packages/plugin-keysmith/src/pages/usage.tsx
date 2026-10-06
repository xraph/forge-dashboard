import { useMemo, useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { UsageChart } from "../components/usage-chart"
import {
  bucketTitle,
  formatCount,
  formatLatency,
  formatUtcMinute,
  keyPath,
  rangeBounds,
  USAGE_RANGES,
  type UsageRangeId,
} from "../format"
import type {
  KeysList,
  UsageBucket,
  UsagePeriod,
  UsageRecordItem,
  UsageRecords,
  UsageSeries,
} from "../types"

const PAGE_SIZE = 25

// The key filter's names. 100 is the contract's page cap; a tenant with more
// keys can still reach the rest from a key's own page.
const KEY_PARAMS = { limit: 100 }

const ALL_KEYS = { value: "", label: "All keys" }

const RANGE_OPTIONS = USAGE_RANGES.map((r) => ({ value: r.id, label: r.label }))

function isRangeId(value: string): value is UsageRangeId {
  return USAGE_RANGES.some((r) => r.id === value)
}

/** The same buckets as the chart, one row each, for anybody the chart does not serve. */
function bucketColumns(period: UsagePeriod): Column<UsageBucket>[] {
  return [
    {
      id: "start",
      header: "Bucket start",
      cell: (b) => bucketTitle(b.start, period),
    },
    {
      id: "succeeded",
      header: "Succeeded",
      align: "end",
      cell: (b) => <span className="tabular-nums">{formatCount(b.succeeded)}</span>,
    },
    {
      id: "clientErrors",
      header: "4xx",
      align: "end",
      cell: (b) => <span className="tabular-nums">{formatCount(b.clientErrors)}</span>,
    },
    {
      id: "serverErrors",
      header: "5xx",
      align: "end",
      cell: (b) => <span className="tabular-nums">{formatCount(b.serverErrors)}</span>,
    },
    {
      id: "requests",
      header: "Requests",
      align: "end",
      cell: (b) => <span className="tabular-nums">{formatCount(b.requests)}</span>,
    },
    {
      id: "avgLatency",
      header: "Avg latency",
      align: "end",
      // An empty bucket has nothing to average.
      cell: (b) =>
        b.avgLatencyMs === null ? (
          <NoneCell label="requests" />
        ) : (
          <span className="tabular-nums">{formatLatency(b.avgLatencyMs)}</span>
        ),
    },
  ]
}

const recordColumns: Column<UsageRecordItem>[] = [
  {
    id: "time",
    header: "Time",
    // UTC, like the chart and the bucket table, so a request lines up with
    // the column it was counted in. The exact instant is in the title.
    cell: (r) => (
      <time dateTime={r.at} title={r.at} className="tabular-nums">
        {formatUtcMinute(r.at)}
      </time>
    ),
  },
  {
    id: "key",
    header: "Key",
    cell: (r) => (
      <PluginLink to={keyPath(r.keyId)} className="font-mono text-xs">
        {r.keyId}
      </PluginLink>
    ),
  },
  {
    id: "method",
    header: "Method",
    cell: (r) => r.method,
  },
  {
    id: "endpoint",
    header: "Endpoint",
    cell: (r) => <span className="font-mono text-xs">{r.endpoint}</span>,
  },
  {
    id: "status",
    header: "Status",
    cell: (r) => <span className="tabular-nums">{r.statusCode}</span>,
  },
  {
    id: "latency",
    header: "Latency",
    cell: (r) => <span className="tabular-nums">{formatLatency(r.latencyMs)}</span>,
  },
  {
    id: "ip",
    header: "IP",
    cell: (r) =>
      r.ipAddress ? (
        <span className="font-mono text-xs">{r.ipAddress}</span>
      ) : (
        <NoneCell label="IP address recorded" />
      ),
  },
]

/** The chart, or the same buckets as a table, under a toggle that keeps one label. */
function SeriesView({
  data,
  view,
  onToggle,
}: {
  data: UsageSeries
  view: "chart" | "table"
  onToggle: () => void
}) {
  // Not recorded is not the same as quiet. Until the application calls
  // RecordUsage there is nothing to draw, and a flat chart of zeros would
  // read as a deployment nobody is calling.
  if (!data.recorded) {
    return (
      <EmptyState
        title="No usage recorded yet."
        description="Usage appears once your application calls RecordUsage."
      />
    )
  }
  const buckets = data.buckets ?? []
  const quiet = buckets.every((b) => b.requests === 0)
  const n = buckets.length
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">Requests by outcome</h2>
        {/* A toggle keeps one label and says its state with aria-pressed.
            The kit Button has no pressed style, so the class shows it, dark
            mode included (outline's dark background is as specific). */}
        <Button
          variant="outline"
          size="sm"
          className="aria-pressed:bg-muted aria-pressed:text-foreground dark:aria-pressed:bg-muted"
          aria-pressed={view === "table"}
          onClick={onToggle}
        >
          Table
        </Button>
      </div>
      {quiet && (
        <p className="text-sm text-muted-foreground">
          No requests in this range.
        </p>
      )}
      {view === "table" ? (
        <ResourceTable<UsageBucket>
          columns={bucketColumns(data.period)}
          rows={buckets}
          rowKey={(b) => b.start}
          caption={`${n} ${data.period} ${n === 1 ? "bucket" : "buckets"}, UTC`}
          emptyMessage="No buckets in this range."
        />
      ) : (
        <UsageChart buckets={buckets} period={data.period} />
      )}
    </div>
  )
}

export const UsagePage: ComponentType<PluginPageProps> = () => {
  const [range, setRange] = useState<UsageRangeId>("24h")
  const [keyId, setKeyId] = useState("")
  const [view, setView] = useState<"chart" | "table">("chart")
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  // Pinned, so the window does not slide under a page being read. A new
  // filter takes a new reading of the clock.
  const [now, setNow] = useState(() => Date.now())
  const bounds = useMemo(() => rangeBounds(range, now), [range, now])

  // Names only. A failed or slow read leaves "All keys" as the one choice
  // and never holds up the chart.
  const keys = useQuery<KeysList>("keys.list", KEY_PARAMS)
  const keyOptions = [
    ALL_KEYS,
    ...(keys.data?.keys ?? []).map((k) => ({ value: k.id, label: k.name })),
  ]

  // An unset key is left out of the params rather than sent as "".
  const forKey = keyId !== "" ? { keyId } : {}
  const series = useQuery<UsageSeries>("usage.series", {
    period: bounds.period,
    after: bounds.after,
    before: bounds.before,
    ...forKey,
  })
  const records = useQuery<UsageRecords>("usage.records", {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    after: bounds.after,
    before: bounds.before,
    ...forKey,
  })

  // The filters live in component state, not the URL, so no key id ends up
  // in the address bar or its history.
  function changeRange(value: string) {
    if (!isRangeId(value)) return
    setRange(value)
    setNow(Date.now())
    setPage(1)
  }
  function changeKey(value: string) {
    setKeyId(value)
    setNow(Date.now())
    setPage(1)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Usage"
        description="Requests by outcome in UTC buckets, and the requests themselves. The filters apply to both."
      />

      <FilterBar
        filters={[
          {
            id: "range",
            label: "Range",
            value: range,
            options: RANGE_OPTIONS,
            onChange: changeRange,
          },
          {
            id: "key",
            label: "Key",
            value: keyId,
            options: keyOptions,
            onChange: changeKey,
          },
        ]}
      />

      <QueryBoundary title="Usage" query={series} skeletonRows={6}>
        {(data) => (
          <SeriesView
            data={data}
            view={view}
            onToggle={() => setView((v) => (v === "table" ? "chart" : "table"))}
          />
        )}
      </QueryBoundary>

      {/* Only once the series says usage exists. While it loads, or when it
          failed, a tenant with no usage would otherwise flash "No requests
          recorded in this range." before the empty state above says why. */}
      {series.data?.recorded === true && (
        <section aria-labelledby="usage-records" className="flex flex-col gap-3">
          <h2 id="usage-records" className="text-base font-medium">
            Requests
          </h2>
          <QueryBoundary title="Usage records" query={records} skeletonRows={5}>
            {(data) => {
              const rows = data.items ?? []
              return (
                <ResourceTable<UsageRecordItem>
                  columns={recordColumns}
                  rows={rows}
                  rowKey={(r) => r.id}
                  // The server's total, never the page length.
                  caption={`${formatCount(data.total)} ${data.total === 1 ? "request" : "requests"}`}
                  emptyMessage={
                    page > 1
                      ? "No requests on this page."
                      : "No requests recorded in this range."
                  }
                  emptyAction={
                    page > 1 ? (
                      <Button variant="outline" onClick={() => setPage(1)}>
                        Back to the first page
                      </Button>
                    ) : undefined
                  }
                  pagination={{ page, pageSize: PAGE_SIZE, total: data.total }}
                  onPageChange={setPage}
                />
              )
            }}
          </QueryBoundary>
        </section>
      )}
    </section>
  )
}

// The plugin's index loads this page with lazy(), which takes a default export.
export default UsagePage
