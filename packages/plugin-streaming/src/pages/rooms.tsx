import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/** The uniform payload every streaming mutation answers. */
export interface CommandResult {
  ok: boolean
  message?: string
  id?: string
}

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
  {
    id: "name",
    header: "Name",
    cell: (r) => r.name,
    className: "font-medium",
  },
  {
    id: "id",
    header: "ID",
    cell: (r) => <span className="font-mono text-xs">{r.id}</span>,
  },
  {
    id: "owner",
    header: "Owner",
    cell: (r) => r.owner,
    className: "font-mono text-xs",
  },
  {
    id: "members",
    header: "Members",
    cell: (r) => r.members,
    align: "end",
    className: "tabular-nums",
  },
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
    // Archived is the state an operator is scanning a room list for, so it
    // gets the loud variant. Visibility above is neutral either way and
    // stays on "secondary" - only archived borrows "destructive".
    cell: (r) => (
      <Badge variant={r.archived ? "destructive" : "outline"}>
        {r.archived ? "archived" : "active"}
      </Badge>
    ),
  },
  { id: "created", header: "Created", cell: (r) => formatTimestamp(r.created) },
]

function CreateRoomForm({ onDone }: { onDone: () => void }) {
  const create = useCommand<CommandResult>("rooms.create")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [owner, setOwner] = useState("")
  const [isPrivate, setPrivate] = useState(false)

  async function submit() {
    const result = await create.execute({ name, description, owner, private: isPrivate })
    // `execute` resolves with undefined on failure and never rejects, so this
    // is the success check. A failed create must not close the form and throw
    // away what the operator typed.
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <CommandAlert error={create.error} title="Could not create the room" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="room-name">Name</Label>
        <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="room-description">Description</Label>
        <Input
          id="room-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="room-owner">Owner</Label>
        <Input id="room-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        {/*
          No `htmlFor` here: the Switch renders a visible span plus a hidden
          native checkbox sharing this id, and a `for`/`id` pairing would let
          the browser's native label association pick up that hidden input
          too, so `getByLabelText("Private")` (and a real screen reader) would
          land on two elements. `aria-labelledby` targets the visible switch
          alone, the same pattern `SettingsForm` uses for its boolean fields.
        */}
        <Label id="room-private-label">Private</Label>
        <Switch
          id="room-private"
          aria-labelledby="room-private-label"
          checked={isPrivate}
          onCheckedChange={setPrivate}
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={create.loading || name.trim() === ""}>
          {create.loading ? "Creating…" : "Create room"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={create.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function StreamingRoomsPage() {
  const query = useQuery<RoomsList>("rooms.list")
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<RoomInfo | null>(null)
  const remove = useCommand<CommandResult>("rooms.delete")

  async function confirmDelete() {
    if (!pendingDelete) return
    const result = await remove.execute({ id: pendingDelete.id })
    // Close on success only. Leaving it open on failure keeps the error in
    // front of the person who caused it.
    if (result !== undefined) setPendingDelete(null)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Rooms"
        actions={
          !creating && <Button onClick={() => setCreating(true)}>New room</Button>
        }
      />
      {creating && <CreateRoomForm onDone={() => setCreating(false)} />}
      <QueryBoundary title="Rooms" query={query} skeletonRows={4}>
        {(data) => {
          // The Go handler builds this slice itself so it is never null on
          // the wire, but this page is rendered by a host that will hand it
          // whatever the server said. A missing array must not throw inside
          // a plugin's own render.
          const rooms = data.rooms ?? []
          return (
            <ResourceTable<RoomInfo>
              columns={columns}
              rows={rooms}
              rowKey={(r) => r.id}
              caption={
                rooms.length === 0
                  ? undefined
                  : `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`
              }
              emptyMessage="No rooms yet."
              rowActions={(room) => (
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={`Delete ${room.name}`}
                  onClick={() => setPendingDelete(room)}
                >
                  Delete
                </Button>
              )}
            />
          )
        }}
      </QueryBoundary>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete “${pendingDelete?.name ?? ""}”?`}
        description={
          <>
            <span>
              Everyone in the room is disconnected from it. This cannot be undone.
            </span>
            {/*
              A failed delete keeps this dialog open (see confirmDelete above),
              specifically so the error stays in front of the operator who
              caused it. Base UI marks the rest of the page `aria-hidden` and
              inert while the dialog is open, so a `CommandAlert` rendered on
              the page body - the brief's original placement - would fail
              that goal silently: correct-looking markup nobody, and no
              assistive tech, can reach. It has to render inside the dialog
              itself. It is a `<span>`, not `CommandAlert`'s `<div>`, because
              `AlertDialogDescription` renders a `<p>` and a `<div>` is not
              valid `<p>` content.
            */}
            {remove.error && (
              <span role="alert" className="mt-2 block font-medium text-destructive">
                Could not delete the room: {remove.error.message} ({remove.error.code})
              </span>
            )}
          </>
        }
        confirmLabel="Delete"
        // Required. Without it a double-click deletes twice.
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
