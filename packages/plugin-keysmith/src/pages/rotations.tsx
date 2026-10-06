import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
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
import {
  formatDuration,
  keyPath,
  ROTATION_REASONS,
  rotationMasked,
} from "../format"
import type { RotationItem, RotationsList } from "../types"

const PAGE_SIZE = 25

const ALL = { value: "", label: "All" }

/**
 * The rotated key by name, linked to its page, with the key it was rotated
 * into masked beneath. A key that no longer exists has no page and no name,
 * so its id stands in as a raw value and the row says why. The overview's
 * recent rotations use the same cell.
 */
export function KeyCell({ item }: { item: RotationItem }) {
  if (item.keyName === null) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs font-normal">{item.keyId}</span>
        <span className="text-xs font-normal text-muted-foreground">
          Key no longer exists
        </span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <PluginLink to={keyPath(item.keyId)}>{item.keyName}</PluginLink>
      <span className="font-mono text-xs font-normal text-muted-foreground">
        {rotationMasked(item, "new")}
      </span>
    </div>
  )
}

/**
 * Whether the window is still running, worded neutrally. A suspended key's
 * window is open, yet its old key is refused until the key is reactivated,
 * so this never says the old key keeps working. The contract never reports
 * a gone key's window open; the page holds the same line regardless. The
 * overview uses this cell too, so the two pages word a window alike.
 */
export function WindowCell({ item }: { item: RotationItem }) {
  if (!item.windowOpen || item.keyName === null) {
    return <span className="text-muted-foreground">Closed</span>
  }
  return (
    <span>
      Window ends <Timestamp value={item.graceEnds} label="window end" />
    </span>
  )
}

const columns: Column<RotationItem>[] = [
  {
    id: "when",
    header: "When",
    cell: (r) => <Timestamp value={r.rotatedAt} label="rotation time" />,
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
  {
    id: "rotatedBy",
    header: "Rotated by",
    cell: (r) =>
      r.rotatedBy ? (
        <span className="font-mono text-xs">{r.rotatedBy}</span>
      ) : (
        <NoneCell label="actor recorded" />
      ),
  },
]

/**
 * What the caption says. rotations.list has no total, so past the first page
 * the caption names the rows shown and whether more follow, and nothing it
 * does not know.
 */
function caption(offset: number, shown: number, hasMore: boolean): string {
  if (offset === 0 && !hasMore) {
    return `${shown} ${shown === 1 ? "rotation" : "rotations"}`
  }
  if (shown === 0) return `No rotations from ${offset + 1}`
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

export const RotationsPage: ComponentType<PluginPageProps> = () => {
  const [offset, setOffset] = useState(0)
  const [reason, setReason] = useState("")

  // An empty filter is left out of the params rather than sent as "".
  const list = useQuery<RotationsList>("rotations.list", {
    limit: PAGE_SIZE,
    offset,
    ...(reason !== "" && { reason }),
  })

  const filtered = reason !== ""

  // A new filter means a new result set, and page 3 of it may not exist.
  function changeReason(value: string) {
    setReason(value)
    setOffset(0)
  }

  function emptyMessage(): string {
    // Three kinds of empty: a later page whose rows have gone, none matching,
    // and none yet. Say which one this is.
    if (offset > 0) return "No rotations on this page."
    return filtered ? "No rotations match this reason." : "No rotations yet."
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

      <QueryBoundary title="Rotations" query={list} skeletonRows={5}>
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
