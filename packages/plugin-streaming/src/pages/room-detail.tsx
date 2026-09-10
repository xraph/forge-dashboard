import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { RoomInfo } from "./rooms"
import type { CommandResult } from "./rooms"

/** One row of `rooms.members`, from `MemberInfo` in types.go. */
export interface MemberInfo {
  userID: string
  role: string
  joinedAt: string
  permissions: string[]
}
export interface MembersList {
  members: MemberInfo[]
}

/** One row of `rooms.moderation`, from `ModerationEntry` in types.go. */
export interface ModerationEntry {
  timestamp: string
  action: string
  actorID: string
  targetID: string
  reason: string
  metadata?: Record<string, unknown>
}
export interface ModerationLog {
  entries: ModerationEntry[]
}

const memberColumns: Column<MemberInfo>[] = [
  {
    id: "userID",
    header: "User",
    cell: (m) => <span className="font-mono text-xs">{m.userID}</span>,
  },
  { id: "role", header: "Role", cell: (m) => <Badge variant="outline">{m.role}</Badge> },
  { id: "joinedAt", header: "Joined", cell: (m) => formatTimestamp(m.joinedAt) },
  {
    id: "permissions",
    header: "Permissions",
    cell: (m) => <TagList values={m.permissions ?? []} label="permissions" />,
  },
]

const moderationColumns: Column<ModerationEntry>[] = [
  { id: "timestamp", header: "When", cell: (e) => formatTimestamp(e.timestamp) },
  { id: "action", header: "Action", cell: (e) => e.action },
  {
    id: "actorID",
    header: "By",
    cell: (e) => <span className="font-mono text-xs">{e.actorID}</span>,
  },
  {
    id: "targetID",
    header: "Target",
    cell: (e) => <span className="font-mono text-xs">{e.targetID}</span>,
  },
  {
    id: "reason",
    header: "Reason",
    cell: (e) => (e.reason ? e.reason : <NoneCell label="reason" />),
  },
]

function Members({ roomId }: { roomId: string }) {
  const query = useQuery<MembersList>("rooms.members", { id: roomId })
  return (
    <QueryBoundary title="Members" query={query} skeletonRows={3}>
      {(data) => {
        const members = data.members ?? []
        return (
          <ResourceTable<MemberInfo>
            columns={memberColumns}
            rows={members}
            rowKey={(m) => m.userID}
            caption={
              members.length === 0
                ? undefined
                : `${members.length} ${members.length === 1 ? "member" : "members"}`
            }
            emptyMessage="Nobody has joined this room."
          />
        )
      }}
    </QueryBoundary>
  )
}

function Moderation({ roomId }: { roomId: string }) {
  const query = useQuery<ModerationLog>("rooms.moderation", { id: roomId })
  return (
    <QueryBoundary title="Moderation log" query={query} skeletonRows={3}>
      {(data) => {
        const entries = data.entries ?? []
        return (
          <ResourceTable<ModerationEntry>
            columns={moderationColumns}
            rows={entries}
            rowKey={(e) => `${e.timestamp}:${e.actorID}:${e.targetID}`}
            caption={
              entries.length === 0
                ? undefined
                : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
            }
            emptyMessage="Nothing has been moderated in this room."
          />
        )
      }}
    </QueryBoundary>
  )
}

function Composer({ roomId }: { roomId: string }) {
  const send = useCommand<CommandResult>("rooms.send-message")
  const [userID, setUserID] = useState("")
  const [content, setContent] = useState("")

  async function submit() {
    const result = await send.execute({ roomID: roomId, userID, content })
    // Clear on success only. Wiping the box after a failed send loses what the
    // operator typed and tells them nothing about why.
    if (result !== undefined) setContent("")
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Send a message</h2>
      <CommandAlert error={send.error} title="Could not send the message" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="send-as">Send as</Label>
        <Input id="send-as" value={userID} onChange={(e) => setUserID(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="send-content">Message</Label>
        <Input
          id="send-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      <Button
        onClick={() => void submit()}
        disabled={send.loading || content.trim() === "" || userID.trim() === ""}
      >
        {send.loading ? "Sending…" : "Send"}
      </Button>
    </div>
  )
}

export function StreamingRoomDetailPage({ params }: PluginPageProps) {
  const roomId = params.id

  // A detail route reached without an id is a link somebody built wrong, not a
  // server state. Say so rather than issuing `rooms.detail` with an undefined
  // id and rendering whatever the server makes of that.
  if (!roomId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No room selected.
      </p>
    )
  }

  return <RoomDetail roomId={roomId} />
}

function RoomDetail({ roomId }: { roomId: string }) {
  const query = useQuery<RoomInfo>("rooms.detail", { id: roomId })

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Room" query={query} skeletonRows={2}>
        {(room) => (
          <>
            <PageHeader title={room.name} description={room.description} />
            <DetailLayout
              main={
                <>
                  <DescriptionList
                    items={[
                      {
                        term: "Owner",
                        value: <span className="font-mono text-xs">{room.owner}</span>,
                      },
                      { term: "Members", value: room.members },
                      {
                        term: "Visibility",
                        value: (
                          <Badge variant={room.private ? "secondary" : "outline"}>
                            {room.private ? "private" : "public"}
                          </Badge>
                        ),
                      },
                      {
                        term: "Archived",
                        value: room.archived ? "yes" : "no",
                      },
                      { term: "Created", value: formatTimestamp(room.created) },
                      { term: "Updated", value: formatTimestamp(room.updated) },
                    ]}
                  />
                  <Members roomId={roomId} />
                  <Moderation roomId={roomId} />
                </>
              }
              aside={<Composer roomId={roomId} />}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
