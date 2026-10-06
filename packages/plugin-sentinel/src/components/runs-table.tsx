import type { ReactNode } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { RunStateBadge } from "../badges"
import { formatCost, formatScore, runPath, suitePath } from "../format"
import type { Run } from "../types"
import { ProgressMeter } from "./progress-meter"

function columns(showSuite: boolean): Column<Run>[] {
  const all: (Column<Run> | null)[] = [
    {
      id: "run",
      header: "Run",
      className: "font-mono text-xs font-medium",
      cell: (r) => <PluginLink to={runPath(r.id)}>{r.id}</PluginLink>,
    },
    showSuite
      ? {
          id: "suite",
          header: "Suite",
          cell: (r) => <PluginLink to={suitePath(r.suiteId)}>{r.suiteName || r.suiteId}</PluginLink>,
        }
      : null,
    { id: "state", header: "State", cell: (r) => <RunStateBadge state={r.state} /> },
    {
      id: "progress",
      header: "Cases scored",
      cell: (r) => (
        <span className="flex min-w-28 flex-col gap-1">
          <span className="tabular-nums">{`${r.completedCases} of ${r.totalCases}`}</span>
          {r.state === "running" && <ProgressMeter done={r.completedCases} total={r.totalCases} label="Cases scored" />}
        </span>
      ),
    },
    {
      id: "passed",
      header: "Passed",
      align: "end",
      className: "tabular-nums",
      cell: (r) => r.passed,
    },
    {
      id: "passRate",
      header: "Pass rate",
      align: "end",
      className: "tabular-nums",
      cell: (r) => formatScore(r.passRate),
    },
    {
      id: "errored",
      header: "Errored",
      align: "end",
      className: "tabular-nums",
      cell: (r) => r.errored,
    },
    {
      id: "cost",
      header: "Cost reported",
      align: "end",
      className: "tabular-nums",
      cell: (r) => formatCost(r.totalCost),
    },
    { id: "started", header: "Started", cell: (r) => <Timestamp value={r.createdAt} label="start time" /> },
  ]
  return all.filter((c): c is Column<Run> => c !== null)
}

/**
 * Runs, newest first, for the runs page, a suite's Runs tab and the overview.
 * A running run shows a meter beside its count; the pass rate of a running run
 * is over the cases scored so far, which the count beside it makes plain.
 */
export function RunsTable({
  runs,
  showSuite = true,
  caption,
  emptyMessage,
  emptyAction,
}: {
  runs: Run[]
  showSuite?: boolean
  caption: string
  emptyMessage: string
  emptyAction?: ReactNode
}) {
  return (
    <ResourceTable<Run>
      columns={columns(showSuite)}
      rows={runs}
      rowKey={(r) => r.id}
      caption={caption}
      emptyMessage={emptyMessage}
      emptyAction={emptyAction}
    />
  )
}
