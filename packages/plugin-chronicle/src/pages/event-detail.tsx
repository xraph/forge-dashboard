import { useState, type ComponentType, type ReactNode } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { EventDetail, MineResponse, VerifyEventResponse } from "../types"
import { ErasedBadge, OutcomeBadge, SeverityBadge } from "../badges"
import { formatSeq } from "../format"
import { JsonView } from "../components/json-view"
import { TenantValue } from "../components/tenant"
import { aroundSeq } from "../verification/window"

const ERASED = "[ERASED]"

/**
 * A value that reads "[ERASED]" proves an erasure only when the event says it
 * was erased and names the erasure. The literal text is not reserved: an app
 * can record it, and a key shared across scopes before chronicle scoped its
 * keys could leave it on an event with no erasure recorded here.
 */
function field(
  value: string | undefined,
  label: string,
  ev: EventDetail,
  mono = false
): ReactNode {
  if (value === undefined || value === "") return <NoneCell label={label} />
  if (value === ERASED && !(ev.erased && ev.erasureId)) {
    return (
      <span>
        <span className="font-mono text-xs">{ERASED}</span>
        <span className="ml-2 text-muted-foreground">
          This value reads as erased, but no erasure in this scope is recorded
          for it.
        </span>
      </span>
    )
  }
  return mono ? <span className="font-mono text-xs">{value}</span> : value
}

/** A hash or id: monospace, and selected whole on click so it can be copied. */
function Raw({ value, wrap = false }: { value: string; wrap?: boolean }) {
  return (
    <span className={`font-mono select-all text-xs${wrap ? "break-all" : ""}`}>
      {value}
    </span>
  )
}

/**
 * Only sequence 1 is the genesis event. A later event with no previous hash is
 * not a first event, and calling it one would explain away the thing a
 * verification exists to find.
 */
function previousHash(ev: EventDetail): ReactNode {
  if (ev.sequence === 1) {
    return (
      <span className="flex min-w-0 flex-col gap-1">
        <span>
          {ev.prevHash
            ? "Genesis event, the first in its chain."
            : "Genesis event, the first in its chain. Nothing precedes it."}
        </span>
        {ev.prevHash ? <Raw value={ev.prevHash} wrap /> : null}
      </span>
    )
  }
  if (!ev.prevHash) {
    return (
      <span>
        None recorded. Only a chain's first event has no previous hash, so check
        the chain around this event.
      </span>
    )
  }
  return <Raw value={ev.prevHash} wrap />
}

/**
 * The key the event's sealed fields were encrypted under. The row names it
 * and the digest does not cover it, so it is shown as the event's own claim.
 */
function encryptionKey(ev: EventDetail): ReactNode {
  if (ev.encryptionKeyId === undefined)
    return (
      <span className="text-muted-foreground">Not reported by this server</span>
    )
  if (ev.encryptionKeyId === "") return <NoneCell label="encryption key" />
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <Raw value={ev.encryptionKeyId} wrap />
      <span className="text-muted-foreground">
        As the event records it. The digest does not cover it, so nothing here
        verifies it.
      </span>
    </span>
  )
}

export const EventDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const q = useQuery<EventDetail>("events.detail", { id })
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Event"
        description="One record, its place in the chain, and whether its own digest recomputes."
      />
      <QueryBoundary title="event" query={q} skeletonRows={8}>
        {(ev) => <Body key={ev.id} ev={ev} />}
      </QueryBoundary>
      {/* Outside the boundary, so an event that cannot be read still has a way back. */}
      <PluginLink
        to="/events"
        className="self-start text-sm underline underline-offset-4"
      >
        Back to events
      </PluginLink>
    </section>
  )
}

/**
 * Keyed by event id where it is rendered: `checking` is an operator's request
 * about one event, and must not carry over to the next one the route opens.
 */
function Body({ ev }: { ev: EventDetail }) {
  const [checking, setChecking] = useState(false)
  const verify = useQuery<VerifyEventResponse>(
    "verify.event",
    { eventId: ev.id },
    { enabled: checking }
  )
  const chain = useQuery<MineResponse>("streams.mine", {
    streamId: ev.streamId,
  })
  const head = chain.data?.stream?.headSeq
  // An event outside 1 to the head has no window in this chain to check.
  const around =
    head !== undefined && ev.sequence > 0 && ev.sequence <= head
      ? aroundSeq(ev.sequence, head)
      : null

  return (
    <DetailLayout
      main={
        <div className="flex min-w-0 flex-col gap-4">
          <DescriptionList
            items={[
              { term: "Event", value: <Raw value={ev.id} /> },
              {
                term: "Action",
                value: <span className="font-medium">{ev.action}</span>,
              },
              {
                term: "Resource",
                value: (
                  <span>
                    {ev.resource}{" "}
                    {field(ev.resourceId, "resource id", ev, true)}
                  </span>
                ),
              },
              { term: "Category", value: ev.category },
              { term: "Outcome", value: <OutcomeBadge outcome={ev.outcome} /> },
              {
                term: "Severity",
                value: <SeverityBadge severity={ev.severity} />,
              },
              {
                term: "Time",
                value: <Timestamp value={ev.timestamp} label="time" />,
              },
              { term: "Tenant", value: <TenantValue tenantId={ev.tenantId} /> },
              {
                term: "User",
                value: ev.userId ? (
                  <PluginLink
                    to={`/users/${encodeURIComponent(ev.userId)}`}
                    className="font-mono text-xs underline underline-offset-4"
                  >
                    {ev.userId}
                  </PluginLink>
                ) : (
                  <NoneCell label="user" />
                ),
              },
              {
                term: "Subject",
                value: field(ev.subjectId, "subject", ev, true),
              },
              { term: "Encryption key", value: encryptionKey(ev) },
              {
                term: "IP address",
                value: field(ev.ip, "IP address", ev, true),
              },
              {
                term: "User agent",
                value: field(ev.userAgent, "user agent", ev),
              },
              { term: "Reason", value: field(ev.reason, "reason", ev) },
              {
                term: "Request",
                value: field(ev.requestId, "request id", ev, true),
              },
              {
                term: "Session",
                value: field(ev.sessionId, "session id", ev, true),
              },
            ]}
          />
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              Metadata
            </h2>
            {ev.erased && ev.metadata === undefined ? (
              // Erasure drops sealed metadata altogether, so "None" would say the event never had any.
              <p className="text-sm text-muted-foreground">
                Erased with the rest of this event's sealed fields.
              </p>
            ) : (
              <JsonView value={ev.metadata} label="metadata" />
            )}
          </div>
        </div>
      }
      aside={
        <div className="flex min-w-0 flex-col gap-4 text-sm">
          {ev.erased && ev.erasureId ? (
            <div className="flex min-w-0 flex-col items-start gap-1">
              <ErasedBadge />
              <span>
                {"Erased by "}
                <PluginLink
                  to={`/erasures/${encodeURIComponent(ev.erasureId)}`}
                  className="font-mono text-xs underline underline-offset-4"
                >
                  {ev.erasureId}
                </PluginLink>
              </span>
              <Timestamp value={ev.erasedAt} label="erasure time" />
            </div>
          ) : null}
          <DescriptionList
            items={[
              {
                term: "Sequence",
                value: (
                  <span className="font-mono text-xs">
                    {formatSeq(ev.sequence)}
                  </span>
                ),
              },
              { term: "Hash", value: <Raw value={ev.hash} wrap /> },
              { term: "Previous hash", value: previousHash(ev) },
              {
                term: "Digest scheme",
                value: field(ev.hashScheme, "digest scheme", ev, true),
              },
              {
                term: "Key id",
                value: field(ev.hashKeyId, "key id", ev, true),
              },
              { term: "Chain", value: <Raw value={ev.streamId} /> },
            ]}
          />
          <Button
            variant="outline"
            className="self-start"
            onClick={() => (checking ? verify.refetch() : setChecking(true))}
            disabled={checking && verify.loading}
          >
            Check this event's digest
          </Button>
          {/* The store keeps the last answer while it reloads, and an answer is only this check's once it settles. */}
          {checking && verify.loading && (
            <p className="text-muted-foreground">Checking the digest...</p>
          )}
          {!verify.loading && verify.error && (
            <CommandAlert
              title="The digest could not be checked"
              error={verify.error}
            />
          )}
          {!verify.loading && verify.data && <DigestResult r={verify.data} />}
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
  const scope =
    "This checks the event's own digest, not its place in the chain."
  if (!r.valid) {
    return (
      <p className="text-destructive">
        This event's digest does not recompute: its content was changed, or it
        claims a weaker scheme than the chain required. Check the chain around
        it to tell which. <span className="text-foreground">{scope}</span>
      </p>
    )
  }
  if (!r.keyed) {
    return (
      <p>
        This event's digest recomputes. It is unkeyed, so it does not rule out a
        rewrite by someone who can write the database. {scope}
      </p>
    )
  }
  return <p>This event's digest recomputes under a keyed scheme. {scope}</p>
}

export default EventDetailPage
