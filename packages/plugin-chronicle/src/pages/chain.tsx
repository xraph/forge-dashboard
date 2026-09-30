import { useState, type ComponentType } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { MineResponse, StreamListResponse, StreamSummary, VerifyResponse } from "../types"
import { CoverageBadge } from "../badges"
import { formatSeq, shortHash } from "../format"
import { ChainPicker, chainLabel } from "../components/chain-picker"
import { Certificate } from "../verification/certificate"
import { clampToHead, defaultWindow, exceedsCap, parseRangeParams, wholeChain, DEFAULT_WINDOW, type SeqRange } from "../verification/window"

export const ChainPage: ComponentType<PluginPageProps> = ({ params }) => {
  const streamId = params.streamId
  const mine = useQuery<MineResponse>("streams.mine", streamId ? { streamId } : {})
  const list = useQuery<StreamListResponse>("streams.list", { limit: 200 })
  const streams = list.data?.streams ?? []

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Chain"
        description="The hash chain your audit events are recorded in, and whether it has been altered."
        actions={streams.length > 1 ? <ChainPicker streams={streams} selectedId={mine.data?.stream?.id} basePath="/chain" /> : undefined}
      />
      <QueryBoundary title="chain" query={mine} skeletonRows={4}>
        {(m) =>
          m.stream ? (
            <ChainBody
              key={`${m.stream.id}-${params.fromSeq ?? ""}-${params.toSeq ?? ""}`}
              stream={m.stream}
              deepLink={parseRangeParams(params.fromSeq, params.toSeq)}
            />
          ) : (
            <NoOwnChain streams={streams} />
          )
        }
      </QueryBoundary>
    </section>
  )
}

function NoOwnChain({ streams }: { streams: StreamSummary[] }) {
  if (streams.length === 0) {
    return <p className="text-sm">This scope has not recorded any events yet, so there is no chain to show.</p>
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>This app has no app-level chain: its events are recorded under its tenants. Choose a tenant's chain to verify.</p>
      <ChainPicker streams={streams} basePath="/chain" />
    </div>
  )
}

function ChainBody({ stream, deepLink }: { stream: StreamSummary; deepLink: SeqRange | null }) {
  const head = stream.headSeq
  // The verifier reports a head mismatch on an intact chain when asked for a
  // range that ends past the head, so a deep link is held to the head before
  // anything runs, and one that starts past it runs nothing.
  const linked = deepLink ? clampToHead(deepLink, head) : null
  const initial = linked ?? deepLink ?? defaultWindow(head)
  const [from, setFrom] = useState(String(initial?.fromSeq ?? ""))
  const [to, setTo] = useState(String(initial?.toSeq ?? ""))
  // A deep link is the operator asking: it runs at once. Otherwise nothing runs until a button is pressed.
  const [requested, setRequested] = useState<SeqRange | null>(linked)

  const verify = useQuery<VerifyResponse>(
    "verify.run",
    requested ? { streamId: stream.id, fromSeq: requested.fromSeq, toSeq: requested.toSeq } : {},
    { enabled: requested !== null },
  )

  const whole = wholeChain(head)
  const wholeTooBig = whole !== null && exceedsCap(whole)
  const recent = defaultWindow(head)

  const typed = parseRangeParams(from, to)
  const pastHead = typed !== null && typed.toSeq > head
  const runnable = typed !== null && !pastHead

  const runTyped = () => {
    if (runnable) setRequested(typed)
  }

  return (
    <div className="flex flex-col gap-8">
      <Posture stream={stream} />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          runTyped()
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span>From sequence</span>
          <Input aria-label="From sequence" className="w-36 font-mono text-xs" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>To sequence</span>
          <Input
            aria-label="To sequence"
            aria-invalid={pastHead || undefined}
            aria-describedby={pastHead ? "chain-head-note" : undefined}
            className="w-36 font-mono text-xs"
            inputMode="numeric"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={!runnable}>
          Check this range
        </Button>
        <Button type="button" variant="outline" disabled={whole === null || wholeTooBig} onClick={() => whole && setRequested(whole)}>
          Check the whole chain
        </Button>
        {pastHead && (
          <p id="chain-head-note" className="basis-full text-sm">
            {`The chain's head is at sequence ${formatSeq(head)}.`}
          </p>
        )}
        {wholeTooBig && (
          <p className="basis-full text-sm text-muted-foreground">
            {`The whole chain is ${formatSeq(head)} sequences. Verification checks at most 100,000 sequences at a time, because it holds every event in the range in memory.`}
          </p>
        )}
      </form>
      {requested && verify.loading && !verify.data && <p className="text-sm text-muted-foreground">Checking the chain...</p>}
      {requested && verify.error && (
        <div className="flex flex-col gap-2">
          <CommandAlert title="The chain could not be checked" error={verify.error} />
          {verify.error.code === "BAD_REQUEST" && recent && (
            <Button type="button" variant="outline" className="self-start" onClick={() => setRequested(recent)}>
              {`Check the most recent ${formatSeq(DEFAULT_WINDOW)} instead`}
            </Button>
          )}
        </div>
      )}
      {requested && verify.data && <Certificate response={verify.data} checkpointingConfigured={stream.checkpointingConfigured} />}
    </div>
  )
}

function Posture({ stream }: { stream: StreamSummary }) {
  const cp = stream.latestCheckpoint
  const behind = cp ? stream.headSeq - cp.toSeq : 0
  return (
    <DescriptionList
      items={[
        { term: "Chain", value: <span>{chainLabel(stream)} <span className="font-mono text-xs text-muted-foreground">{stream.id}</span></span> },
        { term: "Head", value: <span className="font-mono text-xs">{formatSeq(stream.headSeq)}</span> },
        { term: "Head hash", value: <span className="font-mono text-xs" title={stream.headHash}>{shortHash(stream.headHash)}</span> },
        {
          term: "Digest scheme",
          value: (
            <span>
              <span className="font-mono text-xs">{stream.scheme}</span>
              {stream.schemeSince > 1 ? (
                <>
                  {" from sequence "}
                  <span className="font-mono text-xs">{formatSeq(stream.schemeSince)}</span>
                </>
              ) : null}
            </span>
          ),
        },
        {
          term: "Latest checkpoint",
          value: !stream.checkpointingConfigured ? (
            <span className="text-muted-foreground">This deployment takes no checkpoints</span>
          ) : cp ? (
            <span>
              <span className="font-mono text-xs">{formatSeq(cp.toSeq)}</span>
              {behind > 0 ? `, ${formatSeq(behind)} events behind the head` : ", at the head"}
            </span>
          ) : (
            <span className="text-muted-foreground">None yet</span>
          ),
        },
        {
          term: "Best this chain can reach",
          value: <CoverageBadge level={stream.coverageCeiling} />,
        },
      ]}
    />
  )
}
