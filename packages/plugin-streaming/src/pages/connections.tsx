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

/** Renders a string slice as badges, or an em-less dash when it is empty. */
function IdList({ values, label }: { values: string[]; label: string }) {
  if (values.length === 0) {
    // An empty cell reads as "loading" or "broken". The dash says "none",
    // and the label says it to a screen reader too.
    return (
      <span aria-label={`no ${label}`} className="text-muted-foreground">
        –
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value} variant="outline" className="font-mono text-xs">
          {value}
        </Badge>
      ))}
    </span>
  )
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
    cell: (c) => <IdList values={c.joinedRooms ?? []} label="rooms" />,
  },
  {
    id: "subscriptions",
    header: "Subscriptions",
    cell: (c) => (
      <IdList values={c.subscriptions ?? []} label="subscriptions" />
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
                  onClick={() => setPendingKick(c)}
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
        onConfirm={() => void confirmKick()}
      />
    </section>
  )
}
