import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Fragment, useState } from "react"
import type { ComponentType } from "react"
import {
  PluginLink,
  useCommand,
  usePoll,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CircuitBadge } from "../badges"
import { routePath } from "../keys"
import type { CircuitView, CircuitsList } from "../types"

function describeBreakers(c: CircuitsList): string {
  if (!c.enabled) return "Breakers are off."
  return `A target opens after ${c.failureThreshold} consecutive transport failures and is probed again after ${c.resetTimeoutSeconds} s, ${c.halfOpenMax} probes at a time.`
}

export const BastionCircuitsPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<CircuitsList>("circuits.list")
  usePoll(query.refetch)
  const resetCmd = useCommand<{ targetId: string; state: string }>(
    "circuits.reset"
  )
  const [target, setTarget] = useState<CircuitView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function open(c: CircuitView) {
    // Reset at open: an error from an earlier attempt must not greet the operator.
    resetCmd.reset()
    setNotice(null)
    setTarget(c)
  }

  async function confirm() {
    if (!target) return
    const r = await resetCmd.execute({ targetId: target.targetId })
    if (r === undefined) return
    setNotice(`Breaker reset for ${target.url}.`)
    setTarget(null)
  }

  const columns: Column<CircuitView>[] = [
    {
      id: "url",
      header: "Target",
      className: "font-mono text-xs font-medium",
      cell: (c) => c.url,
    },
    {
      id: "routes",
      header: "Routes",
      className: "font-mono text-xs",
      cell: (c) =>
        c.routes.map((r, i) => (
          <Fragment key={`${r.routeId}:${r.targetId}`}>
            {i > 0 && ", "}
            <PluginLink to={routePath(r.routeId)}>{r.path}</PluginLink>
          </Fragment>
        )),
    },
    {
      id: "state",
      header: "State",
      cell: (c) =>
        c.tracked ? (
          <CircuitBadge state={c.state} />
        ) : (
          <Badge variant="secondary">Not tracked</Badge>
        ),
    },
    {
      id: "failures",
      header: "Failures",
      align: "end",
      cell: (c) => c.failureCount,
    },
    {
      id: "lastFailure",
      header: "Last failure",
      cell: (c) => (
        <Timestamp value={c.lastFailure ?? undefined} label="failure" />
      ),
    },
    {
      id: "lastChange",
      header: "Last change",
      cell: (c) => (
        <Timestamp
          value={c.lastStateChange ?? undefined}
          label="state change"
        />
      ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (c) =>
        c.tracked && c.state !== "closed" ? (
          <IconButton variant="outline" onClick={() => open(c)} label="Reset" />
        ) : null,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Circuits" query={query} skeletonRows={5}>
        {(c) => (
          <>
            <PageHeader title="Circuits" description={describeBreakers(c)} />
            {!c.enabled ? (
              <p role="status" className="text-sm text-muted-foreground">
                Circuit breaking is switched off in the gateway config, so every
                target is ungated.
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            ) : null}
            <ResourceTable<CircuitView>
              columns={columns}
              rows={c.circuits}
              rowKey={(x) => x.targetId}
              caption={`${c.total} ${c.total === 1 ? "target" : "targets"}`}
              emptyMessage="No targets. Add a route to give the gateway somewhere to send traffic."
            />
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && !resetCmd.loading && setTarget(null)}
        title={
          target ? `Reset the breaker for ${target.url}?` : "Reset the breaker?"
        }
        description="The breaker closes and the next request goes straight to this upstream. If it is still failing, the breaker opens again."
        confirmLabel="Reset"
        destructive={false}
        pending={resetCmd.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert
          error={resetCmd.error}
          title="Could not reset the breaker"
        />
      </ConfirmDialog>
    </section>
  )
}
