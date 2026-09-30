import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink } from "@forge-go/dashboard-plugin"
import type { EventSummary } from "../types"
import { ErasedBadge, OutcomeBadge, SeverityBadge } from "../badges"
import { formatSeq } from "../format"

/**
 * The events table's columns. There is deliberately no integrity column: a
 * column whose every cell says the same word is redundant, and integrity is a
 * property of the chain, not of a row. The Chain page states it once.
 *
 * `showUser` is off on a page that is already about one user, where the column
 * would repeat that user on every row.
 */
export function eventColumns({ showUser }: { showUser: boolean }): Column<EventSummary>[] {
  const cols: Column<EventSummary>[] = [
    { id: "time", header: "Time", cell: (e) => <Timestamp value={e.timestamp} label="time" /> },
    {
      id: "action",
      header: "Action",
      cell: (e) => (
        <PluginLink to={`/events/${encodeURIComponent(e.id)}`} className="font-medium">
          {e.action}
        </PluginLink>
      ),
    },
    {
      id: "resource",
      header: "Resource",
      cell: (e) => (
        <span>
          {e.resource}
          {e.resourceId ? <span className="ml-1 font-mono text-xs text-muted-foreground">{e.resourceId}</span> : null}
        </span>
      ),
    },
    { id: "category", header: "Category", cell: (e) => e.category },
    { id: "outcome", header: "Outcome", cell: (e) => <OutcomeBadge outcome={e.outcome} /> },
    { id: "severity", header: "Severity", cell: (e) => <SeverityBadge severity={e.severity} /> },
  ]
  if (showUser) {
    cols.push({
      id: "user",
      header: "User",
      cell: (e) =>
        e.userId ? (
          <PluginLink to={`/users/${encodeURIComponent(e.userId)}`} className="font-mono text-xs">
            {e.userId}
          </PluginLink>
        ) : (
          <NoneCell label="user" />
        ),
    })
  }
  cols.push(
    { id: "seq", header: "Sequence", align: "end", cell: (e) => <span className="font-mono text-xs">{formatSeq(e.sequence)}</span> },
    { id: "erased", header: "", cell: (e) => (e.erased ? <ErasedBadge /> : null) },
  )
  return cols
}
