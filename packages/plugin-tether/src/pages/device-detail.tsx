import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { TetherBoundary } from "../components/boundary"
import { CredentialsDialog } from "../components/credentials-dialog"
import {
  DeleteDeviceDialog,
  DeviceRolesDialog,
  RevokeDeviceDialog,
  RotateDeviceDialog,
  deviceLabel,
} from "../components/device-dialogs"
import { keysmithKeyPath, tenantPath, wardenSubjectPath } from "../format"
import type { Credentials, Device } from "../types"

const ID = ({ children }: { children: string }) => (
  <span className="font-mono text-xs">{children}</span>
)

const LINK = "font-mono text-xs underline underline-offset-4"

function details(device: Device) {
  const metadata = device.metadata ?? {}
  return [
    { term: "Device ID", value: <ID>{device.id}</ID> },
    { term: "Tenant ID", value: <ID>{device.tenantId}</ID> },
    {
      term: "Keysmith key",
      value: (
        <PluginLink to={keysmithKeyPath(device.keyId)} className={LINK}>
          {device.keyId}
        </PluginLink>
      ),
    },
    {
      term: "Warden subject",
      value: (
        <PluginLink to={wardenSubjectPath(device.keyId)} className={LINK}>
          {`api_key:${device.keyId}`}
        </PluginLink>
      ),
    },
    {
      term: "Client ID",
      value: device.clientId ? (
        <ID>{device.clientId}</ID>
      ) : (
        <NoneCell label="client ID" />
      ),
    },
    {
      term: "Roles",
      value: <TagList values={device.roles ?? []} label="roles" />,
    },
    {
      term: "Metadata",
      value:
        Object.keys(metadata).length === 0 ? (
          <NoneCell label="metadata" />
        ) : (
          <pre className="font-mono text-xs break-all whitespace-pre-wrap">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        ),
    },
    {
      term: "Created",
      value: <Timestamp value={device.createdAt} label="creation time" />,
    },
    {
      term: "Updated",
      value: <Timestamp value={device.updatedAt} label="update time" />,
    },
  ]
}

type Action = "rotate" | "revoke" | "delete" | "roles"

/**
 * One device of a tenant, at `/tenants/:tenantId/devices/:deviceId`: its
 * identity, the keysmith key and warden subject behind it, and the same
 * actions the Devices tab offers.
 */
export const DeviceDetailPage: ComponentType<PluginPageProps> = ({
  params,
}) => {
  const tenantId = params.tenantId ?? ""
  const deviceId = params.deviceId ?? ""
  const query = useQuery<Device>("devices.get", { tenantId, deviceId })
  const navigate = useNavigateTo()
  const [action, setAction] = useState<Action | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)

  const device = query.data
  const close = () => setAction(null)
  const forDevice = (kind: Action) =>
    action === kind && device ? device : null

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <p className="text-sm">
        <PluginLink
          to={tenantPath(tenantId)}
          className="underline underline-offset-4"
        >
          Back to tenant
        </PluginLink>
      </p>
      <PageHeader
        title={device ? deviceLabel(device) : "Device"}
        description="An MQTT identity inside this tenant, backed by a keysmith key."
        actions={
          device && (
            <>
              <Button variant="outline" onClick={() => setAction("roles")}>
                Edit roles
              </Button>
              <Button variant="outline" onClick={() => setAction("rotate")}>
                Rotate key
              </Button>
              <Button variant="outline" onClick={() => setAction("revoke")}>
                Revoke
              </Button>
              <Button variant="destructive" onClick={() => setAction("delete")}>
                Delete device
              </Button>
            </>
          )
        }
      />
      <Section title="Details" inset>
        <TetherBoundary title="Device" query={query} skeletonRows={4}>
          {(d) => <DescriptionList items={details(d)} />}
        </TetherBoundary>
      </Section>

      <DeviceRolesDialog
        tenantId={tenantId}
        device={forDevice("roles")}
        onClose={close}
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
        // Nothing left to show here: go to the tenant, and let Back skip a
        // page about a device that is gone.
        onDeleted={() => navigate(tenantPath(tenantId), { replace: true })}
      />
      <CredentialsDialog
        credentials={credentials}
        onClose={() => setCredentials(null)}
      />
    </section>
  )
}
