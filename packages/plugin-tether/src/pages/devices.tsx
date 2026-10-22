import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { TetherBoundary } from "../components/boundary"
import { CredentialsDialog } from "../components/credentials-dialog"
import {
  DeleteDeviceDialog,
  DeviceRolesDialog,
  ProvisionDeviceDialog,
  RevokeDeviceDialog,
  RotateDeviceDialog,
  deviceLabel,
} from "../components/device-dialogs"
import { devicePath } from "../format"
import type { Credentials, Device, DevicesList } from "../types"

/**
 * One of the actions on a row, which names the dialog open for that device. At
 * most one is open, so a row's choice and its device travel together.
 */
type Action = {
  kind: "rotate" | "revoke" | "delete" | "roles"
  device: Device
}

/**
 * The Devices tab of a tenant: its devices, and provisioning, key rotation,
 * revoking, role assignment and deletion.
 *
 * The password of a provision or rotate is held here, in state, only while its
 * dialog is up. It is never read from a query, and `devices.list` does not
 * carry one.
 */
export function DevicesPanel({ tenantId }: { tenantId: string }) {
  const query = useQuery<DevicesList>("devices.list", { tenantId })
  const [provisioning, setProvisioning] = useState(false)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [action, setAction] = useState<Action | null>(null)

  const pick = (kind: Action["kind"], device: Device) =>
    setAction({ kind, device })
  const close = () => setAction(null)
  const forDevice = (kind: Action["kind"]) =>
    action?.kind === kind ? action.device : null

  // The device and key IDs are long TypeIDs, and with them the row actions
  // ran off a 1280px screen. They are on the device's page, one click away.
  const columns: Column<Device>[] = [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (d) => (
        <PluginLink
          to={devicePath(tenantId, d.id)}
          className="underline underline-offset-4"
        >
          {deviceLabel(d)}
        </PluginLink>
      ),
    },
    {
      id: "client",
      header: "Client ID",
      cell: (d) =>
        d.clientId ? (
          <span className="font-mono text-xs">{d.clientId}</span>
        ) : (
          <NoneCell label="client ID" />
        ),
    },
    {
      id: "roles",
      header: "Roles",
      cell: (d) => <TagList values={d.roles ?? []} label="roles" />,
    },
    {
      id: "created",
      header: "Created",
      cell: (d) => <Timestamp value={d.createdAt} label="creation time" />,
    },
  ]

  return (
    <>
      <Section
        aria-label="Device list"
        actions={
          <Button onClick={() => setProvisioning(true)}>
            Provision device
          </Button>
        }
      >
        <TetherBoundary title="Devices" query={query} skeletonRows={4}>
          {(data) => {
            const devices = data.items ?? []
            const full = data.limit > 0 && devices.length >= data.limit
            return (
              <>
                <ResourceTable<Device>
                  columns={columns}
                  rows={devices}
                  rowKey={(d) => d.id}
                  caption={`${devices.length} ${devices.length === 1 ? "device" : "devices"}`}
                  emptyMessage="No devices yet."
                  rowActions={(d) => (
                    <>
                      <IconButton
                        label={`Edit roles of ${deviceLabel(d)}`}
                        onClick={() => pick("roles", d)}
                      />
                      <IconButton
                        label={`Rotate key of ${deviceLabel(d)}`}
                        onClick={() => pick("rotate", d)}
                      />
                      <IconButton
                        label={`Revoke ${deviceLabel(d)}`}
                        onClick={() => pick("revoke", d)}
                      />
                      <IconButton
                        variant="destructive"
                        label={`Delete ${deviceLabel(d)}`}
                        onClick={() => pick("delete", d)}
                      />
                    </>
                  )}
                />
                {full && (
                  <p className="px-4 pb-3 text-xs text-muted-foreground">
                    {`Showing the first ${data.limit} devices. There may be more.`}
                  </p>
                )}
              </>
            )
          }}
        </TetherBoundary>
      </Section>

      <ProvisionDeviceDialog
        tenantId={tenantId}
        open={provisioning}
        onOpenChange={setProvisioning}
        onProvisioned={setCredentials}
        onStale={query.refetch}
      />
      <RotateDeviceDialog
        tenantId={tenantId}
        device={forDevice("rotate")}
        onClose={close}
        onRotated={setCredentials}
        onStale={query.refetch}
      />
      <RevokeDeviceDialog
        tenantId={tenantId}
        device={forDevice("revoke")}
        onClose={close}
      />
      <DeleteDeviceDialog
        tenantId={tenantId}
        device={forDevice("delete")}
        onClose={close}
      />
      <DeviceRolesDialog
        tenantId={tenantId}
        device={forDevice("roles")}
        onClose={close}
      />
      <CredentialsDialog
        credentials={credentials}
        onClose={() => setCredentials(null)}
      />
    </>
  )
}
