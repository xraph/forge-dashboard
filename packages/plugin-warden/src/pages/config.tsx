import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Alert } from "@forge-go/dashboard-kit/components/alert"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"

export interface ConfigDetail {
  maxGraphDepth: number
  maxGraphVisited: number
  maxGraphFanout: number
  maxBatchChecks: number
  cacheTtlSeconds: number
  cacheMaxSize: number
  rbacEnabled: boolean
  abacEnabled: boolean
  rebacEnabled: boolean
  checkLogEnabled: boolean
  requireTenant: boolean
  evaluateAllModels: boolean
  checkLogQueueSize: number
  /**
   * The retention and interval in whole seconds, rounded up, so a positive
   * value never reads 0. 0 means off: warden sends a switched-off retention
   * or interval as 0 in all four fields, never as a negative number. Absent
   * from a server older than these fields; the page then falls back to the
   * hours and minutes below, which are rounded down (a retention under an
   * hour reads 0 there).
   */
  checkLogRetentionSeconds?: number
  maintenanceIntervalSeconds?: number
  checkLogRetentionHours: number
  maintenanceIntervalMinutes: number
  /**
   * The name of every plugin in the engine's registry, sorted. It can
   * include plugins warden registers on its own, such as its cache
   * invalidators and the audit log sink. Absent from a server older than
   * this field, and then the page says nothing about plugins rather than
   * claiming there are none.
   */
  plugins?: string[]
}

interface MaintenanceResult {
  assignmentsPurged: number
  checkLogsPurged: number
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`
}

/** Whole seconds, in the largest unit that divides them evenly. */
function formatSeconds(seconds: number): string {
  if (seconds % 86400 === 0) return plural(seconds / 86400, "day")
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour")
  if (seconds % 60 === 0) return plural(seconds / 60, "minute")
  return plural(seconds, "second")
}

/**
 * The check log retention. 0 seconds means purging is off: maintenance
 * deletes no entries by age (an erasure can still remove some, so the page
 * does not promise they are kept forever). A server older than the seconds
 * field sends whole hours rounded down, where 0 is either off or a
 * retention under an hour, so the page says both.
 */
function retentionText(c: ConfigDetail): string {
  if (c.checkLogRetentionSeconds !== undefined) {
    return c.checkLogRetentionSeconds > 0
      ? formatSeconds(c.checkLogRetentionSeconds)
      : "Off, no entries are purged by age"
  }
  return c.checkLogRetentionHours > 0
    ? `${plural(c.checkLogRetentionHours, "hour")}, rounded down`
    : "Under an hour, or off"
}

/** The maintenance interval, read the same way as the retention. */
function intervalText(c: ConfigDetail): string {
  if (c.maintenanceIntervalSeconds !== undefined) {
    return c.maintenanceIntervalSeconds > 0 ? formatSeconds(c.maintenanceIntervalSeconds) : "Off"
  }
  return c.maintenanceIntervalMinutes > 0
    ? `${plural(c.maintenanceIntervalMinutes, "minute")}, rounded down`
    : "Under a minute, or off"
}

/**
 * A run that purged nothing succeeded and changed nothing. Saying "done"
 * would be ambiguous between that and a run that removed rows, and both are
 * things an operator acts on differently. maintenance.run covers the
 * caller's tenant only (RunTenantMaintenance), so both counts are this
 * tenant's and the sentence says so.
 */
function purgeSummary(r: MaintenanceResult): string {
  if (r.assignmentsPurged === 0 && r.checkLogsPurged === 0) {
    return "Maintenance ran for this tenant. Nothing needed purging."
  }
  const parts: string[] = []
  if (r.assignmentsPurged > 0) {
    parts.push(`${r.assignmentsPurged} expired assignments`)
  }
  if (r.checkLogsPurged > 0) {
    parts.push(`${r.checkLogsPurged} check log entries`)
  }
  return `Maintenance ran for this tenant. Purged ${parts.join(" and ")}.`
}

/**
 * The clear-cache command answers with the scope it actually cleared, and
 * this page only ever sends the tenant-wide flush, but the sentence still
 * names what happened rather than saying "done": that field exists on the
 * wire specifically so an operator reads what was cleared, not just that
 * something was.
 */
function clearSummary(r: { scope: string }): string {
  if (r.scope === "subject") {
    return "Cleared the decision cache for one subject."
  }
  return "Cleared the decision cache for this tenant."
}

/**
 * The plugins section. Templ hid its card when the list was empty; here an
 * empty list says so, because a missing section reads the same as one that
 * failed to load. Names are not guaranteed unique (the registry does not
 * check), so the key carries the position.
 */
function PluginList({ names }: { names: string[] }) {
  return (
    <section aria-labelledby="warden-config-plugins" className="flex flex-col gap-2">
      <h2 id="warden-config-plugins" className="text-sm font-medium">
        Plugins
      </h2>
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">No authorization plugins are registered.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            The plugins in the engine's registry, including any warden registers on its own.
          </p>
          <ul className="flex flex-wrap gap-2">
            {names.map((name, i) => (
              <li key={`${i}:${name}`}>
                <Badge variant="outline" className="font-mono">
                  {name}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function ModelBadge({ label, on }: { label: string; on: boolean }) {
  // Most engines run with all three models on, so enabled is the majority
  // state and takes outline. A disabled model is the thing somebody scanning
  // this page is looking for.
  return (
    <Badge variant={on ? "outline" : "destructive"}>
      {label}
      {on ? "" : " off"}
    </Badge>
  )
}

export function WardenConfigPage() {
  const config = useQuery<ConfigDetail>("config.detail")
  const runMaintenance = useCommand<MaintenanceResult>("maintenance.run")
  const clearCache = useCommand<{ scope: string }>("maintenance.cacheInvalidate")

  const [confirmingRun, setConfirmingRun] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [runResult, setRunResult] = useState<MaintenanceResult | null>(null)
  const [clearResult, setClearResult] = useState<{ scope: string } | null>(null)

  async function doRun() {
    const result = await runMaintenance.execute({})
    // execute resolves undefined only when the client throws, so this is the
    // success check. A failure must leave the dialog open with its error.
    if (result === undefined) return
    setRunResult(result)
    setConfirmingRun(false)
  }

  async function doClear() {
    // No subject fields at all. The contract rejects a half-specified
    // subject, so an empty string in either would be a BAD_REQUEST rather
    // than the tenant-wide flush this button means.
    const result = await clearCache.execute({})
    if (result === undefined) return
    setClearResult(result)
    setConfirmingClear(false)
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Config"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                // Reset at open, not at close: the operator is about to read
                // whatever this dialog shows, and a failure left over from a
                // previous attempt must not be attributed to this one.
                runMaintenance.reset()
                setRunResult(null)
                setConfirmingRun(true)
              }}
            >
              Run maintenance
            </Button>
            <IconButton variant="outline" onClick={() => {
                // Same reasoning as the run-maintenance button above: reset
                // at open, so a result from a previous clear is not read as
                // belonging to this one.
                clearCache.reset()
                setClearResult(null)
                setConfirmingClear(true)
              }} label="Clear cache" />
          </div>
        }
      />

      {runResult && <Alert>{purgeSummary(runResult)}</Alert>}
      {clearResult && <Alert>{clearSummary(clearResult)}</Alert>}

      <QueryBoundary title="Config" query={config} skeletonRows={4}>
        {(c) => (
          <div className="flex flex-col gap-6">
            {!c.checkLogEnabled && (
              <Alert variant="destructive">
                Check logging is disabled, so nothing is being recorded. The check
                log will stay empty whatever traffic this engine serves.
              </Alert>
            )}

            <p className="text-sm text-muted-foreground">
              Warden reads its configuration from Forge config, so this page is
              read-only. Change these values where the engine is configured and
              restart it.
            </p>

            <div className="flex gap-2">
              <ModelBadge label="RBAC" on={c.rbacEnabled} />
              <ModelBadge label="ABAC" on={c.abacEnabled} />
              <ModelBadge label="ReBAC" on={c.rebacEnabled} />
            </div>

            <DescriptionList
              items={[
                { term: "Graph depth limit", value: String(c.maxGraphDepth) },
                { term: "Graph visit budget", value: String(c.maxGraphVisited) },
                { term: "Graph fanout limit", value: String(c.maxGraphFanout) },
                { term: "Batch check limit", value: String(c.maxBatchChecks) },
                {
                  term: "Decision cache",
                  value:
                    c.cacheTtlSeconds > 0
                      ? `${c.cacheTtlSeconds}s, up to ${c.cacheMaxSize} entries`
                      : "Off",
                },
                { term: "Tenant required", value: c.requireTenant ? "Yes" : "No" },
                {
                  term: "Evaluate all models",
                  value: c.evaluateAllModels ? "Yes" : "No",
                },
                {
                  term: "Check log queue",
                  value: `${c.checkLogQueueSize} entries`,
                },
                {
                  term: "Check log retention",
                  value: retentionText(c),
                },
                {
                  term: "Maintenance interval",
                  value: intervalText(c),
                },
              ]}
            />

            {c.plugins && <PluginList names={c.plugins} />}
          </div>
        )}
      </QueryBoundary>

      {/*
        The errors live inside their dialogs. Base UI marks everything outside
        an open dialog inert and aria-hidden, so an alert on the page body is
        unreachable for as long as the dialog that can fail is open.
      */}
      <ConfirmDialog
        open={confirmingRun}
        onOpenChange={(open) => !open && setConfirmingRun(false)}
        title="Run maintenance now?"
        description="Purges this tenant's assignments that have already expired and, when a check log retention is in effect, this tenant's check log entries older than it. Other tenants are not touched."
        confirmLabel="Run"
        pending={runMaintenance.loading}
        onConfirm={() => void doRun()}
      >
        <CommandAlert
          error={runMaintenance.error}
          title="Could not run maintenance"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingClear}
        onOpenChange={(open) => !open && setConfirmingClear(false)}
        title="Clear this tenant's decision cache?"
        description="The next check for every subject in this tenant is evaluated from the store rather than served from cache. Nothing stored changes."
        confirmLabel="Clear"
        pending={clearCache.loading}
        onConfirm={() => void doClear()}
      >
        <CommandAlert error={clearCache.error} title="Could not clear the cache" />
      </ConfirmDialog>
    </section>
  )
}
