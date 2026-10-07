import { useState } from "react"
import type { QueryState } from "@forge-go/dashboard-plugin"

/**
 * A paged list's read that keeps the page you are looking at on screen while
 * the next one loads.
 *
 * Pair it with `<QueryBoundary keepPreviousData>`. The boundary on its own
 * keeps the rows through a refetch of the SAME page, after a command
 * invalidates the list. But each page is its own query, so a page nobody has
 * read yet starts with no data and there is nothing for the boundary to keep:
 * the skeleton replaces the table, the pager goes with it, and the Next you
 * just pressed loses focus. This hands the boundary the last page that
 * settled until the new one answers.
 *
 * Only for a move to another page of one result set. `filters` is whatever
 * picks the rows apart from the page (a reason, a key, a range); when it
 * changes, the list is a new one and gets the skeleton, so old rows never
 * sit under a new filter. `page` is the page being asked for, and nothing is
 * held for the page the rows came from: when the store blanks the page on
 * screen (a switch of app or environment), the skeleton shows, and the
 * previous app's rows never appear under the new one. A page that fails
 * shows its error, as it would without this.
 *
 * Lists only. Nothing that holds a raw key comes through here.
 */
export function useHeldPage<T>(
  query: QueryState<T>,
  filters: string,
  page: number,
): QueryState<T> {
  const [held, setHeld] = useState<{ filters: string; page: number; data: T }>()

  // Adjusted during render, React's supported way to keep state in step
  // with an input. It settles in one pass: the next render finds them equal.
  if (
    query.data !== undefined &&
    (held === undefined ||
      held.data !== query.data ||
      held.filters !== filters ||
      held.page !== page)
  ) {
    setHeld({ filters, page, data: query.data })
  }

  if (
    query.data === undefined &&
    query.loading &&
    held !== undefined &&
    held.filters === filters &&
    held.page !== page
  ) {
    return { ...query, data: held.data }
  }
  return query
}
