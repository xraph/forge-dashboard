import type { ReactNode } from "react"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { explainError } from "../errors"
import type { ExplainedError } from "../errors"

export interface TetherBoundaryProps<T> {
  title: string
  query: QueryState<T>
  skeletonRows?: number
  /** Keeps the data on screen while a poll refetches. */
  keepPreviousData?: boolean
  children: (data: T) => ReactNode
}

/**
 * The kit's QueryBoundary with Tether's refusals explained: a signed-out
 * operator is told how to sign in, and a stopped broker is named.
 */
export function TetherBoundary<T>({ query, ...rest }: TetherBoundaryProps<T>) {
  return (
    <QueryBoundary<T>
      {...rest}
      query={{ ...query, error: explainError(query.error) }}
    />
  )
}

/** The kit's CommandAlert with the same explanations. */
export function TetherCommandAlert({
  error,
  title,
}: {
  error?: ExplainedError
  title: string
}) {
  return <CommandAlert error={explainError(error)} title={title} />
}
