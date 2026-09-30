import type { ComponentType } from "react"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { ErasureSummary } from "../types"
import { KeyBadge } from "../badges"
import { formatSeq } from "../format"

export const ErasureDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const q = useQuery<ErasureSummary>("erasures.detail", { id })
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={id} description="A data subject's encryption key was destroyed in this scope, so their sealed fields can no longer be read." />
      <QueryBoundary title="erasure" query={q} skeletonRows={5}>
        {(e) => (
          <div className="flex flex-col gap-6">
            <DescriptionList
              items={[
                { term: "Erasure", value: <span className="font-mono text-xs">{e.id}</span> },
                { term: "Subject", value: <span className="font-mono text-xs">{e.subjectId}</span> },
                { term: "Reason", value: <span className="whitespace-pre-line">{e.reason}</span> },
                { term: "Requested by", value: e.requestedBy ? <span className="font-mono text-xs">{e.requestedBy}</span> : <NoneCell label="requester" /> },
                { term: "Events erased", value: formatSeq(e.eventsAffected) },
                { term: "Key", value: <KeyBadge destroyed={e.keyDestroyed} /> },
                { term: "Requested", value: <Timestamp value={e.createdAt} label="request time" /> },
              ]}
            />
            {!e.keyDestroyed && (
              <p className="max-w-prose text-sm">
                The key was kept because events in another scope still use it. This erasure's events are marked erased and unreadable; the key is destroyed the first time an erasure finds no other scope using it.
              </p>
            )}
            <PluginLink to="/erasures" className="text-sm underline underline-offset-4">
              Back to erasures
            </PluginLink>
          </div>
        )}
      </QueryBoundary>
    </section>
  )
}
