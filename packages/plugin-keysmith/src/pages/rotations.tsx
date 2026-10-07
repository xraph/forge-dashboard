import { useState } from "react"
import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { RotationReasonBadge } from "../badges"
import { KeyCell, WindowCell } from "../components/rotation-cells"
import { formatDuration, ROTATION_REASONS } from "../format"
import { useHeldPage } from "../held-page"
import { useKeyIdParam, useKeyName, useSetKeyIdParam } from "../key-filter"
import type { RotationItem, RotationsList } from "../types"

const PAGE_SIZE = 25

const ALL = { value: "", label: "All" }

/**
 * When the rotation happened, with who rotated on a muted line beneath. The
 * actor shares this cell so the table fits without scrolling sideways.
 */
function WhenCell({ item }: { item: RotationItem }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Timestamp value={item.rotatedAt} label="rotation time" />
      <span className="text-xs text-muted-foreground">
        by{" "}
        {item.rotatedBy ? (
          <span className="font-mono">{item.rotatedBy}</span>
        ) : (
          <NoneCell label="actor recorded" />
        )}
      </span>
    </div>
  )
}

const columns: Column<RotationItem>[] = [
  {
    id: "when",
    header: "When",
    cell: (r) => <WhenCell item={r} />,
  },
  {
    id: "key",
    header: "Key",
    className: "font-medium",
    cell: (r) => <KeyCell item={r} />,
  },
  {
    id: "reason",
    header: "Reason",
    cell: (r) => <RotationReasonBadge reason={r.reason} />,
  },
  {
    id: "grace",
    header: "Grace",
    // 0 is a real zero-grace rotation: the old key stopped at once.
    cell: (r) =>
      r.graceSeconds === 0 ? "None" : formatDuration(r.graceSeconds),
  },
  {
    id: "window",
    header: "Window",
    cell: (r) => <WindowCell item={r} />,
  },
]

/**
 * What the caption says. rotations.list has no total, so past the first page
 * the caption names the rows shown and whether more follow, and nothing it
 * does not know. A later page that came back empty has none: the empty
 * message already says so.
 */
function caption(
  offset: number,
  shown: number,
  hasMore: boolean,
): string | undefined {
  if (offset === 0 && !hasMore) {
    return `${shown} ${shown === 1 ? "rotation" : "rotations"}`
  }
  if (shown === 0) return undefined
  const more = hasMore ? ", more on the next page" : ""
  return `Rotations ${offset + 1} to ${offset + shown}${more}`
}

/**
 * Previous and Next for an offset list that answers hasMore instead of a
 * total, so it cannot say "page 2 of 4". Nothing at all on a single page.
 */
function Pager({
  offset,
  hasMore,
  onOffsetChange,
}: {
  offset: number
  hasMore: boolean
  onOffsetChange: (offset: number) => void
}) {
  if (offset === 0 && !hasMore) return null
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-end gap-2 text-sm text-muted-foreground"
    >
      <Button
        variant="outline"
        size="sm"
        aria-label="Previous page"
        disabled={offset === 0}
        onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label="Next page"
        disabled={!hasMore}
        onClick={() => onOffsetChange(offset + PAGE_SIZE)}
      >
        Next
      </Button>
    </nav>
  )
}

/**
 * The key a key's page sent you here with, by name, and the way to stop
 * filtering by it. The id stands in, in mono, when keys.detail cannot name
 * the key: still loading, refused, or the key is gone.
 */
function KeyFilterChip({ keyId, onClear }: { keyId: string; onClear: () => void }) {
  const name = useKeyName(keyId, true)
  return (
    <div role="group" aria-label="Key filter" className="flex flex-wrap gap-1">
      <Badge variant="outline" className="gap-1 pr-0.5 text-xs">
        Key{" "}
        {name === undefined ? (
          <span className="font-mono">{keyId}</span>
        ) : (
          <span>{name}</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-4"
          aria-label="Clear the key filter"
          onClick={onClear}
        >
          <span aria-hidden="true">×</span>
        </Button>
      </Badge>
    </div>
  )
}

/**
 * Every rotation across keys, newest first, or one key's when the address
 * names it (`?keyId=`, from that key's page). The key lives only in the
 * address, and clearing it is a navigation, so the host's router sees it.
 */
export const RotationsPage: ComponentType<PluginPageProps> = () => {
  const keyId = useKeyIdParam()
  const setKeyId = useSetKeyIdParam("/rotations")
  // The offset belongs to the key it was paged under. A different key, from
  // the address or the chip, starts again at the first page, and coming back
  // to a key does not bring back the page left there. Adjusted during
  // render, React's supported way to reset state from a changed input.
  const [paging, setPaging] = useState({ keyId, offset: 0 })
  if (paging.keyId !== keyId) setPaging({ keyId, offset: 0 })
  const offset = paging.keyId === keyId ? paging.offset : 0
  const setOffset = (next: number) => setPaging({ keyId, offset: next })
  const [reason, setReason] = useState("")

  // An empty filter is left out of the params rather than sent as "".
  // The page on screen stays while the next one loads, so the pager keeps
  // the focus of the button you pressed.
  const list = useHeldPage(
    useQuery<RotationsList>("rotations.list", {
      limit: PAGE_SIZE,
      offset,
      ...(keyId !== "" && { keyId }),
      ...(reason !== "" && { reason }),
    }),
    JSON.stringify([keyId, reason]),
  )

  // A new filter means a new result set, and page 3 of it may not exist.
  function changeReason(value: string) {
    setReason(value)
    setOffset(0)
  }

  function emptyMessage(): string {
    // Kinds of empty: a later page whose rows have gone, none matching, and
    // none yet. Say which one this is.
    if (offset > 0) return "No rotations on this page."
    if (keyId !== "") {
      return reason !== ""
        ? "No rotations of this key match this reason."
        : "This key has not been rotated."
    }
    return reason !== "" ? "No rotations match this reason." : "No rotations yet."
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Rotations"
        description="Every rotation across keys, newest first."
      />

      <FilterBar
        filters={[
          {
            id: "reason",
            label: "Reason",
            value: reason,
            options: [ALL, ...ROTATION_REASONS],
            onChange: changeReason,
          },
        ]}
      />

      {keyId !== "" && (
        <KeyFilterChip keyId={keyId} onClear={() => setKeyId("")} />
      )}

      <QueryBoundary
        title="Rotations"
        query={list}
        skeletonRows={5}
        keepPreviousData
      >
        {(data) => {
          const rows = data.items ?? []
          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<RotationItem>
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                caption={caption(offset, rows.length, data.hasMore)}
                emptyMessage={emptyMessage()}
                emptyAction={
                  offset > 0 ? (
                    <Button variant="outline" onClick={() => setOffset(0)}>
                      Back to the first page
                    </Button>
                  ) : undefined
                }
              />
              {rows.length > 0 && (
                <Pager
                  offset={offset}
                  hasMore={data.hasMore}
                  onOffsetChange={setOffset}
                />
              )}
            </div>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
