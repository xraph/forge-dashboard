import { useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"

/** One row of `channels.list`, from `ChannelInfo` in types.go. */
export interface ChannelInfo {
  id: string
  name: string
  subscriberCount: number
  messageCount: number
}
export interface ChannelsList {
  channels: ChannelInfo[]
}

const columns: Column<ChannelInfo>[] = [
  { id: "name", header: "Name", cell: (c) => c.name, className: "font-medium" },
  // The raw channel id, same reasoning as the rooms and users lists: an
  // operator correlating a row with logs or a support ticket needs it
  // without going through the name.
  { id: "id", header: "ID", cell: (c) => c.id, className: "font-mono text-xs" },
  {
    id: "subscriberCount",
    header: "Subscribers",
    cell: (c) => c.subscriberCount,
    align: "end",
  },
  { id: "messageCount", header: "Messages", cell: (c) => c.messageCount, align: "end" },
]

export function StreamingChannelsPage() {
  const query = useQuery<ChannelsList>("channels.list")
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Channels" />
      <QueryBoundary title="Channels" query={query} skeletonRows={4}>
        {(data) => {
          // The Go handler builds this slice itself so it is never null on
          // the wire, but this page is rendered by a host that will hand it
          // whatever the server said. A missing array must not throw inside
          // a plugin's own render.
          const channels = data.channels ?? []
          return (
            <ResourceTable<ChannelInfo>
              columns={columns}
              rows={channels}
              rowKey={(c) => c.id}
              caption={
                channels.length === 0
                  ? undefined
                  : `${channels.length} ${channels.length === 1 ? "channel" : "channels"}`
              }
              emptyMessage="No channels yet."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
