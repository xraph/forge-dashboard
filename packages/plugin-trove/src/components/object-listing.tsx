import { useRef } from "react"
import type { RefObject } from "react"
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription, AlertTitle } from "@forge-go/dashboard-kit/components/alert"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@forge-go/dashboard-kit/components/table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { browserHref, displayName, folderOf } from "../browser-location"
import { listingCaption, useListing } from "../listing"
import type { ListingRow } from "../listing"
import { Bytes } from "./bytes"
import { SettledBoundary } from "./settled-boundary"

/** Past this many rows the table renders a window of them. */
export const VIRTUAL_THRESHOLD = 200
const ROW_HEIGHT = 37
const INITIAL_RECT = { width: 0, height: 600 }

export function ObjectListing({
  store,
  bucket,
  prefix,
  selectedKey,
}: {
  store: string
  bucket: string
  prefix: string
  selectedKey: string
}) {
  const listing = useListing({ store, bucket, prefix })
  // The one scroller. It fills whatever bounds it (the browser's left panel),
  // and the virtualiser reads this element, so a long listing has one
  // scrollbar and crossing the virtualising threshold keeps the scroll place.
  const scroller = useRef<HTMLDivElement>(null)
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
      <SettledBoundary title="Could not list this bucket" query={listing.first} skeletonRows={6}>
        {(first) => (
          <ListingBody listing={listing} routed={first.routed} store={store} bucket={bucket} prefix={prefix} selectedKey={selectedKey} scroller={scroller} />
        )}
      </SettledBoundary>
    </div>
  )
}

function ListingBody({
  listing,
  routed,
  store,
  bucket,
  prefix,
  selectedKey,
  scroller,
}: {
  listing: ReturnType<typeof useListing>
  routed: boolean
  store: string
  bucket: string
  prefix: string
  selectedKey: string
  scroller: RefObject<HTMLDivElement | null>
}) {
  const { rows, nextCursor, loadMore, loadingMore, moreError } = listing
  const folder = folderOf(prefix)
  const virtual = rows.length > VIRTUAL_THRESHOLD
  // The React Compiler skips memoising this component, which is what it should do with this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialRect: INITIAL_RECT,
    // initialRect only counts until the scroller mounts. Then the virtualiser
    // reads the element's own height, and jsdom answers 0, which leaves it
    // with no window and no rows. A height of 0 is never a real viewport here
    // (the scroller fills a panel at least 24rem tall), so keep the starting
    // size in that case.
    observeElementRect: (instance, cb) =>
      observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : INITIAL_RECT)),
  })

  const objects = rows.filter((r) => r.kind === "object").length
  const folders = rows.length - objects
  const more = nextCursor !== null

  const loadMoreControls = (
    <div className="flex flex-col gap-2">
      <CommandAlert error={moreError} title="Could not load more" />
      {more ? (
        <div>
          <Button variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  )

  const routedNote = routed ? (
    <Alert>
      <AlertTitle>Some keys may live on another backend</AlertTitle>
      <AlertDescription>
        This store routes some keys to other backends. This listing reads one backend, so it can miss objects even when there is nothing more to load.
      </AlertDescription>
    </Alert>
  ) : null

  if (rows.length === 0) {
    let empty = <EmptyState title="This bucket is empty" description="Drop files here, or use Upload files, to add the first object." />
    if (more) {
      empty = <EmptyState title="Nothing on this page" description="This page held no keys to show, but the driver has more to list." />
    } else if (prefix !== "") {
      empty = <EmptyState title="Nothing under this prefix" description={`No key in ${bucket} starts with ${prefix}.`} />
    }
    return (
      <div className="flex flex-col gap-3">
        {routedNote}
        {empty}
        {loadMoreControls}
      </div>
    )
  }

  const items = virtual ? virtualizer.getVirtualItems() : null
  const visible: { row: ListingRow; index: number }[] = items
    ? items.map((item) => ({ row: rows[item.index], index: item.index }))
    : rows.map((row, index) => ({ row, index }))
  const padTop = items && items.length > 0 ? items[0].start : 0
  const padBottom = items && items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0

  return (
    <div className="flex flex-col gap-3">
      {routedNote}
      <Table>
        <TableCaption>{listingCaption(objects, folders, more)}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Stored size</TableHead>
            <TableHead>Last modified</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {padTop > 0 ? (
            <tr aria-hidden="true" style={{ height: padTop }} />
          ) : null}
          {visible.map(({ row, index }) =>
            row.kind === "folder" ? (
              <TableRow key={`f:${row.key}`} data-index={index}>
                <TableCell className="font-mono text-xs font-medium">
                  <PluginLink to={browserHref(bucket, { store, prefix: row.key })} className="hover:underline">
                    {displayName(row.key, folder)}
                  </PluginLink>
                </TableCell>
                <TableCell>
                  <NoneCell label="size" />
                </TableCell>
                <TableCell>
                  <NoneCell label="last modified" />
                </TableCell>
              </TableRow>
            ) : (
              <TableRow
                key={`o:${row.key}`}
                data-index={index}
                data-state={row.key === selectedKey ? "selected" : undefined}
                aria-selected={row.key === selectedKey}
              >
                <TableCell className="font-mono text-xs font-medium">
                  <PluginLink to={browserHref(bucket, { store, prefix, key: row.key })} className="hover:underline">
                    <span className="block max-w-sm truncate" title={row.key}>
                      {displayName(row.key, folder)}
                    </span>
                  </PluginLink>
                </TableCell>
                <TableCell>
                  <Bytes value={row.object.storedSize} />
                </TableCell>
                <TableCell>
                  <Timestamp value={row.object.lastModified ?? undefined} label="last modified" />
                </TableCell>
              </TableRow>
            ),
          )}
          {padBottom > 0 ? (
            <tr aria-hidden="true" style={{ height: padBottom }} />
          ) : null}
        </TableBody>
      </Table>
      {loadMoreControls}
    </div>
  )
}
