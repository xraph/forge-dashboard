import { useState, type ComponentType } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { CheckpointListResponse, CheckpointSummary, MineResponse, StreamListResponse, StreamSummary, TakeCheckpointResponse } from "../types"
import { formatSeq } from "../format"
import { ChainPicker } from "../components/chain-picker"
import { DialogError } from "../components/dialog-error"

const PAGE = 50

const columns: Column<CheckpointSummary>[] = [
  {
    id: "id",
    header: "Checkpoint",
    cell: (c) => (
      <PluginLink to={`/checkpoint/${encodeURIComponent(c.id)}`} className="font-mono text-xs">
        {c.id}
      </PluginLink>
    ),
  },
  {
    id: "range",
    header: "Sequences",
    cell: (c) => <span className="font-mono text-xs">{`${formatSeq(c.fromSeq)} to ${formatSeq(c.toSeq)}`}</span>,
  },
  { id: "count", header: "Events", align: "end", cell: (c) => formatSeq(c.eventCount) },
  { id: "key", header: "Signing key", cell: (c) => <span className="font-mono text-xs">{c.signKeyId}</span> },
  { id: "created", header: "Signed", cell: (c) => <Timestamp value={c.createdAt} label="signing time" /> },
]

/**
 * Keyed by chain so that choosing another chain starts on its first page with
 * no leftover result from the last chain's "take a checkpoint".
 */
export const CheckpointsPage: ComponentType<PluginPageProps> = (props) => (
  <CheckpointsView key={props.params.streamId ?? ""} streamId={props.params.streamId} />
)

function CheckpointsView({ streamId }: { streamId?: string }) {
  const [offset, setOffset] = useState(0)
  const mine = useQuery<MineResponse>("streams.mine", streamId ? { streamId } : {})
  const list = useQuery<StreamListResponse>("streams.list", { limit: 200 })
  // Without a chain in the route the list is only asked for once the scope is
  // known to have a chain of its own: an app-wide operator whose events sit
  // under tenants has nothing to list, and nothing a take could succeed on.
  const ownsChain = streamId !== undefined || mine.data?.stream !== undefined
  const q = useQuery<CheckpointListResponse>(
    "checkpoints.list",
    { ...(streamId ? { streamId } : {}), limit: PAGE, offset },
    { enabled: ownsChain },
  )
  const take = useCommand<TakeCheckpointResponse>("checkpoints.take")
  const streams = list.data?.streams ?? []
  const selected = streamId ?? mine.data?.stream?.id

  const listing = (
    <QueryBoundary title="checkpoints" query={q} skeletonRows={5}>
      {(data) => {
        if (!data.supported) {
          return (
            <p className="text-sm">
              This deployment stores no checkpoints. Without them, verification cannot detect events removed from the end of the chain.
            </p>
          )
        }
        // Older servers answered null rather than an empty list.
        const rows = data.checkpoints ?? []
        return (
          <>
            <ResourceTable
              columns={columns}
              rows={rows}
              rowKey={(c) => c.id}
              caption={`${rows.length} checkpoints shown`}
              emptyMessage="This chain has no checkpoints yet."
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
        )
      }}
    </QueryBoundary>
  )

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Checkpoints"
        description="Signed statements of how far the chain reached. A checkpoint proves the range it covers has not been rewritten or truncated since it was signed."
        actions={
          <div className="flex items-center gap-2">
            {ownsChain && streams.length > 1 && <ChainPicker streams={streams} selectedId={selected} basePath="/checkpoints/in" />}
            {ownsChain && q.data?.supported && (
              <Button
                disabled={take.loading}
                onClick={() => {
                  take.reset()
                  void take.execute(streamId ? { streamId } : {})
                }}
              >
                Take a checkpoint
              </Button>
            )}
          </div>
        }
      />
      {take.data?.checkpoint && (
        <p role="status" className="text-sm">
          Checkpoint <span className="font-mono text-xs">{take.data.checkpoint.id}</span>
          {` signed over sequences ${formatSeq(take.data.checkpoint.fromSeq)} to ${formatSeq(take.data.checkpoint.toSeq)}.`}
        </p>
      )}
      {take.data?.upToDate && (
        <p role="status" className="text-sm">
          Nothing new since the last checkpoint: the chain is already checkpointed to its head.
        </p>
      )}
      <DialogError what="take a checkpoint" error={take.error} />
      {streamId === undefined ? (
        <QueryBoundary title="chain" query={mine} skeletonRows={3}>
          {(m) => (m.stream ? listing : <NoOwnChain streams={streams} loading={list.loading} />)}
        </QueryBoundary>
      ) : (
        listing
      )}
    </section>
  )
}

/** Mirrors the Chain page: this app's events sit under its tenants, so one of their chains has to be chosen. */
function NoOwnChain({ streams, loading }: { streams: StreamSummary[]; loading: boolean }) {
  if (loading) return <p role="status" className="text-sm text-muted-foreground">Loading chains...</p>
  if (streams.length === 0) {
    return <p className="text-sm">This scope has not recorded any events yet, so there are no checkpoints.</p>
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>This app has no app-level chain: its events are recorded under its tenants. Choose a tenant's chain to see its checkpoints.</p>
      <ChainPicker streams={streams} basePath="/checkpoints/in" />
    </div>
  )
}
