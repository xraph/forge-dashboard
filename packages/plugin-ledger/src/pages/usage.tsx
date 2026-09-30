import { useId, useMemo, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { OffsetPager } from "../components/offset-pager"
import { dailyTotals, UsageChart, windowStart, type DayTotal } from "../components/usage-chart"
import { formatUTCInstant } from "../lib/datetime"
import { pageCaption, pageParams } from "../lib/paging"
import type { Ack, EntitlementResult, Page, UsageEvent, UsageTotals } from "../types"

const CHART_READ = 200
const number = new Intl.NumberFormat()

const columns: Column<UsageEvent>[] = [
  { id: "time", header: "When (UTC)", cell: (e) => formatUTCInstant(e.timestamp) ?? <NoneCell label="time" /> },
  { id: "tenant", header: "Tenant", className: "font-mono text-xs", cell: (e) => e.tenant_id },
  { id: "feature", header: "Feature", className: "font-mono text-xs", cell: (e) => e.feature_key },
  { id: "quantity", header: "Units", align: "end", className: "font-medium tabular-nums", cell: (e) => number.format(e.quantity) },
  { id: "id", header: "Event", className: "font-mono text-xs", cell: (e) => e.id },
]

function MonthTotal({ tenant, feature }: { tenant: string; feature: string }) {
  const totals = useQuery<UsageTotals>("usage.aggregate", { tenant_id: tenant, feature_keys: [feature], period: "monthly" })
  return (
    <QueryBoundary title="Month total" query={totals} skeletonRows={1}>
      {(t) => (
        <StatGrid
          items={[
            {
              label: `${feature} this month, ${tenant}`,
              value: number.format(t.totals?.[feature] ?? 0),
              // Every ledger store opens the month at midnight UTC, the calendar
              // billing periods are cut on.
              hint: "Since the start of the month, UTC",
            },
          ]}
        />
      )}
    </QueryBoundary>
  )
}

/**
 * These three say why there is nothing to measure, not how much is used: the
 * engine answers them with a zero limit and zero use, and "0 of 0 used" would
 * read as an empty quota rather than as no quota at all.
 */
const UNMEASURED = new Set(["no active subscription", "plan not found", "feature not in plan"])

/**
 * One entitlement answer, read the way the engine words it
 * (`computeEntitlement` in the ledger's root package).
 *
 * The result carries no feature type, so it is read from the shape. A metered
 * or seat answer that is allowed without a reason has used below the limit, so
 * remaining is above zero (or -1 when unlimited); a refused one always carries
 * "quota exceeded". A boolean feature is the one answer with no reason and
 * nothing counted: allowed is limit > 0 and remaining stays 0, so a disabled
 * one arrives refused with an empty reason. An allowed answer that does carry
 * a reason is "over soft limit": use continues.
 */
export function EntitlementAnswerView({ r }: { r: EntitlementResult }) {
  const reason = r.reason ?? ""
  const switchedOff = !r.allowed && reason === ""
  const boolean = r.allowed && reason === "" && r.remaining === 0
  const unmeasured = UNMEASURED.has(reason)
  const refusal = switchedOff ? "this feature is switched off in the tenant's plan" : reason

  let usage: string | undefined
  if (boolean) usage = "Included in the plan. There is nothing to count."
  else if (!switchedOff && !unmeasured) usage = r.limit === -1 ? `${number.format(r.used)} used, no limit` : `${number.format(r.used)} of ${number.format(r.limit)} used`
  const showRemaining = !switchedOff && !unmeasured && !boolean && r.limit !== -1

  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className={r.allowed ? "font-medium" : "font-medium text-destructive"}>{r.allowed ? "Allowed" : `Refused: ${refusal}`}</span>
      {usage && <span className="tabular-nums">{usage}</span>}
      {showRemaining && <span className="tabular-nums">{`${number.format(r.remaining)} remaining`}</span>}
      {r.allowed && reason === "over soft limit" && <span className="text-muted-foreground">At or past the soft limit. Use is not blocked.</span>}
    </div>
  )
}

function EntitlementAnswer({ check }: { check: QueryState<EntitlementResult> }) {
  return (
    <QueryBoundary title="Entitlement" query={check} skeletonRows={1}>
      {(r) => <EntitlementAnswerView r={r} />}
    </QueryBoundary>
  )
}

interface Held {
  source: Page<UsageEvent>
  totals: DayTotal[]
  truncated: boolean
}

/**
 * Usage over a window, the raw event log, and two tools for looking at one
 * tenant: the month total for a feature, and a fresh entitlement answer that
 * bypasses the cache. One filter row scopes all of it.
 */
export function LedgerUsagePage() {
  const helpId = useId()
  const toolsHelpId = useId()
  const toolsHintId = useId()
  const [tenant, setTenant] = useState("")
  const [feature, setFeature] = useState("")
  const [days, setDays] = useState(30)
  // The window's start is fixed when the window is chosen, not on every
  // render: a start that moved each render would be a new query each time.
  // It is also fixed at mount: a page left open past UTC midnight keeps its
  // window until the operator changes it.
  const [anchor, setAnchor] = useState(() => Date.now())
  const [page, setPage] = useState(1)
  const [checking, setChecking] = useState<{ tenant: string; feature: string } | null>(null)
  const invalidate = useCommand<Ack>("entitlements.invalidate")
  const [cleared, setCleared] = useState<string | null>(null)

  const tenantId = tenant.trim()
  const featureKey = feature.trim()
  const startMs = useMemo(() => windowStart(days, anchor), [days, anchor])
  const filters = { tenant_id: tenantId || undefined, feature_key: featureKey || undefined, start: new Date(startMs).toISOString() }
  const chart = useQuery<Page<UsageEvent>>("usage.events", { ...filters, limit: CHART_READ, offset: 0 })
  const log = useQuery<Page<UsageEvent>>("usage.events", { ...filters, ...pageParams(page) })
  const check = useQuery<EntitlementResult>(
    "entitlements.check",
    checking ? { tenant_id: checking.tenant, feature_key: checking.feature } : undefined,
    { enabled: checking !== null },
  )

  // The last chart that settled, bucketed against the window it was read for.
  // A changed filter is a new query with no data yet, and dropping the chart
  // for a skeleton on every keystroke would make the page flash; the old chart
  // stays up, dimmed, until the new read lands or fails.
  const [held, setHeld] = useState<Held | undefined>()
  if (chart.data !== undefined && held?.source !== chart.data) {
    setHeld({ source: chart.data, totals: dailyTotals(chart.data.items ?? [], startMs, days), truncated: chart.data.has_more })
  }

  // One UsageChart element in one place, whether it shows fresh data or the
  // held render, so its table's open state and the chart itself survive a
  // refetch instead of remounting.
  const shownChart =
    chart.loading && held
      ? { totals: held.totals, truncated: held.truncated, refreshing: true }
      : chart.data !== undefined
        ? { totals: dailyTotals(chart.data.items ?? [], startMs, days), truncated: chart.data.has_more, refreshing: false }
        : undefined

  function narrow(set: (v: string) => void) {
    return (value: string) => {
      set(value)
      setPage(1)
      setChecking(null)
      setCleared(null)
      invalidate.reset()
    }
  }

  async function clearCache(event: FormEvent) {
    event.preventDefault()
    if (tenantId === "") return
    setCleared(null)
    const payload: Record<string, unknown> = { tenant_id: tenantId }
    if (featureKey) payload.feature_key = featureKey
    const result = await invalidate.execute(payload)
    if (result !== undefined) setCleared(featureKey ? `${tenantId} (${featureKey})` : tenantId)
  }

  const hint = tenantId === "" ? "Name a tenant above to use these." : featureKey === "" ? "Name a feature key above to check one. Clearing works with a tenant alone." : undefined
  const describedBy = hint ? `${toolsHelpId} ${toolsHintId}` : toolsHelpId

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Usage" description="Metered events as they were ingested, newest first." />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="usage-tenant">Tenant ID</Label>
            <Input id="usage-tenant" className="h-8 w-48 font-mono" autoComplete="off" spellCheck={false} aria-describedby={helpId} value={tenant} onChange={(e) => narrow(setTenant)(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="usage-feature">Feature key</Label>
            <Input id="usage-feature" className="h-8 w-48 font-mono" autoComplete="off" spellCheck={false} aria-describedby={helpId} value={feature} onChange={(e) => narrow(setFeature)(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="usage-window">Window</Label>
            <NativeSelect
              id="usage-window"
              value={String(days)}
              onChange={(e) => {
                setDays(Number(e.target.value))
                setAnchor(Date.now())
                setPage(1)
              }}
            >
              <NativeSelectOption value="7">Last 7 days</NativeSelectOption>
              <NativeSelectOption value="30">Last 30 days</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
        <p id={helpId} className="text-sm text-muted-foreground">
          Tenant and feature match exactly. Leave them blank to read every tenant and feature.
        </p>
      </div>

      {tenantId && featureKey && <MonthTotal tenant={tenantId} feature={featureKey} />}

      {shownChart ? (
        <UsageChart totals={shownChart.totals} truncated={shownChart.truncated} refreshing={shownChart.refreshing} />
      ) : (
        // Loading with nothing to hold yet, or failed: the boundary's own
        // skeleton or error card. Its children never run, because there is
        // no data here to draw.
        <QueryBoundary title="Usage over time" query={chart} skeletonRows={4}>
          {() => null}
        </QueryBoundary>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Events</h2>
        <QueryBoundary title="Usage events" query={log} skeletonRows={5}>
          {(data) => {
            const rows = data.items ?? []
            return (
              <div className="flex flex-col gap-3">
                <ResourceTable<UsageEvent>
                  columns={columns}
                  rows={rows}
                  rowKey={(e) => e.id}
                  caption={pageCaption({ page, shown: rows.length, hasMore: data.has_more, singular: "event", plural: "events" })}
                  emptyMessage={page > 1 ? `Nothing on page ${page}.` : tenantId || featureKey ? "No events match these filters in this window." : "No usage in this window."}
                />
                <OffsetPager page={page} hasMore={data.has_more} onPageChange={setPage} />
              </div>
            )
          }}
        </QueryBoundary>
      </section>

      <section className="flex flex-col gap-3" aria-label="Entitlement tools">
        <h2 className="text-base font-medium">Entitlements</h2>
        <p id={toolsHelpId} className="text-sm text-muted-foreground">
          A check reads the store directly, skipping the cache enforcement uses. Clearing drops cached answers for the tenant, or for one feature when a key is named, so the next enforcement check reads fresh too.
        </p>
        <form onSubmit={(e) => void clearCache(e)} className="flex flex-wrap gap-2">
          <Button
            type="button"
            aria-describedby={describedBy}
            disabled={tenantId === "" || featureKey === ""}
            onClick={() => (checking ? check.refetch() : setChecking({ tenant: tenantId, feature: featureKey }))}
          >
            Check entitlement
          </Button>
          <Button type="submit" variant="outline" aria-describedby={describedBy} disabled={tenantId === "" || invalidate.loading}>
            Clear cached answers
          </Button>
        </form>
        {hint && (
          <p id={toolsHintId} className="text-sm text-muted-foreground">
            {hint}
          </p>
        )}
        <CommandAlert error={invalidate.error} title="Could not clear the cache" />
        {/*
          Both live regions stay mounted, empty, from the first render: a
          region inserted already holding its text is often not announced, one
          that was there first and then filled is.
        */}
        <p role="status" aria-live="polite" className="text-sm">
          {cleared ? `Cached answers for ${cleared} were cleared.` : null}
        </p>
        <div role="status" aria-live="polite" aria-label="Entitlement answer">
          {checking && <EntitlementAnswer check={check} />}
        </div>
      </section>
    </section>
  )
}

export default LedgerUsagePage
