import type { ReactNode } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"
import { Skeleton } from "@forge-go/dashboard-kit/components/skeleton"
import { Button } from "@forge-go/dashboard-kit/components/button"

/**
 * The shape of a read, structurally.
 *
 * Declared here rather than imported from `@forge-go/dashboard-plugin`,
 * because kit does not depend on the plugin package and must not learn a
 * contract shape. The plugin package's `QueryState<T>` satisfies this without
 * either side importing the other.
 */
export interface QueryLike<T> {
  data?: T
  error?: { code: string; message: string }
  loading: boolean
  refetch: () => void
}

export interface QueryBoundaryProps<T> {
  /** Names the thing being loaded. Used in the busy label and the error card. */
  title: string
  query: QueryLike<T>
  skeletonRows?: number
  children: (data: T) => ReactNode
}

/**
 * The four states every read can be in: loading, failed, settled with nothing,
 * settled with data.
 *
 * Every page routes its read through here so none of them can invent its own
 * idea of what loading looks like, and so none of them can render a blank
 * pane. A page drawing nothing while a request is in flight is
 * indistinguishable from a page that is broken.
 *
 * The fourth state, settled with no error and no data, is unreachable through
 * a contract that answers the envelope correctly. It renders a visible message
 * anyway instead of `null`, for the same reason: if it ever happens, it should
 * say so.
 */
export function QueryBoundary<T>({
  title,
  query,
  skeletonRows = 3,
  children,
}: QueryBoundaryProps<T>) {
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
            The code travels with the message on purpose. NOT_FOUND against a
            read means the intent name is wrong; PERMISSION_DENIED means the
            signed-in operator may not read it; TRANSPORT means the request
            never reached the contract layer. Those want different people
            looking at them, and the message alone does not separate them.
          */}
          <CardDescription role="alert">
            {query.error.code}: {query.error.message}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={query.refetch}>
            Retry
          </Button>
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

export interface CommandAlertProps {
  error?: { code: string; message: string }
  /** What was being attempted. "Ban failed". */
  title: string
}

/**
 * How a failed write is shown to whoever triggered it.
 *
 * The message leads and the code follows in smaller type, which is the
 * opposite weighting to the error card above and is deliberate. A failed read
 * is usually somebody's bug. A failed write is usually the server telling the
 * operator something true about what they just tried: "invalid email or
 * password", "user is already banned". That sentence is the useful part, and
 * burying it behind an error code turns a wrong password into a crash.
 *
 * Renders nothing when there is no error, so callers drop it in
 * unconditionally.
 */
export function CommandAlert({ error, title }: CommandAlertProps) {
  if (!error) return null

  return (
    <div
      role="alert"
      className="flex flex-col gap-0.5 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive"
    >
      <span className="font-medium">{title}</span>
      <span>{error.message}</span>
      <span className="font-mono text-xs opacity-70">{error.code}</span>
    </div>
  )
}
