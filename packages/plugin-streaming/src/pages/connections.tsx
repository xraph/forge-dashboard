import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { usePoll } from "../use-poll"
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
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { CommandResult } from "./rooms"

/** One row of `connections.list`, from `ConnectionInfo` in types.go. */
export interface ConnectionInfo {
  connID: string
  userID: string
  transport: string
  joinedRooms: string[]
  subscriptions: string[]
  lastActivity: string
  status: string
}

export interface ConnectionsList {
  connections: ConnectionInfo[]
}

/**
 * `status` is a free string on the wire, so this maps the values the extension
 * actually emits and falls through to a neutral badge for anything else. A
 * new status must not render as nothing.
 */
function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default"
  if (status === "idle") return "secondary"
  return "outline"
}

const columns: Column<ConnectionInfo>[] = [
  {
    id: "userID",
    header: "User",
    cell: (c) => <span className="font-mono text-xs">{c.userID}</span>,
  },
  {
    id: "connID",
    header: "Connection",
    cell: (c) => <span className="font-mono text-xs">{c.connID}</span>,
  },
  { id: "transport", header: "Transport", cell: (c) => c.transport },
  {
    id: "status",
    header: "Status",
    // The colour is the scan signal, not the text: an operator scanning a
    // long list reads state from the badge colour at a glance. The text
    // alone is not a substitute for that.
    cell: (c) => (
      <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
    ),
  },
  {
    id: "rooms",
    header: "Rooms",
    cell: (c) => <TagList values={c.joinedRooms ?? []} label="rooms" />,
  },
  {
    id: "subscriptions",
    header: "Subscriptions",
    cell: (c) => (
      <TagList values={c.subscriptions ?? []} label="subscriptions" />
    ),
  },
  {
    id: "lastActivity",
    header: "Last activity",
    cell: (c) => formatTimestamp(c.lastActivity),
  },
]

export function StreamingConnectionsPage() {
  const query = useQuery<ConnectionsList>("connections.list")
  // Polling, not reacting to a write: `connections.kick` already invalidates
  // this intent through `meta.invalidates`, so this refetch exists only to
  // catch connections opening and closing on their own between commands.
  usePoll(query.refetch)
  const [pendingKick, setPendingKick] = useState<ConnectionInfo | null>(null)
  const [reason, setReason] = useState("")
  const kick = useCommand<CommandResult>("connections.kick")

  async function confirmKick() {
    if (!pendingKick) return
    const result = await kick.execute({ connID: pendingKick.connID, reason })
    if (result === undefined) return
    setPendingKick(null)
    setReason("")
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Connections" />
      <QueryBoundary title="Connections" query={query} skeletonRows={4}>
        {(data) => {
          const connections = data.connections ?? []
          return (
            <ResourceTable<ConnectionInfo>
              columns={columns}
              rows={connections}
              rowKey={(c) => c.connID}
              caption={
                connections.length === 0
                  ? undefined
                  : `${connections.length} ${
                      connections.length === 1 ? "connection" : "connections"
                    }`
              }
              emptyMessage="No connections right now."
              rowActions={(c) => (
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={`Kick ${c.userID}`}
                  // `kick` is one hook shared by every row in this table, so
                  // whatever it was holding for the last connection acted on
                  // (an error, in particular) is still there when this
                  // handler runs. Reset here, at the moment the target
                  // changes, not in the dialog's close handler - closing is
                  // not the only way the dialog goes away, and it is what the
                  // operator is about to look at that matters.
                  onClick={() => {
                    kick.reset()
                    setPendingKick(c)
                  }}
                >
                  Kick
                </Button>
              )}
            />
          )
        }}
      </QueryBoundary>
      {/*
        This alert only ever shows once the dialog below has been dismissed:
        while the dialog is open, Base UI marks the rest of the page inert
        and `aria-hidden`, so a `<div>` out here is invisible to an operator
        even though the DOM still holds it. A failure surfaced while the
        dialog is open renders inside the dialog's own description instead,
        as a `<span role="alert">` rather than this component's `<div>`,
        because the dialog's description is a `<p>` and cannot host one.
      */}
      <CommandAlert error={kick.error} title="Could not disconnect" />
      <ConfirmDialog
        open={pendingKick !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingKick(null)
            setReason("")
          }
        }}
        title={`Disconnect ${pendingKick?.userID ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              Closes the {pendingKick?.transport} connection{" "}
              <span className="font-mono text-xs">{pendingKick?.connID}</span>.
              They can reconnect immediately.
            </span>
            {kick.error && (
              <span role="alert" className="text-destructive">
                Could not disconnect: {kick.error.message}
              </span>
            )}
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="kick-reason">Reason</Label>
              <Input
                id="kick-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </span>
          </span>
        }
        confirmLabel="Disconnect"
        pending={kick.loading}
        // The reason is what the disconnected user is actually told, so a
        // blank one is a kick with no explanation. `confirmDisabled` (not
        // `pending`) is the right signal here: the dialog is not working on
        // anything, it is still missing something it needs before it can.
        confirmDisabled={reason.trim() === ""}
        onConfirm={() => void confirmKick()}
      />
    </section>
  )
}
