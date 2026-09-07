import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@forge-go/dashboard-kit/components/table"
import {
  EmptyState,
  QueryView,
  formatTimestamp,
} from "../components/query-view"

/**
 * One row of `rooms.list`, from `RoomInfo` in
 * `extensions/streaming/contract/types.go`.
 */
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

export function StreamingRoomsPage() {
  const query = useQuery<RoomsList>("rooms.list")

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">Rooms</h1>
      <QueryView title="Rooms" query={query} skeletonRows={4}>
        {(data) => {
          // The Go handler builds this slice itself so it is never null on the
          // wire, but the page is rendered by a host that will happily hand it
          // whatever the server said. A missing array must not throw inside a
          // plugin's own render.
          const rooms = data.rooms ?? []
          if (rooms.length === 0) return <EmptyState message="No rooms yet." />

          return (
            <Table>
              <TableCaption>
                {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((room) => (
                  <TableRow key={room.id}>
                    <TableCell className="font-medium">{room.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {room.id}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {room.owner}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {room.members}
                    </TableCell>
                    <TableCell>
                      <Badge variant={room.private ? "secondary" : "outline"}>
                        {room.private ? "private" : "public"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={room.archived ? "destructive" : "outline"}
                      >
                        {room.archived ? "archived" : "active"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatTimestamp(room.created)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }}
      </QueryView>
    </section>
  )
}
