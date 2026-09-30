import { useState, type ComponentType, type ReactNode } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList, DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { EventDetail, MineResponse, VerifyEventResponse } from "../types"
import { ErasedBadge, OutcomeBadge, SeverityBadge } from "../badges"
import { formatSeq } from "../format"
import { JsonView } from "../components/json-view"
import { aroundSeq } from "../verification/window"

const ERASED = "[ERASED]"

/**
 * A value that reads "[ERASED]" proves an erasure only when the event says it
 * was erased and names the erasure. The literal text is not reserved: an app
 * can record it, and a key shared across scopes before chronicle scoped its
 * keys could leave it on an event with no erasure recorded here.
 */
function field(value: string | undefined, label: string, ev: EventDetail, mono = false): ReactNode {
  if (value === undefined || value === "") return <NoneCell label={label} />
  if (value === ERASED && !(ev.erased && ev.erasureId)) {
    return (
      <span>
        <span className="font-mono text-xs">{ERASED}</span>
        <span className="ml-2 text-muted-foreground">This value reads as erased, but no erasure in this scope is recorded for it.</span>
      </span>
    )
  }
  return mono ? <span className="font-mono text-xs">{value}</span> : value
}

export const EventDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const q = useQuery<EventDetail>("events.detail", { id })
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Event" description="One record, its place in the chain, and whether its own digest recomputes." />
      <QueryBoundary title="event" query={q} skeletonRows={8}>
        {(ev) => <Body key={ev.id} ev={ev} />}
      </QueryBoundary>
    </section>
  )
}

/**
 * Keyed by event id where it is rendered: `checking` is an operator's request
 * about one event, and must not carry over to the next one the route opens.
 */
function Body({ ev }: { ev: EventDetail }) {
  const [checking, setChecking] = useState(false)
  const verify = useQuery<VerifyEventResponse>("verify.event", { eventId: ev.id }, { enabled: checking })
  const chain = useQuery<MineResponse>("streams.mine", { streamId: ev.streamId })
  const head = chain.data?.stream?.headSeq
  const around = head !== undefined ? aroundSeq(ev.sequence, head) : null

  return (
    <DetailLayout
      main={
        <div className="flex flex-col gap-6">
          <DescriptionList
            items={[
              { term: "Event", value: <span className="font-mono text-xs">{ev.id}</span> },
              { term: "Action", value: <span className="font-medium">{ev.action}</span> },
              { term: "Resource", value: <span>{ev.resource} {field(ev.resourceId, "resource id", ev, true)}</span> },
              { term: "Category", value: ev.category },
              { term: "Outcome", value: <OutcomeBadge outcome={ev.outcome} /> },
              { term: "Severity", value: <SeverityBadge severity={ev.severity} /> },
              { term: "Time", value: <Timestamp value={ev.timestamp} label="time" /> },
              {
                term: "User",
                value: ev.userId ? (
                  <PluginLink to={`/users/${encodeURIComponent(ev.userId)}`} className="font-mono text-xs underline underline-offset-4">
                    {ev.userId}
                  </PluginLink>
                ) : (
                  <NoneCell label="user" />
                ),
              },
              { term: "Subject", value: field(ev.subjectId, "subject", ev, true) },
              { term: "IP address", value: field(ev.ip, "IP address", ev, true) },
              { term: "User agent", value: field(ev.userAgent, "user agent", ev) },
              { term: "Reason", value: field(ev.reason, "reason", ev) },
              { term: "Request", value: field(ev.requestId, "request id", ev, true) },
              { term: "Session", value: field(ev.sessionId, "session id", ev, true) },
            ]}
          />
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Metadata</h2>
            <JsonView value={ev.metadata} label="metadata" />
          </div>
        </div>
      }
      aside={
        <div className="flex flex-col gap-4 text-sm">
          {ev.erased && ev.erasureId ? (
            <div className="flex flex-col items-start gap-1">
              <ErasedBadge />
              <span>
                {"Erased by "}
                <PluginLink to={`/erasures/${encodeURIComponent(ev.erasureId)}`} className="font-mono text-xs underline underline-offset-4">
                  {ev.erasureId}
                </PluginLink>
              </span>
              <Timestamp value={ev.erasedAt} label="erasure time" />
            </div>
          ) : null}
          <DescriptionList
            items={[
              { term: "Sequence", value: <span className="font-mono text-xs">{formatSeq(ev.sequence)}</span> },
              { term: "Hash", value: <span className="font-mono text-xs break-all">{ev.hash}</span> },
              { term: "Previous hash", value: <span className="font-mono text-xs break-all">{ev.prevHash}</span> },
              { term: "Digest scheme", value: field(ev.hashScheme, "digest scheme", ev, true) },
              { term: "Key id", value: field(ev.hashKeyId, "key id", ev, true) },
              { term: "Chain", value: <span className="font-mono text-xs">{ev.streamId}</span> },
            ]}
          />
          <Button variant="outline" className="self-start" onClick={() => (checking ? verify.refetch() : setChecking(true))} disabled={checking && verify.loading}>
            Check this event's digest
          </Button>
          {verify.error && <CommandAlert title="The digest could not be checked" error={verify.error} />}
          {verify.data && <DigestResult r={verify.data} />}
          {around && (
            <PluginLink
              to={`/chain/${encodeURIComponent(ev.streamId)}/${around.fromSeq}/${around.toSeq}`}
              className="underline underline-offset-4"
            >
              Check the chain around this event
            </PluginLink>
          )}
        </div>
      }
    />
  )
}

/**
 * verify.event checks one event's digest against its own claimed predecessor,
 * never its link to the event before it. What `valid` can and cannot say is
 * stated with the answer, every time.
 */
function DigestResult({ r }: { r: VerifyEventResponse }) {
  const scope = "This checks the event's own digest, not its place in the chain."
  if (!r.valid) {
    return (
      <p className="text-destructive">
        This event's digest does not recompute: its content was changed, or it claims a weaker scheme than the chain required.
        Check the chain around it to tell which. <span className="text-foreground">{scope}</span>
      </p>
    )
  }
  if (!r.keyed) {
    return (
      <p>
        This event's digest recomputes. It is unkeyed, so it does not rule out a rewrite by someone who can write the database. {scope}
      </p>
    )
  }
  return <p>This event's digest recomputes under a keyed scheme. {scope}</p>
}

export default EventDetailPage
