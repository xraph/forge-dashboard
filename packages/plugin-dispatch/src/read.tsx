import { useState } from "react"
import type { ReactNode } from "react"
import {
  queryStore,
  usePluginClient,
  usePoll,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { QueryState, QueryOptions } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import type { Snapshot } from "./types"

const transientCodes = new Set([
  "INTERNAL",
  "UNAVAILABLE",
  "TRANSPORT",
  "TIMEOUT",
])
export function useDispatchQuery<T>(
  intent: string,
  params?: Record<string, unknown>,
  options?: QueryOptions
): QueryState<T> {
  const client = usePluginClient()
  const query = useQuery<T>(intent, params, options)
  const key = queryStore.keyOf(client.extension, intent, params)
  const [previous, setPrevious] = useState<{
    client: typeof client
    key: string
    data?: T
  }>({ client, key })
  const same = previous.client === client && previous.key === key
  // Ordinary refreshes keep data or the last error. A blank pending entry
  // means the host discarded this context, so the local snapshot must go too.
  const cleared = query.loading && query.data === undefined && !query.error
  const retain =
    !cleared && (!query.error || transientCodes.has(query.error.code))
  const data = retain
    ? (query.data ?? (same ? previous.data : undefined))
    : undefined
  if (!same || previous.data !== data) setPrevious({ client, key, data })
  return { ...query, data }
}

export function useLive(
  query: Pick<QueryState<unknown>, "refetch">,
  intervalMs: number
) {
  usePoll(query.refetch, intervalMs)
}
function Poll({
  query,
  intervalMs,
}: {
  query: Pick<QueryState<unknown>, "refetch">
  intervalMs: number
}) {
  useLive(query, intervalMs)
  return null
}
export function LiveStamp({
  asOf,
  stale,
  retrying,
}: {
  asOf: string
  stale: boolean
  retrying: boolean
}) {
  const parsed = new Date(asOf)
  const label = Number.isNaN(parsed.getTime())
    ? asOf
    : parsed.toLocaleTimeString()
  return (
    <span
      role="status"
      className={
        stale
          ? "text-xs text-warning-foreground"
          : "text-xs text-muted-foreground"
      }
    >
      {stale ? "Stale since " : "As of "}
      <time dateTime={asOf}>{label}</time>
      {stale && retrying ? ", retrying" : ""}
    </span>
  )
}
export function Read<T extends Snapshot>({
  title,
  query,
  intervalMs = null,
  children,
}: {
  title: string
  query: QueryState<T>
  intervalMs?: number | null | ((data: T | undefined) => number | null)
  children: (data: T) => ReactNode
}) {
  const interval =
    typeof intervalMs === "function" ? intervalMs(query.data) : intervalMs
  const polling =
    interval !== null ? <Poll query={query} intervalMs={interval} /> : null
  if (query.data !== undefined) {
    return (
      <div className="flex min-w-0 flex-col gap-3" aria-busy={query.loading}>
        {polling}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LiveStamp
            asOf={query.data.asOf}
            stale={!!query.error}
            retrying={interval !== null}
          />
          <Button
            size="xs"
            variant="ghost"
            onClick={query.refetch}
            disabled={query.loading}
          >
            Refresh
          </Button>
        </div>
        <CommandAlert title="Refresh failed" error={query.error} />
        {children(query.data)}
      </div>
    )
  }
  if (query.error?.code === "NOT_FOUND") {
    return (
      <>
        {polling}
        <ZeroState
          title={title + " not found"}
          body="This resource may have been removed. Refresh to check again."
          action={
            <Button variant="outline" size="sm" onClick={query.refetch}>
              Refresh
            </Button>
          }
        />
      </>
    )
  }
  return (
    <>
      {polling}
      <QueryBoundary title={title} query={query} keepPreviousData>
        {children}
      </QueryBoundary>
    </>
  )
}
