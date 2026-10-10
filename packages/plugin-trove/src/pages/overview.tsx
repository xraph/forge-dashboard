import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@forge-go/dashboard-kit/components/alert"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { FlagStateBadge, HealthBadge } from "../badges"
import { Bytes } from "../components/bytes"
import { StorePicker } from "../components/store-picker"
import { useActiveStore, withStore } from "../store"
import type { FlagStatus, SystemStatus } from "../types"

const FLAG_LABELS: Record<string, string> = {
  encryption: "Encryption",
  compression: "Compression",
  scanning: "Content scanning",
  cas: "Content-addressable storage",
}

const flagColumns: Column<FlagStatus>[] = [
  {
    id: "name",
    header: "Protection",
    className: "font-medium",
    cell: (f) => FLAG_LABELS[f.name] ?? f.name,
  },
  { id: "state", header: "State", cell: (f) => <FlagStateBadge flag={f} /> },
  {
    id: "note",
    header: "What it means",
    cell: (f) =>
      f.note ? (
        <span className="block max-w-sm text-sm whitespace-normal">
          {f.note}
        </span>
      ) : (
        <NoneCell label="note" />
      ),
  },
]

type CapabilityKey = keyof SystemStatus["capabilities"]

/** What each capability means for the operator, both ways. */
const CAPABILITIES: {
  key: CapabilityKey
  label: string
  yes: string
  no: string
}[] = [
  {
    key: "folders",
    label: "Folders",
    yes: "Listings group keys into folders.",
    no: "Listings are flat: this driver does not report folders.",
  },
  {
    key: "presign",
    label: "Presigned links",
    yes: "Share links can be offered where no middleware applies. GCS and Azure also need signing credentials.",
    no: "No share links: this driver cannot sign one.",
  },
  {
    key: "multipart",
    label: "Multipart uploads",
    yes: "The driver accepts uploads in parts.",
    no: "No multipart uploads.",
  },
  {
    key: "range",
    label: "Range reads",
    yes: "The driver can read part of an object.",
    no: "No range reads.",
  },
  {
    key: "serverCopy",
    label: "Server-side copy",
    yes: "The driver can copy inside the backend. Trove's copy does not use it yet.",
    no: "No server-side copy.",
  },
  {
    key: "versioning",
    label: "Versioning",
    yes: "The driver can keep object versions.",
    no: "No object versions.",
  },
  {
    key: "lifecycle",
    label: "Lifecycle rules",
    yes: "The driver can apply lifecycle rules.",
    no: "No lifecycle rules.",
  },
  {
    key: "notification",
    label: "Change notifications",
    yes: "The driver can send change notifications.",
    no: "No change notifications.",
  },
]

function protectionCaption(n: number): string {
  return `${n} ${n === 1 ? "protection" : "protections"}`
}

export const OverviewPage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const status = useQuery<SystemStatus>("system.status", withStore(store, {}))

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Overview"
        description="What this store's driver can do, and which protections are actually switched on."
        actions={<StorePicker />}
      />

      <QueryBoundary title="Store status" query={status} skeletonRows={6}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Driver</span>
              <span className="font-mono text-xs font-medium">
                {data.driver}
              </span>
              <HealthBadge ok={data.health.ok} />
              {data.health.error ? (
                <span className="text-destructive">{data.health.error}</span>
              ) : null}
            </div>

            {data.routingNote ? (
              <Alert>
                <AlertTitle>Some keys go to other backends</AlertTitle>
                <AlertDescription className="flex min-w-0 flex-col gap-2">
                  <span>{data.routingNote}</span>
                  <TagList values={data.backends} label="other backends" />
                </AlertDescription>
              </Alert>
            ) : null}

            <section className="flex min-w-0 flex-col gap-2">
              <h2 className="text-sm font-medium">Protection</h2>
              <p className="text-sm text-muted-foreground">
                Configured is what the config asks for. Applied means it runs
                when objects are written, now. Neither says how earlier writes
                were stored. Scanning has no config switch, so its Configured
                follows what is registered.
              </p>
              <ResourceTable<FlagStatus>
                columns={flagColumns}
                rows={data.flags}
                rowKey={(f) => f.name}
                caption={protectionCaption(data.flags.length)}
                emptyMessage="This store reports no protections."
              />
            </section>

            <section className="flex min-w-0 flex-col gap-2">
              <h2 className="text-sm font-medium">What this driver can do</h2>
              <DescriptionList
                items={CAPABILITIES.map((c) => ({
                  term: c.label,
                  value: data.capabilities[c.key] ? c.yes : c.no,
                }))}
              />
            </section>

            <section className="flex min-w-0 flex-col gap-2">
              <h2 className="text-sm font-medium">Configuration</h2>
              <DescriptionList
                items={[
                  {
                    term: "Default bucket",
                    value: data.config.defaultBucket ? (
                      <span className="font-mono text-xs">
                        {data.config.defaultBucket}
                      </span>
                    ) : (
                      <NoneCell label="default bucket" />
                    ),
                  },
                  {
                    term: "Chunk size",
                    value: <Bytes value={data.config.chunkSize} />,
                  },
                  {
                    term: "Stream pool",
                    value: `${data.config.poolSize} streams at once`,
                  },
                  {
                    term: "Upload limit",
                    value: <Bytes value={data.config.maxUploadBytes} />,
                  },
                  {
                    term: "ETags",
                    value: data.etagIsContentHash
                      ? "Change when the content changes."
                      : "Set by the driver. Two keys with the same ETag may hold different bytes.",
                  },
                  {
                    term: "Content links",
                    value:
                      data.contentSecret === "configured"
                        ? "Signed with the configured key."
                        : "Signed with a key generated at start. Links only work on the instance that made them, so set dashboard_content_secret when you run more than one.",
                  },
                ]}
              />
            </section>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
