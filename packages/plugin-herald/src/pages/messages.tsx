import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { MessageStatusBadge } from "../badges"
import { CursorPager, useCursorStack } from "../components/cursor-pager"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { plural, statusLabel, WRITTEN_STATUSES } from "../format"
import { messagePath } from "../keys"
import type { MessageSummary, MessagesListResponse } from "../wire"

const PAGE_SIZE = 25

/** A send always records its provider, so none on anything but a suppressed message means it was deleted. */
function ProviderCell({ m }: { m: MessageSummary }) {
  if (m.provider)
    return (
      <>
        {m.provider.name || (
          <span className="font-mono text-xs">{m.provider.id}</span>
        )}
      </>
    )
  if (m.status === "suppressed") return <NoneCell label="provider" />
  return (
    <span>
      <NoneCell label="provider" />{" "}
      <span className="text-muted-foreground">(no longer exists)</span>
    </span>
  )
}

const columns: Column<MessageSummary>[] = [
  {
    id: "id",
    header: "ID",
    className: "font-mono text-xs",
    cell: (m) => <PluginLink to={messagePath(m.id)}>{m.id}</PluginLink>,
  },
  {
    id: "recipient",
    header: "Recipient",
    className: "font-medium",
    cell: (m) => m.recipient,
  },
  { id: "channel", header: "Channel", cell: (m) => m.channel },
  {
    id: "status",
    header: "Status",
    cell: (m) => <MessageStatusBadge status={m.status} />,
  },
  {
    id: "template",
    header: "Template",
    cell: (m) =>
      m.templateSlug ? (
        <span className="font-mono text-xs">{m.templateSlug}</span>
      ) : (
        <NoneCell label="template" />
      ),
  },
  { id: "provider", header: "Provider", cell: (m) => <ProviderCell m={m} /> },
  {
    id: "created",
    header: "Created",
    cell: (m) => <Timestamp value={m.createdAt} label="creation time" />,
  },
]

export const MessagesPage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  const pager = useCursorStack()
  const [channel, setChannel] = useState("")
  const [status, setStatus] = useState("")

  // Absent, never "": params are the query's cache key.
  const params: Record<string, unknown> = { limit: PAGE_SIZE }
  if (channel) params.channel = channel
  if (status) params.status = status
  if (pager.cursor) params.cursor = pager.cursor
  const list = useQuery<MessagesListResponse>("messages.list", params)

  // A cursor belongs to the search that issued it, so every filter change
  // goes back to the first page.
  const change = (set: (v: string) => void) => (v: string) => {
    set(v)
    pager.reset()
  }
  const filtered = channel !== "" || status !== ""

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <HeraldHeader
        title="Messages"
        description="Every send Herald logged, newest first."
      />
      <FilterBar
        filters={[
          {
            id: "channel",
            label: "Channel",
            value: channel,
            onChange: change(setChannel),
            options: [
              { label: "All channels", value: "" },
              ...(info.data?.channels ?? []).map((c) => ({
                label: c,
                value: c,
              })),
            ],
          },
          {
            id: "status",
            label: "Status",
            value: status,
            onChange: change(setStatus),
            options: [
              { label: "All statuses", value: "" },
              ...WRITTEN_STATUSES.map((s) => ({
                label: statusLabel(s),
                value: s,
              })),
            ],
          },
        ]}
      />
      <p className="text-sm text-muted-foreground">
        Herald records sending, accepted, failed and suppressed. Delivered and
        bounced are never recorded, so a filter for them would always be empty.
      </p>
      <QueryBoundary title="Messages" query={list} skeletonRows={8}>
        {(data) => (
          <div className="flex min-w-0 flex-col gap-3">
            <ResourceTable<MessageSummary>
              columns={columns}
              rows={data.messages}
              rowKey={(m) => m.id}
              caption={`${plural(data.messages.length, "message")} on this page`}
              emptyMessage={
                pager.canGoBack
                  ? "Nothing further."
                  : filtered
                    ? "No messages match these filters."
                    : "Nothing has been sent in this app yet."
              }
            />
            <CursorPager
              shown={data.messages.length}
              nextCursor={data.nextCursor}
              onNext={pager.next}
              onPrevious={pager.previous}
              canGoBack={pager.canGoBack}
            />
          </div>
        )}
      </QueryBoundary>
    </section>
  )
}
