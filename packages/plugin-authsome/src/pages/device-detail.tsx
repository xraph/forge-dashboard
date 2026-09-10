import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { AckResponse } from "./users"
import { deviceLabel, type DeviceSummary } from "./devices"

function DeviceActions({ device }: { device: DeviceSummary }) {
  const trust = useCommand<AckResponse>("devices.trust")
  const remove = useCommand<AckResponse>("devices.delete")
  const [forgetting, setForgetting] = useState(false)

  async function confirmForget() {
    const result = await remove.execute({ id: device.id })
    if (result !== undefined) setForgetting(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Actions</h2>
      <CommandAlert error={trust.error} title="Could not trust the device" />
      <div className="flex items-center gap-2">
        {!device.trusted && (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Trust ${deviceLabel(device)}`}
            disabled={trust.loading}
            onClick={() => void trust.execute({ id: device.id })}
          >
            Trust
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          aria-label={`Forget ${deviceLabel(device)}`}
          onClick={() => setForgetting(true)}
        >
          Forget
        </Button>
      </div>

      {/*
        The forget error lives inside the dialog's description, not above it:
        Base UI marks everything outside an open AlertDialog `inert` and
        `aria-hidden`, so an alert rendered outside it is unreachable for as
        long as the dialog that can fail is open.
      */}
      <ConfirmDialog
        open={forgetting}
        onOpenChange={setForgetting}
        title={`Forget ${deviceLabel(device)}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>The next sign-in from it counts as a new device, which may trigger verification.</span>
            <CommandAlert error={remove.error} title="Could not forget the device" />
          </span>
        }
        confirmLabel="Forget"
        pending={remove.loading}
        onConfirm={() => void confirmForget()}
      />
    </div>
  )
}

export function AuthDeviceDetailPage({ params }: PluginPageProps) {
  const deviceId = params.id
  if (!deviceId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No device selected.
      </p>
    )
  }
  return <DeviceDetailBody deviceId={deviceId} />
}

function DeviceDetailBody({ deviceId }: { deviceId: string }) {
  const query = useQuery<DeviceSummary>("devices.detail", { id: deviceId })

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Device" query={query} skeletonRows={3}>
        {(device) => (
          <>
            <PageHeader title={deviceLabel(device)} description={device.id} />
            <DescriptionList
              items={[
                { term: "User", value: device.userId },
                { term: "Type", value: device.type || "–" },
                { term: "Browser", value: device.browser || "–" },
                { term: "OS", value: device.os || "–" },
                { term: "IP", value: device.ipAddress || "–" },
                {
                  term: "Trusted",
                  value: (
                    <Badge variant={device.trusted ? "outline" : "secondary"}>
                      {device.trusted ? "trusted" : "untrusted"}
                    </Badge>
                  ),
                },
                { term: "Last seen", value: formatTimestamp(device.lastSeenAt) },
                { term: "Created", value: formatTimestamp(device.createdAt) },
              ]}
            />
            <DeviceActions device={device} />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
