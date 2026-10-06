import type { ReactNode } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CurrentBadge } from "../badges"
import { baselinePath, formatScore, runPath, shortRunId, suitePath } from "../format"
import type { Baseline } from "../types"

/**
 * Baselines, newest first as baselines.list sends them. The name is the
 * column an operator reads; the current one per suite wears the badge.
 */
export function BaselinesTable({
  baselines,
  showSuite,
  caption,
  emptyMessage,
  emptyAction,
  actions,
}: {
  baselines: Baseline[]
  showSuite: boolean
  caption: string
  emptyMessage: string
  emptyAction?: ReactNode
  actions?: (b: Baseline) => ReactNode
}) {
  const columns: Column<Baseline>[] = [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (b) => (
        <span className="flex flex-wrap items-center gap-2">
          <PluginLink to={baselinePath(b.id)}>{b.name}</PluginLink>
          {b.isCurrent && <CurrentBadge />}
        </span>
      ),
    },
    ...(showSuite
      ? [{ id: "suite", header: "Suite", cell: (b: Baseline) => <PluginLink to={suitePath(b.suiteId)}>{b.suiteName}</PluginLink> }]
      : []),
    {
      id: "run",
      header: "From run",
      className: "font-mono text-xs",
      cell: (b) => <PluginLink to={runPath(b.runId)}>{shortRunId(b.runId)}</PluginLink>,
    },
    { id: "passRate", header: "Pass rate", align: "end", className: "tabular-nums", cell: (b) => formatScore(b.passRate) },
    { id: "avgScore", header: "Avg score", align: "end", className: "tabular-nums", cell: (b) => formatScore(b.avgScore) },
    { id: "cases", header: "Cases", align: "end", className: "tabular-nums", cell: (b) => b.caseCount },
    { id: "saved", header: "Saved", cell: (b) => <Timestamp value={b.createdAt} label="save time" /> },
  ]
  return (
    <ResourceTable<Baseline>
      columns={columns}
      rows={baselines}
      rowKey={(b) => b.id}
      caption={caption}
      emptyMessage={emptyMessage}
      emptyAction={emptyAction}
      rowActions={actions}
    />
  )
}
