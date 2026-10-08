import { useState } from "react"
import {
  queryStore,
  usePluginClient,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { QueryState } from "@forge-go/dashboard-plugin"

interface Held<T> {
  filters: string
  page: number
  /** The store key the rows were read under. */
  key: string
  data: T
}

/**
 * A paged list's read, and what its table should show: the page you are
 * looking at stays on screen while the next one loads.
 *
 * Pair `shown` with `<QueryBoundary keepPreviousData>`. The boundary on its
 * own keeps the rows through a refetch of the SAME page, after a command
 * invalidates the list. But each page is its own query, so a page nobody has
 * read yet starts with no data and there is nothing for the boundary to keep:
 * the skeleton replaces the table, the pager goes with it, and the Next you
 * just pressed loses focus. This hands the boundary the last page that
 * settled until the new one answers.
 *
 * It holds only for a move to another page of one result set, and only while
 * the store still has the rows it holds:
 *
 * - `filters` is whatever picks the rows apart from the page (a reason, a
 *   key, a range). When it changes the list is a new one and gets the
 *   skeleton, so old rows never sit under a new filter.
 * - `page` is the page asked for. Nothing is held for the page the rows came
 *   from, so when the store blanks the page on screen the skeleton shows.
 * - The held rows must still be in the store under the key they were read
 *   with. A switch of app or environment clears the store, which drops that
 *   record, so the hold ends there even while the next page is still in
 *   flight. An invalidation drops it too, since nobody is watching the old
 *   page. Either way the reader gets the skeleton, never rows the store has
 *   let go of.
 *
 * A page that fails shows its error, as it would without this. `read` is the
 * page's own answer, for logic that must not see the held rows.
 *
 * Lists only. Nothing that holds a raw key comes through here.
 */
export function useHeldPage<T>(
  intent: string,
  params: Record<string, unknown>,
  filters: string,
  page: number
): { shown: QueryState<T>; read: QueryState<T> } {
  const client = usePluginClient()
  const read = useQuery<T>(intent, params)
  const key = queryStore.keyOf(client.extension, intent, params)
  const [held, setHeld] = useState<Held<T>>()

  // Adjusted during render, React's supported way to keep state in step
  // with an input. It settles in one pass: the next render finds them equal.
  if (
    read.data !== undefined &&
    (held === undefined ||
      held.data !== read.data ||
      held.filters !== filters ||
      held.page !== page ||
      held.key !== key)
  ) {
    setHeld({ filters, page, key, data: read.data })
  }

  // Read at render. A clear or an invalidation that drops the held record
  // also reissues this page's own key, which renders this again.
  if (
    read.data === undefined &&
    read.loading &&
    held !== undefined &&
    held.filters === filters &&
    held.page !== page &&
    queryStore.snapshot<T>(held.key).data === held.data
  ) {
    return { shown: { ...read, data: held.data }, read }
  }
  return { shown: read, read }
}
