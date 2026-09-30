import type { ComponentType } from "react"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { CheckpointSummary, GetCheckpointResponse, StreamListResponse, StreamSummary } from "../types"
import { formatSeq } from "../format"

/**
 * A server older than CheckpointSummary.streamId does not say which chain owns
 * a checkpoint, so the owner is inferred from the chains this scope can see.
 * A chain whose latest checkpoint is this one owns it outright. Otherwise a chain can only own a checkpoint it has grown to
 * cover, and if that leaves more than one, guessing would send the operator to
 * verify the wrong chain: better to say nothing.
 */
function owningChain(cp: CheckpointSummary, list: StreamListResponse | undefined): StreamSummary | undefined {
  const streams = list?.streams ?? []
  const exact = streams.find((s) => s.latestCheckpoint?.id === cp.id)
  if (exact) return exact
  // "Exactly one chain reaches it" is only a fact about the whole list. On a
  // truncated one the real owner may be past the page, so a lone candidate
  // proves nothing. A chain that takes no checkpoints cannot own one.
  if (!list || list.hasMore || list.total > streams.length) return undefined
  const reaching = streams.filter((s) => s.checkpointingConfigured && s.headSeq >= cp.toSeq)
  return reaching.length === 1 ? reaching[0] : undefined
}

export const CheckpointDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const q = useQuery<GetCheckpointResponse>("checkpoints.detail", { id })
  // The record names its own chain. Only a server that predates streamId
  // leaves the page to infer one, so only then is the chain list worth a read.
  const inferring = q.data !== undefined && !q.data.checkpoint.streamId
  const list = useQuery<StreamListResponse>("streams.list", { limit: 200 }, { enabled: inferring })
  // A failed chain list costs the verify link and nothing else, so only its
  // loading state joins the checkpoint's.
  const settled = { ...q, loading: q.loading || (q.data !== undefined && list.loading) }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={id} description="A signed statement of how far the chain had reached when it was taken." />
      <QueryBoundary title="checkpoint" query={settled} skeletonRows={4}>
        {({ checkpoint: cp }) => {
          const ownerId = cp.streamId || owningChain(cp, list.data)?.id
          return (
            <div className="flex flex-col gap-6">
              <DescriptionList
                items={[
                  { term: "Sequences", value: <span className="font-mono text-xs">{`${formatSeq(cp.fromSeq)} to ${formatSeq(cp.toSeq)}`}</span> },
                  { term: "Events", value: formatSeq(cp.eventCount) },
                  { term: "Signing key", value: <span className="font-mono text-xs">{cp.signKeyId}</span> },
                  { term: "Signed", value: <Timestamp value={cp.createdAt} label="signing time" /> },
                ]}
              />
              {ownerId ? (
                <PluginLink to={`/chain/${encodeURIComponent(ownerId)}/${cp.fromSeq}/${cp.toSeq}`} className="text-sm underline underline-offset-4">
                  {`Verify sequences ${formatSeq(cp.fromSeq)} to ${formatSeq(cp.toSeq)}`}
                </PluginLink>
              ) : (
                <PluginLink to="/checkpoints" className="text-sm underline underline-offset-4">
                  Back to checkpoints
                </PluginLink>
              )}
            </div>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
