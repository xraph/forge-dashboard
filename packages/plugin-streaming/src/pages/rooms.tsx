import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/** One row of `rooms.list`, from `RoomInfo` in the contract's types.go. */
export interface RoomInfo {
  id: string
  name: string
  description: string
  owner: string
  members: number
  private: boolean
  archived: boolean
  created: string
  updated: string
}

export interface RoomsList {
  rooms: RoomInfo[]
}

const columns: Column<RoomInfo>[] = [
  { id: "name", header: "Name", cell: (r) => r.name },
  {
    id: "id",
    header: "ID",
    cell: (r) => <span className="font-mono text-xs">{r.id}</span>,
  },
  { id: "owner", header: "Owner", cell: (r) => r.owner },
  { id: "members", header: "Members", cell: (r) => r.members, align: "end" },
  {
    id: "visibility",
    header: "Visibility",
    cell: (r) => (
      <Badge variant={r.private ? "secondary" : "outline"}>
        {r.private ? "private" : "public"}
      </Badge>
    ),
  },
  {
    id: "archived",
    header: "Archived",
    cell: (r) => (
      <Badge variant={r.archived ? "secondary" : "outline"}>
        {r.archived ? "archived" : "active"}
      </Badge>
    ),
  },
  { id: "created", header: "Created", cell: (r) => formatTimestamp(r.created) },
]

export function StreamingRoomsPage() {
  const query = useQuery<RoomsList>("rooms.list")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Rooms" />
      <QueryBoundary title="Rooms" query={query} skeletonRows={4}>
        {(data) => (
          <ResourceTable<RoomInfo>
            columns={columns}
            // The Go handler builds this slice itself so it is never null on
            // the wire, but this page is rendered by a host that will hand it
            // whatever the server said. A missing array must not throw inside
            // a plugin's own render.
            rows={data.rooms ?? []}
            rowKey={(r) => r.id}
            caption="Rooms"
            emptyMessage="No rooms yet."
          />
        )}
      </QueryBoundary>
    </section>
  )
}
