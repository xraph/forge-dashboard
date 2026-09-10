import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
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
import type { AckResponse } from "./users"

/** One row of `devices.list`. */
export interface DeviceSummary {
  id: string
  userId: string
  name?: string
  type?: string
  browser?: string
  os?: string
  ipAddress?: string
  trusted: boolean
  lastSeenAt: string
  createdAt: string
}

export interface DevicesList {
  devices: DeviceSummary[]
}

/** The server caps what it returns; this is what we ask for. */
const LIMIT = 100

export function deviceLabel(device: DeviceSummary): string {
  return device.name || device.type || device.id
}

/**
 * Devices, with trust and forget.
 *
 * Same shape as the sessions page. `devices.trust` gets no confirmation:
 * trusting a device grants nothing that revoking cannot undo, and a
 * confirmation on a non-destructive action trains people to click through
 * them. `devices.delete` ("Forget") is destructive and goes behind a
 * `ConfirmDialog` carrying `pending`.
 */
export function AuthDevicesPage() {
  const [userFilter, setUserFilter] = useState("")
  const [forgetting, setForgetting] = useState<DeviceSummary | null>(null)

  const list = useQuery<DevicesList>("devices.list", {
    userId: userFilter || undefined,
    limit: LIMIT,
  })
  const trust = useCommand<AckResponse>("devices.trust")
  const remove = useCommand<AckResponse>("devices.delete")

  async function confirmForget() {
    if (!forgetting) return
    const result = await remove.execute({ id: forgetting.id })
    if (result !== undefined) setForgetting(null)
  }

  const columns: Column<DeviceSummary>[] = [
    { id: "name", header: "Device", cell: (d) => deviceLabel(d) },
    { id: "userId", header: "User", cell: (d) => d.userId, className: "font-mono text-xs" },
    { id: "browser", header: "Browser", cell: (d) => d.browser || "–" },
    { id: "os", header: "OS", cell: (d) => d.os || "–" },
    { id: "ipAddress", header: "IP", cell: (d) => d.ipAddress || "–", className: "font-mono text-xs" },
    {
      id: "trusted",
      header: "Trusted",
      cell: (d) => (
        <Badge variant={d.trusted ? "outline" : "secondary"}>
          {d.trusted ? "trusted" : "untrusted"}
        </Badge>
      ),
    },
    { id: "lastSeenAt", header: "Last seen", cell: (d) => formatTimestamp(d.lastSeenAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Devices" description={`Showing the most recent ${LIMIT}.`} />
      <FilterBar
        search={{
          value: userFilter,
          onChange: setUserFilter,
          label: "Filter by user",
          placeholder: "User id",
        }}
      />
      <CommandAlert error={trust.error} title="Could not trust the device" />

      <QueryBoundary title="Devices" query={list} skeletonRows={5}>
        {(data) => {
          const devices = data.devices ?? []

          return (
            <ResourceTable<DeviceSummary>
              columns={columns}
              rows={devices}
              rowKey={(d) => d.id}
              caption={
                devices.length > 0
                  ? `${devices.length} ${devices.length === 1 ? "device" : "devices"}`
                  : undefined
              }
              emptyMessage="No devices seen."
              rowActions={(device) => (
                <>
                  <a
                    href={`/@auth/devices/${device.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </a>
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
                    onClick={() => setForgetting(device)}
                  >
                    Forget
                  </Button>
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      {/*
        The forget error lives inside the dialog's description, not above the
        table: Base UI marks everything outside an open AlertDialog `inert`
        and `aria-hidden`, so an alert rendered outside it is unreachable for
        as long as the dialog that can fail is open.
      */}
      <ConfirmDialog
        open={forgetting !== null}
        onOpenChange={(open) => !open && setForgetting(null)}
        title={`Forget ${forgetting ? deviceLabel(forgetting) : ""}?`}
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
    </section>
  )
}
