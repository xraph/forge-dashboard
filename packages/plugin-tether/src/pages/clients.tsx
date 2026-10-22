import { useState } from "react"
import {
  PluginLink,
  useCommand,
  usePoll,
  useQuery,
} from "@forge-go/dashboard-plugin"
import { UnplugIcon } from "@forge-go/dashboard-kit/icons"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { TetherBoundary, TetherCommandAlert } from "../components/boundary"
import { devicePath, formatCount, formatSeconds } from "../format"
import type { Ack, Client, ClientsList } from "../types"

const POLL_MS = 10_000

const ID = ({ children }: { children: string }) => (
  <span className="font-mono text-xs">{children}</span>
)

/** MQTT 3.1.1 is protocol level 4 and MQTT 5 is 5. */
function protocol(version: number): string {
  return version === 5
    ? "MQTT 5"
    : version === 4
      ? "MQTT 3.1.1"
      : `MQTT ${version}`
}

/** Seconds a session outlives its connection. 0 ends it on disconnect. */
function expiry(seconds: number): string {
  return seconds === 0 ? "Ends on disconnect" : formatSeconds(seconds)
}

/**
 * The Clients tab of a tenant: open connections and kept sessions on this
 * node, polled so a connect or a drop shows within ten seconds. A connected
 * client can be kicked (disconnected, session kept) and any session deleted.
 */
export function ClientsPanel({ tenantId }: { tenantId: string }) {
  const query = useQuery<ClientsList>("clients.list", { tenantId })
  usePoll(query.refetch, POLL_MS)
  const kick = useCommand<Ack>("clients.kick")
  const remove = useCommand<Ack>("sessions.delete")
  const [kicked, setKicked] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Client | null>(null)

  function kickClient(client: Client) {
    kick.reset()
    setKicked(client.clientId)
    void kick.execute({ tenantId, clientId: client.clientId })
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const result = await remove.execute({
      tenantId,
      clientId: pendingDelete.clientId,
    })
    if (result !== undefined) setPendingDelete(null)
  }

  const columns: Column<Client>[] = [
    {
      id: "client",
      header: "Client ID",
      className: "font-medium",
      // The remote address sits under the client ID rather than in a
      // column of its own, so the row fits a 1280px screen.
      cell: (c) => (
        <div className="flex flex-col">
          <ID>{c.clientId}</ID>
          {c.remote ? (
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {c.remote}
            </span>
          ) : (
            <NoneCell label="remote address" />
          )}
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      // Offline sessions are the exception on a healthy node, and the one an
      // operator scans for: they take the louder variant.
      cell: (c) => (
        <Badge variant={c.connected ? "outline" : "secondary"}>
          {c.connected ? "connected" : "offline"}
        </Badge>
      ),
    },
    {
      id: "device",
      header: "Device",
      cell: (c) =>
        c.deviceId ? (
          // Cut short: the whole ID is a long TypeID. The title and the
          // device page carry all of it.
          <span title={c.deviceId} className="block max-w-36">
            <PluginLink
              to={devicePath(tenantId, c.deviceId)}
              className="block truncate font-mono text-xs underline underline-offset-4"
            >
              {c.deviceId}
            </PluginLink>
          </span>
        ) : (
          <NoneCell label="device" />
        ),
    },
    {
      id: "protocol",
      header: "Protocol",
      cell: (c) => protocol(c.protocolVersion),
    },
    {
      id: "subscriptions",
      header: "Subscriptions",
      align: "end",
      cell: (c) => formatCount((c.subscriptions ?? []).length),
    },
    {
      id: "connected",
      header: "Connected",
      cell: (c) => <Timestamp value={c.connectedAt} label="connection time" />,
    },
    {
      id: "expiry",
      header: "Session expiry",
      cell: (c) => expiry(c.sessionExpirySeconds),
    },
  ]

  return (
    <>
      <TetherCommandAlert
        error={kick.error}
        title={`Could not kick ${kicked ?? "the client"}`}
      />
      <Section aria-label="Client list">
        <TetherBoundary
          title="Clients"
          query={query}
          skeletonRows={4}
          // The poll refetches on a timer; a skeleton every ten seconds would
          // make the rows blink instead of tick.
          keepPreviousData
        >
          {(data) => {
            const clients = data.items ?? []
            return (
              <ResourceTable<Client>
                columns={columns}
                rows={clients}
                rowKey={(c) => c.clientId}
                caption={`${clients.length} ${clients.length === 1 ? "client" : "clients"}`}
                emptyMessage="No clients on this node."
                rowActions={(c) => (
                  <>
                    {c.connected && (
                      <IconButton
                        label={`Kick ${c.clientId}`}
                        icon={UnplugIcon}
                        disabled={kick.loading}
                        onClick={() => kickClient(c)}
                      />
                    )}
                    <IconButton
                      variant="destructive"
                      label={`Delete session ${c.clientId}`}
                      onClick={() => {
                        remove.reset()
                        setPendingDelete(c)
                      }}
                    />
                  </>
                )}
              />
            )
          }}
        </TetherBoundary>
      </Section>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete the session of “${pendingDelete?.clientId ?? ""}”?`}
        description="Disconnects the client if it is connected and drops its session, including its subscriptions and any queued messages."
        confirmLabel="Delete session"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <TetherCommandAlert
          error={remove.error}
          title="Could not delete the session"
        />
      </ConfirmDialog>
    </>
  )
}
