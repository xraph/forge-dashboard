import { useState } from "react"
import type { QueryState } from "@forge-go/dashboard-plugin"

/**
 * A read that keeps what it last showed when a refresh fails.
 *
 * The store drops a key's data when a refetch fails. For a page that polls a
 * running run, or one whose read a command invalidates, that turns one failed
 * request into an error card in place of the whole page: the poll stops
 * (nothing is "running" any more), open dialogs unmount mid-command, and the
 * operator loses what they were watching. This keeps the last data beside the
 * error instead, and says it is stale, so the page can show a notice and keep
 * polling until a request succeeds.
 *
 * Only for a read whose params never change in the component's life (a page
 * body keyed on its id): kept data is never wrong for the key, because there
 * is only one key.
 */
export function useSettled<T>(
  query: QueryState<T>
): QueryState<T> & { stale: boolean } {
  const [kept, setKept] = useState<T | undefined>(query.data)
  // Storing the newest data during render is React's own pattern for
  // remembering a previous value; it settles in the same render pass.
  if (query.data !== undefined && query.data !== kept) setKept(query.data)
  const stale =
    query.data === undefined && query.error !== undefined && kept !== undefined
  return { ...query, data: query.data ?? (stale ? kept : undefined), stale }
}
