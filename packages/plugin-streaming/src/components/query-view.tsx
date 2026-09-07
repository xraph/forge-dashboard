import type { ReactNode } from "react"
import type { QueryState } from "@forge-go/dashboard-plugin"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"
import { Skeleton } from "@forge-go/dashboard-kit/components/skeleton"

/**
 * Renders the four states every read in this plugin can be in: loading, error,
 * settled with no data, and settled with data.
 *
 * Every page routes its `useQuery` result through here so none of them can
 * invent its own idea of what loading looks like, and - the part that matters -
 * so none of them can render nothing. A page that draws a blank pane while a
 * request is in flight is indistinguishable from a page that is broken, and
 * that ambiguity costs more to debug than the component costs to write.
 *
 * The fourth state, "settled with no error and no data", is not reachable
 * through `useQuery` against a contract that answers the envelope correctly.
 * It is rendered as a visible message anyway rather than `null`, for the same
 * reason: if it ever does happen, it should say so.
 */
export function QueryView<T>({
  title,
  query,
  skeletonRows = 3,
  children,
}: {
  /** Names the thing being loaded. Used in the busy label and the error card. */
  title: string
  query: QueryState<T>
  skeletonRows?: number
  children: (data: T) => ReactNode
}) {
  if (query.loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={`Loading ${title}`}
        className="flex flex-col gap-2"
      >
        {Array.from({ length: skeletonRows }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  if (query.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title} unavailable</CardTitle>
          {/*
            The code travels with the message on purpose. "NOT_FOUND" against a
            streaming read means the intent name is wrong; "TRANSPORT" means the
            request never reached the contract layer. Those want different
            people looking at them, and the message alone does not separate
            them.
          */}
          <CardDescription role="alert">
            {query.error.code}: {query.error.message}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <button
            type="button"
            onClick={query.refetch}
            className="w-fit rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Retry
          </button>
        </CardContent>
      </Card>
    )
  }

  if (query.data === undefined) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {title} returned no data.
      </p>
    )
  }

  return <>{children(query.data)}</>
}

/** Shown in place of a table body when a read succeeds and returns nothing. */
export function EmptyState({ message }: { message: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {message}
    </p>
  )
}

/**
 * A timestamp the contract sends as RFC 3339. Anything unparseable is printed
 * as it arrived rather than as "Invalid Date", which tells you nothing about
 * what the server actually sent.
 *
 * No empty-string branch here, unlike authsome's copy of this function, and
 * the divergence is deliberate rather than drift. Every timestamp streaming
 * reads is a Go `time.Time` in `extensions/streaming/contract/types.go` with
 * no `omitempty`, so it always marshals to a full RFC 3339 string - a zero
 * value arrives as "0001-01-01T00:00:00Z", never as "". Authsome sends `""`
 * for "never happened" (`banExpiresAt` on an unbanned user) and needs the
 * branch. Add one here and it would be a guard against a value this contract
 * cannot produce.
 */
export function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}
