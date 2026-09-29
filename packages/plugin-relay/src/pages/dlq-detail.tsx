import { useState } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { JsonView } from "../components/json-view"
import { describeStatus } from "../lib/format"
import type { Ack, DLQEntryDetail } from "../types"
import { ReplayDialog } from "./dlq"

export function RelayDLQDetailPage({ params }: PluginPageProps) {
  if (!params.id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No dead letter selected.
      </p>
    )
  }
  return <DLQDetailView id={params.id} />
}

/** One dead letter: what failed, and the payload a replay would send again. */
function DLQDetailView({ id }: { id: string }) {
  const query = useQuery<DLQEntryDetail>("dlq.detail", { id })
  const replay = useCommand<Ack>("dlq.replay")
  const [confirming, setConfirming] = useState(false)
  const [replayed, setReplayed] = useState(false)

  async function confirm() {
    const ok = await replay.execute({ id })
    if (ok === undefined) return
    setConfirming(false)
    setReplayed(true)
  }

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Dead letter" query={query} skeletonRows={6}>
        {(e) => (
          <>
            <PageHeader
              title={e.eventType}
              description={`Failed after ${e.attemptCount} ${e.attemptCount === 1 ? "attempt" : "attempts"} to ${e.url}`}
              actions={
                e.replayedAt ? null : (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      replay.reset()
                      setConfirming(true)
                    }}
                  >
                    Replay
                  </Button>
                )
              }
            />
            {replayed && (
              <p role="status" className="rounded-md border px-3 py-2 text-sm">
                Replayed. A new delivery is queued.
              </p>
            )}
            <DetailLayout
              main={
                <section
                  aria-labelledby="payload-heading"
                  className="flex flex-col gap-2"
                >
                  <h2 id="payload-heading" className="text-sm font-medium">
                    Payload
                  </h2>
                  <JsonView value={e.payload} label="payload" />
                </section>
              }
              aside={
                <DescriptionList
                  items={[
                    {
                      term: "Replayed",
                      value: e.replayedAt ? (
                        <Badge variant="secondary">
                          <Timestamp value={e.replayedAt} label="replay time" />
                        </Badge>
                      ) : (
                        <NoneCell label="replay yet" />
                      ),
                    },
                    {
                      term: "Last response",
                      value: describeStatus(e.lastStatusCode),
                    },
                    {
                      term: "Error",
                      value: e.error ? (
                        <span className="font-mono text-xs break-all">
                          {e.error}
                        </span>
                      ) : (
                        <NoneCell label="error recorded" />
                      ),
                    },
                    {
                      term: "Delivery",
                      value: (
                        <PluginLink
                          to={`/deliveries/${e.deliveryId}`}
                          className="font-mono text-xs underline underline-offset-4"
                        >
                          {e.deliveryId}
                        </PluginLink>
                      ),
                    },
                    {
                      term: "Event",
                      value: (
                        <PluginLink
                          to={`/events/${e.eventId}`}
                          className="font-mono text-xs underline underline-offset-4"
                        >
                          {e.eventId}
                        </PluginLink>
                      ),
                    },
                    {
                      term: "Tenant",
                      value: (
                        <span className="font-mono text-xs">{e.tenantId}</span>
                      ),
                    },
                    {
                      term: "Failed",
                      value: (
                        <Timestamp value={e.failedAt} label="failure time" />
                      ),
                    },
                  ]}
                />
              }
            />
            <ReplayDialog
              entry={e}
              open={confirming}
              onOpenChange={setConfirming}
              replay={replay}
              onConfirm={() => void confirm()}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
