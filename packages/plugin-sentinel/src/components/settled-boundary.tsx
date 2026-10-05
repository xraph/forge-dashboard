import type { ReactNode } from "react"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"

/**
 * QueryBoundary, except that data already on screen stays on screen.
 *
 * QueryBoundary checks `loading` first, so a refetch swaps its children for a
 * skeleton and unmounts everything below it. Two things refetch a read that is
 * already showing: a command whose `meta.invalidates` names it (the host
 * invalidates before the command resolves), and `usePoll`. Without this, a
 * confirmed delete or a GC run would drop the open dialog, the result line and
 * the page cursor mid-command, and a polled table would flash a skeleton on
 * every tick.
 *
 * The store keeps `data` beside `loading` during a refetch, so render from it
 * when it is there. A failed refetch drops the data from the store, and then
 * the boundary's own error card shows. On first load there is no data, so the
 * boundary's skeleton shows as usual.
 */
export function SettledBoundary<T>({
  title,
  query,
  skeletonRows,
  children,
}: {
  title: string
  query: QueryState<T>
  skeletonRows: number
  children: (data: T) => ReactNode
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>
  return (
    <QueryBoundary title={title} query={query} skeletonRows={skeletonRows}>
      {children}
    </QueryBoundary>
  )
}
