import type { ReactNode } from "react"
import type { ContractError, QueryState } from "@forge-go/dashboard-plugin"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"
import { Skeleton } from "@forge-go/dashboard-kit/components/skeleton"

/**
 * Renders the three states every read in this plugin can be in.
 *
 * This is a deliberate copy of `packages/plugin-streaming`'s component of the
 * same name rather than a shared module. Two plugins is not yet evidence of a
 * shared component: the two would have to agree on kit imports, on error
 * copy, and on the skeleton shape forever after, and neither package depends
 * on the other today. The trigger for hoisting it into
 * `@forge-go/dashboard-plugin` is a third consumer, or the first time these
 * two need the *same* change. `CommandAlert` below has no streaming
 * counterpart at all, because streaming sends no commands.
 *
 * Every page routes its `useQuery` result through here so none of them can
 * invent its own idea of what loading looks like, and - the part that matters -
 * so none of them can render nothing. A page that draws a blank pane while a
 * request is in flight is indistinguishable from a page that is broken.
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
            The code travels with the message on purpose. "NOT_FOUND" against
            an auth read means the intent name is wrong; "PERMISSION_DENIED"
            means the signed-in operator may not read it; "TRANSPORT" means the
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

/**
 * How a failed command is shown to the person who triggered it.
 *
 * The message leads and the code follows it in smaller type, which is the
 * opposite weighting to {@link QueryView}'s error card and is deliberate. A
 * failed read is usually somebody's bug; a failed write is usually the
 * server telling the operator something true about what they just tried
 * ("invalid email or password", "user is already banned"). The sentence the
 * server wrote is the useful part, and burying it behind an error code turns
 * a wrong password into something that reads like a crash.
 *
 * Renders nothing when there is no error, so callers can drop it in
 * unconditionally.
 */
export function CommandAlert({
  error,
  title,
}: {
  error?: ContractError
  /** What was being attempted, e.g. "Sign in failed". */
  title: string
}) {
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
 * what the server actually sent. Empty strings - authsome sends those for
 * "never happened", e.g. `banExpiresAt` on a user who is not banned - print
 * as an en dash instead of as the epoch.
 */
export function formatTimestamp(value: string): string {
  if (!value) return "–"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}
