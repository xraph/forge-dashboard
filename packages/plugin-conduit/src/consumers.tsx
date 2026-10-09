import { useState } from "react"
import { useQuery, useCommand, usePoll } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  QueryBoundary,
  CommandAlert,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Input } from "@forge-go/dashboard-kit/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import type {
  ConsumerInfo,
  Backfill,
  BackfillInput,
  BackfillList,
  Latency,
} from "./types"

const latency = (v: Latency) =>
  v.count ? (
    `${(v.average / 1e6).toFixed(1)} / ${(v.max / 1e6).toFixed(1)} ms`
  ) : (
    <NoneCell label="attempts" />
  )
const columns: Column<ConsumerInfo>[] = [
  {
    id: "subscription",
    header: "Subscription",
    cell: (c) => <span className="font-medium">{c.subscription.id}</span>,
  },
  {
    id: "scope",
    header: "Pause scope",
    cell: (c) =>
      c.subscription.mode === "competing" ? "Service group" : "This subscriber",
  },
  {
    id: "state",
    header: "Intake",
    cell: (c) => (
      <Badge variant="outline">{c.paused ? "Paused" : "Active"}</Badge>
    ),
  },
  {
    id: "pending",
    header: "Pending",
    align: "end",
    cell: (c) => c.pending.toLocaleString(),
  },
  {
    id: "ack",
    header: "Unacknowledged",
    align: "end",
    cell: (c) => c.ackPending.toLocaleString(),
  },
  {
    id: "retry",
    header: "Redelivered",
    align: "end",
    cell: (c) => c.redelivered.toLocaleString(),
  },
  {
    id: "delivery",
    header: "Delivery avg / max",
    cell: (c) => latency(c.delivery),
  },
  {
    id: "processing",
    header: "Processing avg / max",
    cell: (c) => latency(c.processing),
  },
]
const jobColumns: Column<Backfill>[] = [
  {
    id: "id",
    header: "Operation",
    cell: (j) => (
      <span className="font-mono text-xs break-all">{j.input.id}</span>
    ),
  },
  { id: "sub", header: "Subscription", cell: (j) => j.input.subscription },
  {
    id: "range",
    header: "Range",
    cell: (j) => `${j.input.start}–${j.input.end}`,
  },
  {
    id: "state",
    header: "Status",
    cell: (j) => (
      <div>
        <Badge variant={j.state === "failed" ? "destructive" : "outline"}>
          {j.state}
        </Badge>
        {j.error && <p className="text-xs text-muted-foreground">{j.error}</p>}
      </div>
    ),
  },
  {
    id: "progress",
    header: "Published / skipped",
    cell: (j) => `${j.published} / ${j.skipped}`,
  },
  {
    id: "storage",
    header: "Progress storage",
    cell: (j) => (j.persisted ? "Durable" : "Process memory"),
  },
]
export function ConduitConsumersPage() {
  const query = useQuery<{ consumers: ConsumerInfo[] }>("consumers.list")
  usePoll(query.refetch)
  const [providerChoice, setProviderChoice] = useState("")
  const provider = providerChoice || query.data?.consumers[0]?.provider || ""
  const [cursors, setCursors] = useState<string[]>([""])
  const history = useQuery<BackfillList>(
    "backfills.list",
    { provider, cursor: cursors.at(-1) ?? "", limit: 25 },
    { enabled: provider !== "" }
  )
  usePoll(history.refetch)
  const [pauseTarget, setPauseTarget] = useState<ConsumerInfo | null>(null)
  const pause = useCommand<Record<string, never>>("consumers.pause")
  const resume = useCommand<Record<string, never>>("consumers.resume")
  const pauseCommand = pauseTarget?.paused ? resume : pause
  const run = useCommand<Backfill>("backfills.run")
  const [target, setTarget] = useState<ConsumerInfo | null>(null)
  const [input, setInput] = useState<BackfillInput>({
    id: "",
    subscription: "",
    start: 1,
    end: 1,
  })
  const valid =
    !!input.id &&
    Number.isSafeInteger(input.start) &&
    Number.isSafeInteger(input.end) &&
    input.start > 0 &&
    input.end >= input.start &&
    input.end - input.start < 100
  function select(c: ConsumerInfo, job?: Backfill) {
    run.reset()
    setTarget(c)
    setInput(
      job?.input ?? {
        id: crypto.randomUUID(),
        subscription: c.subscription.id,
        start: 1,
        end: 1,
      }
    )
  }
  async function changePause() {
    if (!pauseTarget) return
    const result = await pauseCommand.execute({
      subscription: pauseTarget.subscription.id,
    })
    if (result) {
      setPauseTarget(null)
      void query.refetch()
    }
  }
  async function backfill() {
    if (!valid) return
    const result = await run.execute(input)
    void history.refetch()
    void query.refetch()
    if (result) setTarget(null)
  }
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Consumers"
        description="Broker backlog and cursor controls. Latency averages and maxima count attempts on this instance."
      />
      <QueryBoundary title="Consumers" query={query}>
        {(data) => (
          <ResourceTable
            columns={columns}
            rows={data.consumers}
            rowKey={(c) => c.consumerID}
            density="compact"
            emptyMessage="No registered subscriptions."
            rowActions={(c) => (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    pause.reset()
                    resume.reset()
                    setPauseTarget(c)
                  }}
                >
                  {c.paused ? "Resume" : "Pause"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => select(c)}>
                  Backfill
                </Button>
              </div>
            )}
          />
        )}
      </QueryBoundary>
      {provider && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Backfill history</h2>
            <NativeSelect
              aria-label="Backfill provider"
              value={provider}
              onChange={(e) => {
                setProviderChoice(e.target.value)
                setCursors([""])
              }}
            >
              {[...new Set(query.data?.consumers.map((c) => c.provider))].map(
                (p) => (
                  <NativeSelectOption key={p} value={p}>
                    {p}
                  </NativeSelectOption>
                )
              )}
            </NativeSelect>
          </div>
          <QueryBoundary title="Backfill history" query={history}>
            {(data) => (
              <>
                <ResourceTable
                  columns={jobColumns}
                  rows={data.jobs}
                  rowKey={(j) => j.input.id}
                  density="compact"
                  emptyMessage="No backfill operations for this service."
                  rowActions={(j) => {
                    const c = query.data?.consumers.find(
                      (c) => c.consumerID === j.consumerID
                    )
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={j.state === "complete" || !c}
                        onClick={() => {
                          if (c) select(c, j)
                        }}
                      >
                        {j.state === "running" ? "Recover" : "Resume"}
                      </Button>
                    )
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cursors.length === 1 || history.loading}
                    onClick={() => setCursors((c) => c.slice(0, -1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!data.nextCursor || history.loading}
                    onClick={() => setCursors((c) => [...c, data.nextCursor])}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </QueryBoundary>
        </>
      )}
      <ConfirmDialog
        open={pauseTarget !== null}
        onOpenChange={(open) => {
          if (!open && !pauseCommand.loading) setPauseTarget(null)
        }}
        title={
          pauseTarget?.paused ? "Resume this consumer?" : "Pause this consumer?"
        }
        description={`${pauseTarget?.subscription.id ?? ""}: ${pauseTarget?.subscription.mode === "competing" ? "this changes intake for every replica in the service group" : "this changes intake for this broadcast subscriber"}. Accepted work can finish.`}
        confirmLabel={
          pauseTarget?.paused ? "Resume consumer" : "Pause consumer"
        }
        pending={pauseCommand.loading}
        onConfirm={() => void changePause()}
      >
        <CommandAlert
          title="Could not change intake"
          error={pauseCommand.error}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !run.loading) setTarget(null)
        }}
        title="Backfill retained events?"
        description={`Send matching original events only to ${target?.subscription.id ?? ""}. Original IDs are retained. Business effects may repeat. Reuse the operation ID to resume; a crashed claim expires after one minute.`}
        confirmLabel="Run backfill"
        pending={run.loading}
        confirmDisabled={!valid}
        onConfirm={() => void backfill()}
      >
        <div className="grid gap-2">
          <label className="text-sm" htmlFor="backfill-id">
            Operation ID
          </label>
          <Input
            id="backfill-id"
            value={input.id}
            disabled={run.loading}
            onChange={(e) => setInput((v) => ({ ...v, id: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              Start sequence
              <Input
                aria-label="Start sequence"
                type="number"
                min={1}
                value={input.start}
                disabled={run.loading}
                onChange={(e) =>
                  setInput((v) => ({ ...v, start: Number(e.target.value) }))
                }
              />
            </label>
            <label className="text-sm">
              End sequence
              <Input
                aria-label="End sequence"
                type="number"
                min={input.start}
                max={input.start + 99}
                value={input.end}
                disabled={run.loading}
                onChange={(e) =>
                  setInput((v) => ({ ...v, end: Number(e.target.value) }))
                }
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Inclusive range, at most 100 sequences. Other types and expired
            messages are skipped.
          </p>
        </div>
        <CommandAlert title="Could not finish backfill" error={run.error} />
      </ConfirmDialog>
    </section>
  )
}
