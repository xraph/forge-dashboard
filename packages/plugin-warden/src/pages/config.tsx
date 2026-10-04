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

/**
 * A run that purged nothing succeeded and changed nothing. Saying "done"
 * would be ambiguous between that and a run that removed rows, and both are
 * things an operator acts on differently.
 */
function purgeSummary(r: MaintenanceResult): string {
  if (r.assignmentsPurged === 0 && r.checkLogsPurged === 0) {
    return "Maintenance ran. Nothing needed purging."
  }
  const parts: string[] = []
  if (r.assignmentsPurged > 0) {
    parts.push(`${r.assignmentsPurged} expired assignments`)
  }
  if (r.checkLogsPurged > 0) {
    parts.push(`${r.checkLogsPurged} check log entries`)
  }
  return `Maintenance ran. Purged ${parts.join(" and ")}.`
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
            <Button
              variant="outline"
              onClick={() => {
                // Same reasoning as the run-maintenance button above: reset
                // at open, so a result from a previous clear is not read as
                // belonging to this one.
                clearCache.reset()
                setClearResult(null)
                setConfirmingClear(true)
              }}
            >
              Clear cache
            </Button>
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
                  value:
                    c.checkLogRetentionHours > 0
                      ? `${c.checkLogRetentionHours} hours`
                      : "Kept forever",
                },
                {
                  term: "Maintenance interval",
                  value:
                    c.maintenanceIntervalMinutes > 0
                      ? `${c.maintenanceIntervalMinutes} minutes`
                      : "Off",
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
        description="Purges assignments that have already expired, and check log entries older than the retention window. This runs across every tenant."
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
