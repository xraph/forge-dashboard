import { useState, type ComponentType } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { ErasureListResponse, ErasureSummary } from "../types"
import { ErasureStatusBadge, KeyBadge } from "../badges"
import { ErasureRequestDialog } from "../components/erasure-request-dialog"
import { formatSeq, pageOf } from "../format"

const PAGE = 50

const columns: Column<ErasureSummary>[] = [
  {
    id: "id",
    header: "Erasure",
    cell: (e) => (
      <PluginLink
        to={`/erasures/${encodeURIComponent(e.id)}`}
        className="font-mono text-xs"
      >
        {e.id}
      </PluginLink>
    ),
  },
  {
    id: "subject",
    header: "Subject",
    cell: (e) => <span className="font-mono text-xs">{e.subjectId}</span>,
  },
  {
    id: "reason",
    header: "Reason",
    cell: (e) => (
      <span
        className="line-clamp-2 max-w-sm whitespace-pre-line"
        title={e.reason}
      >
        {e.reason}
      </span>
    ),
  },
  {
    id: "by",
    header: "Requested by",
    cell: (e) =>
      e.requestedBy ? (
        <span className="font-mono text-xs">{e.requestedBy}</span>
      ) : (
        <NoneCell label="requester" />
      ),
  },
  {
    id: "events",
    header: "Events",
    align: "end",
    cell: (e) => formatSeq(e.eventsAffected),
  },
  {
    id: "status",
    header: "Status",
    cell: (e) => <ErasureStatusBadge erasure={e} />,
  },
  { id: "key", header: "Key", cell: (e) => <KeyBadge erasure={e} /> },
  {
    id: "created",
    header: "Requested",
    cell: (e) => <Timestamp value={e.createdAt} label="request time" />,
  },
]

export const ErasuresPage: ComponentType<PluginPageProps> = () => {
  const [offset, setOffset] = useState(0)
  const [requesting, setRequesting] = useState(false)
  const q = useQuery<ErasureListResponse>("erasures.list", {
    limit: PAGE,
    offset,
  })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Erasures"
        description="An erasure destroys a data subject's encryption key in this scope, so their sealed fields can no longer be read. The events stay in the chain. Status and Key say how far each one got."
        actions={
          <Button onClick={() => setRequesting(true)}>
            Request an erasure
          </Button>
        }
      />
      <QueryBoundary title="erasures" query={q} skeletonRows={6}>
        {(data) => (
          <ResourceTable
            columns={columns}
            rows={data.erasures}
            rowKey={(e) => e.id}
            caption={pageOf(
              data.erasures.length,
              data.total,
              "erasure",
              "erasures"
            )}
            emptyMessage="No erasures have been requested in this scope."
            pagination={{
              page: offset / PAGE + 1,
              pageSize: PAGE,
              total: data.total,
            }}
            onPageChange={(page) => setOffset((page - 1) * PAGE)}
          />
        )}
      </QueryBoundary>
      <ErasureRequestDialog open={requesting} onOpenChange={setRequesting} />
    </section>
  )
}
