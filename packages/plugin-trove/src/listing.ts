import { useEffect, useRef, useState } from "react"
import { usePluginClient, useQuery } from "@forge-go/dashboard-plugin"
import type { ContractError, QueryState } from "@forge-go/dashboard-plugin"
import { withStore } from "./store"
import type { ObjectRow, ObjectsList } from "./types"

export type ListingRow =
  | { kind: "folder"; key: string }
  | { kind: "object"; key: string; object: ObjectRow }

/** One page's folders and objects as a single list in key order. */
export function mergePage(page: ObjectsList): ListingRow[] {
  const folders: ListingRow[] = (page.prefixes ?? []).map((key) => ({ kind: "folder", key }))
  const objects: ListingRow[] = page.objects.map((object) => ({ kind: "object", key: object.key, object }))
  return [...folders, ...objects].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.kind === "folder" ? -1 : 1))
}

/** What the caption says. A count of what is shown, never a total. */
export function listingCaption(objects: number, folders: number, more: boolean): string {
  if (more) return `${objects + folders} shown, more under this prefix`
  const o = `${objects} ${objects === 1 ? "object" : "objects"}`
  if (folders === 0) return o
  return `${o}, ${folders} ${folders === 1 ? "folder" : "folders"}`
}

function listParams(store: string, bucket: string, prefix: string, cursor?: string): Record<string, unknown> {
  return withStore(store, {
    bucket,
    ...(prefix !== "" ? { prefix } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  })
}

export interface Listing {
  first: QueryState<ObjectsList>
  rows: ListingRow[]
  nextCursor: string | null
  loadMore: () => void
  loadingMore: boolean
  moreError?: ContractError
}

/**
 * One prefix's listing, page by page.
 *
 * The first page is a useQuery, so the `invalidates` on an upload, copy or
 * delete refresh it. Later pages come through the client and are kept here.
 * When the first page changes under them, the pages after it are read again
 * from its new cursor, as many as were loaded, so the operator keeps their
 * place and never sees a row that is gone. The caller keys this by store,
 * bucket and prefix, so a new prefix starts from nothing.
 */
export function useListing({ store, bucket, prefix }: { store: string; bucket: string; prefix: string }): Listing {
  const client = usePluginClient()
  const first = useQuery<ObjectsList>("objects.list", listParams(store, bucket, prefix))
  const [more, setMore] = useState<ObjectsList[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<ContractError | undefined>()
  const loadedCount = useRef(0)
  const seenFirst = useRef<ObjectsList | undefined>(undefined)

  useEffect(() => {
    loadedCount.current = more.length
  }, [more])

  useEffect(() => {
    const data = first.data
    if (data === undefined || data === seenFirst.current) return
    const previous = seenFirst.current
    seenFirst.current = data
    const count = loadedCount.current
    if (previous === undefined || count === 0) return
    let cancelled = false
    void (async () => {
      const pages: ObjectsList[] = []
      let cursor = data.nextCursor
      try {
        for (let i = 0; i < count && cursor !== null; i++) {
          const next = await client.query<ObjectsList>("objects.list", listParams(store, bucket, prefix, cursor))
          pages.push(next)
          cursor = next.nextCursor
        }
        if (!cancelled) {
          setMore(pages)
          setMoreError(undefined)
        }
      } catch (error) {
        if (!cancelled) {
          setMore(pages)
          setMoreError(error as ContractError)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [first.data, client, store, bucket, prefix])

  const last = more.length > 0 ? more[more.length - 1] : first.data
  const nextCursor = last?.nextCursor ?? null
  const rows = first.data ? [first.data, ...more].flatMap(mergePage) : []

  function loadMore() {
    if (nextCursor === null || loadingMore) return
    setLoadingMore(true)
    setMoreError(undefined)
    client
      .query<ObjectsList>("objects.list", listParams(store, bucket, prefix, nextCursor))
      .then((next) => setMore((pages) => [...pages, next]))
      .catch((error: ContractError) => setMoreError(error))
      .finally(() => setLoadingMore(false))
  }

  return { first, rows, nextCursor, loadMore, loadingMore, moreError }
}
