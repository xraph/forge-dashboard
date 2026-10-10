import type { ComponentType } from "react"
import { usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { StreamStateBadge } from "../badges"
import { Bytes } from "../components/bytes"
import { SettledBoundary } from "../components/settled-boundary"
import { StorePicker } from "../components/store-picker"
import { useActiveStore, withStore } from "../store"
import type { StreamRow, StreamsList } from "../types"

const POLL_MS = 5000

const columns: Column<StreamRow>[] = [
  {
    id: "target",
    header: "Object",
    className: "font-medium",
    cell: (s) => {
      const target = `${s.bucket}/${s.key}`
      return (
        <span
          className="block max-w-sm truncate font-mono text-xs"
          title={target}
        >
          {target}
        </span>
      )
    },
  },
  { id: "direction", header: "Direction", cell: (s) => s.direction },
  {
    id: "state",
    header: "State",
    cell: (s) => <StreamStateBadge state={s.state} />,
  },
  {
    id: "offset",
    header: "Transferred",
    cell: (s) => <Bytes value={s.offset} />,
  },
  {
    id: "total",
    header: "Expected size",
    cell: (s) =>
      s.totalSize === null ? (
        <NoneCell label="total size" />
      ) : (
        <Bytes value={s.totalSize} />
      ),
  },
]

function caption(n: number, max: number): string {
  return `${n} open ${n === 1 ? "stream" : "streams"}, ${max} allowed`
}

export const TransfersPage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const list = useQuery<StreamsList>("streams.list", withStore(store, {}))
  usePoll(list.refetch, POLL_MS)

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Transfers"
        description="Streams open in this process. They are not saved and are lost on restart."
        actions={<StorePicker />}
      />
      {/* Polled, so the table must stay mounted while a tick refetches. */}
      <SettledBoundary title="Transfers" query={list} skeletonRows={3}>
        {(data) => (
          <ResourceTable<StreamRow>
            columns={columns}
            rows={data.streams}
            rowKey={(s) => s.id}
            caption={caption(data.streams.length, data.max)}
            emptyMessage="No streams open."
          />
        )}
      </SettledBoundary>
    </section>
  )
}
