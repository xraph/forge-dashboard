import { useState, type ComponentType } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { ArchiveListResponse, ArchiveSummary } from "../types"
import { formatSeq } from "../format"
import { categoryLabel } from "../policy"

const PAGE = 50

const columns: Column<ArchiveSummary>[] = [
  { id: "id", header: "Archive", cell: (a) => <span className="font-mono text-xs">{a.id}</span> },
  { id: "policy", header: "Policy", cell: (a) => <span className="font-mono text-xs">{a.policyId}</span> },
  { id: "category", header: "Category", cell: (a) => categoryLabel(a.category) },
  { id: "events", header: "Events", align: "end", cell: (a) => formatSeq(a.eventCount) },
  { id: "from", header: "From", cell: (a) => <Timestamp value={a.fromTimestamp} label="start time" /> },
  { id: "to", header: "To", cell: (a) => <Timestamp value={a.toTimestamp} label="end time" /> },
  { id: "sink", header: "Sink", cell: (a) => a.sinkName },
  { id: "ref", header: "Sink ref", cell: (a) => (a.sinkRef ? <span className="font-mono text-xs">{a.sinkRef}</span> : <NoneCell label="sink reference" />) },
  { id: "tenant", header: "Tenant", cell: (a) => (a.tenantId ? <span className="font-mono text-xs">{a.tenantId}</span> : "App level") },
  { id: "created", header: "Created", cell: (a) => <Timestamp value={a.createdAt} label="creation time" /> },
]

export const ArchivesPage: ComponentType<PluginPageProps> = () => {
  const [offset, setOffset] = useState(0)
  const q = useQuery<ArchiveListResponse>("retention.archives", { limit: PAGE, offset })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Archives"
        description="Events a retention run wrote to an archive sink before removing them."
      />
      <QueryBoundary title="archives" query={q} skeletonRows={5}>
        {(data) => (
          <>
            <ResourceTable
              columns={columns}
              rows={data.archives}
              rowKey={(a) => a.id}
              caption={`${formatSeq(data.archives.length)} archives shown`}
              emptyMessage="No retention run has archived anything yet."
            />
            {/* The store keeps no count, so there is no "page 2 of N": only whether another page exists. */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Previous page
              </Button>
              <Button variant="outline" disabled={!data.hasMore} onClick={() => setOffset(offset + PAGE)}>
                Next page
              </Button>
            </div>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
