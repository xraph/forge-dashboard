import { useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { NativeSelect } from "@forge-go/dashboard-kit/components/native-select"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Money } from "../components/money"
import {
  count,
  Empty,
  Metrics,
  Notice,
  OutcomeTable,
  rate,
  Refresh,
  Section,
  UsageOff,
} from "../components/read"
import { TenantFilter, tenantParams } from "../components/tenant-filter"
import { sharePercent } from "../money"
import type { Aggregate, Period, UsageSeries, UsageSummary } from "../types"

function Aggregates({
  title,
  rows,
  total,
}: {
  title: string
  rows: Aggregate[]
  total: string
}) {
  if (!rows.length) return null
  return (
    <Section title={title}>
      <ResourceTable
        density="compact"
        rows={rows}
        rowKey={(r) => r.name}
        emptyMessage="No usage"
        columns={[
          { id: "name", header: "Name", cell: (r) => r.name || "Unattributed" },
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
            id: "cost",
            header: "Spend",
            align: "end",
            cell: (r) => <Money value={r.costUsd} />,
          },
          {
            id: "share",
            header: "Share of priced spend",
            cell: (r) => {
              const share = sharePercent(r.costUsd, total)
              return share === null ? (
                "No priced spend"
              ) : (
                <div className="min-w-24 space-y-1 text-xs">
                  <span>{share}%</span>
                  <div aria-hidden="true" className="h-1 rounded bg-muted">
                    <div
                      className="h-1 rounded bg-primary"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              )
            },
          },
          {
            id: "unpriced",
            header: "Unpriced",
            align: "end",
            cell: (r) => count(r.unpriced),
          },
        ]}
      />
    </Section>
  )
}

type Snapshot = { scope: string; summary: UsageSummary; series: UsageSeries }
function UsageData({
  value,
  refresh,
}: {
  value: Snapshot
  refresh: () => void
}) {
  const data = value.summary
  if (!data.usageEnabled) return <UsageOff />
  return (
    <>
      <Metrics
        items={[
          {
            label: "Spend",
            value: <Money value={data.totalCostUsd} />,
            hint: `${count(data.unpricedRequests)} unpriced requests excluded`,
          },
          {
            label: "Requests",
            value: count(data.totalRequests),
            hint: `${count(data.totalTokens)} tokens`,
          },
          { label: "Cache hit rate", value: rate(data.cacheHitRate) },
          {
            label: "Average latency",
            value:
              data.avgLatencyMs === null
                ? "Unavailable"
                : `${count(data.avgLatencyMs)} ms`,
          },
        ]}
      />
      {data.totalRequests === 0 ? (
        <Empty
          title="No requests in this period"
          body="Choose another tenant or period, or send a request through the gateway."
          action={
            <Button size="sm" variant="outline" onClick={refresh}>
              Refresh usage
            </Button>
          }
        />
      ) : (
        <>
          <Section title="Spend and requests over time">
            {value.series.items.length ? (
              <ResourceTable
                density="compact"
                rows={value.series.items}
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
              <Empty
                title="No usage buckets"
                body="The summary has requests but no time buckets were returned. Refresh the series."
                action={<Refresh onClick={refresh} />}
              />
            )}
          </Section>
          {data.byOutcome && (
            <Section title="Request outcomes">
              <OutcomeTable value={data.byOutcome} />
            </Section>
          )}
          <Aggregates
            title="Spend by provider"
            rows={data.byProvider}
            total={data.totalCostUsd ?? "0"}
          />
          <Aggregates
            title="Spend by model"
            rows={data.byModel}
            total={data.totalCostUsd ?? "0"}
          />
        </>
      )}
    </>
  )
}

export default function UsagePage() {
  const [tenantId, setTenantId] = useState<string>(),
    [period, setPeriod] = useState<Period>("month")
  const summary = useQuery<UsageSummary>("usage.summary", {
    ...tenantParams(tenantId),
    period,
  })
  const series = useQuery<UsageSeries>("usage.series", {
    ...tenantParams(tenantId),
    period,
    bucket: period === "day" ? "hour" : "day",
  })
  const [previous, setPrevious] = useState<Snapshot>()
  const scope = `${tenantId ?? "all"}:${period}`
  const ready =
    summary.data &&
    series.data &&
    !summary.loading &&
    !series.loading &&
    !summary.error &&
    !series.error
  if (
    ready &&
    (previous?.summary !== summary.data ||
      previous?.series !== series.data ||
      previous?.scope !== scope)
  )
    setPrevious({ scope, summary: summary.data!, series: series.data! })
  const refresh = () => {
    summary.refetch()
    series.refetch()
  }
  const current = ready
    ? { scope, summary: summary.data!, series: series.data! }
    : previous
  const busy =
    summary.loading ||
    series.loading ||
    (!summary.error && !series.error && !ready)
  const error = summary.error ?? series.error
  return (
    <div className="space-y-3">
      <PageHeader
        title="Usage"
        description="Exact priced spend, unknown costs and request outcomes."
        actions={<Refresh onClick={refresh} />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <TenantFilter value={tenantId} onChange={setTenantId} />
        <NativeSelect
          aria-label="Period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
        >
          <option value="day">Today (UTC)</option>
          <option value="week">Last 7 days</option>
          <option value="month">This month (UTC)</option>
        </NativeSelect>
      </div>
      {error && (
        <QueryBoundary
          title="Usage"
          query={{ error, loading: false, refetch: refresh }}
        >
          {() => null}
        </QueryBoundary>
      )}
      {current ? (
        <div aria-busy={busy} className="space-y-3">
          {!ready && (
            <Notice>
              {error
                ? "Showing the previous selection because the new read failed."
                : "Showing the previous selection while the new read loads."}{" "}
              {current.summary.tenantId ?? "All tenants"} ·{" "}
              {current.summary.period}
            </Notice>
          )}
          <UsageData value={current} refresh={refresh} />
        </div>
      ) : (
        !error && (
          <QueryBoundary
            title="Usage"
            query={{ loading: true, refetch: refresh }}
          >
            {() => null}
          </QueryBoundary>
        )
      )}
    </div>
  )
}
