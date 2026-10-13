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
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import type {
  Snapshot,
  Provider,
  Stream,
  Subscription,
  Instance,
  Letter,
  LetterList,
  HookEvent,
  Receipt,
} from "./types"

const providerColumns: Column<Provider>[] = [
  {
    id: "rpc",
    header: "RPC",
    cell: (p) => (p.capabilities.rpc ? "Supported" : "Unavailable"),
  },
  {
    id: "name",
    header: "Provider",
    cell: (p) => <span className="font-medium">{p.name}</span>,
  },
  { id: "type", header: "Broker", cell: (p) => p.type },
  {
    id: "health",
    header: "Connection",
    cell: (p) => (
      <Badge variant={p.healthy ? "outline" : "destructive"}>
        {p.healthy ? "Connected" : "Unavailable"}
      </Badge>
    ),
  },
  {
    id: "durability",
    header: "Storage",
    cell: (p) => (p.capabilities.durable ? "Durable" : "Process memory"),
  },
  {
    id: "replay",
    header: "Replay",
    cell: (p) => (p.capabilities.replay ? "Supported" : "Unavailable"),
  },
]
const streamColumns: Column<Stream>[] = [
  {
    id: "name",
    header: "Stream",
    cell: (s) => <span className="font-medium">{s.config.name}</span>,
  },
  { id: "provider", header: "Provider", cell: (s) => s.config.provider },
  {
    id: "subjects",
    header: "Subjects",
    cell: (s) => (
      <span className="font-mono text-xs">{s.config.subjects.join(", ")}</span>
    ),
  },
  {
    id: "messages",
    header: "Retained",
    align: "end",
    cell: (s) => s.messages.toLocaleString(),
  },
  {
    id: "consumers",
    header: "Consumers",
    align: "end",
    cell: (s) => s.consumers,
  },
  {
    id: "replicas",
    header: "Replicas",
    align: "end",
    cell: (s) => s.config.replicas,
  },
]
const subscriptionColumns: Column<Subscription>[] = [
  {
    id: "id",
    header: "Subscription",
    cell: (s) => <span className="font-medium">{s.id}</span>,
  },
  {
    id: "type",
    header: "Event",
    cell: (s) => (
      <span className="font-mono text-xs">
        {s.messageType || <NoneCell label="value" />}
      </span>
    ),
  },
  {
    id: "mode",
    header: "Delivery",
    cell: (s) => (
      <Badge variant="outline">
        {s.mode === "competing" ? "One instance" : "Each instance"}
      </Badge>
    ),
  },
  {
    id: "durable",
    header: "Cursor",
    cell: (s) => (s.durable ? "Durable" : "Ephemeral"),
  },
  {
    id: "workers",
    header: "Workers / in flight",
    align: "end",
    cell: (s) => `${s.concurrency} / ${s.maxInFlight}`,
  },
  {
    id: "attempts",
    header: "Attempts",
    align: "end",
    cell: (s) => s.maxAttempts,
  },
]

/** The instance this overview reads: run state, service, instance, namespace. */
function InstanceMeta({ data }: { data: Snapshot }) {
  return (
    <>
      <Badge variant={data.running ? "outline" : "destructive"}>
        {data.running ? "Running" : "Stopped"}
      </Badge>
      <span className="font-medium">{data.identity.serviceID}</span>
      <span className="font-mono text-xs break-all">
        {data.identity.instanceID}
      </span>
      <span className="text-muted-foreground">{data.identity.namespace}</span>
    </>
  )
}

export function ConduitOverviewPage() {
  const query = useQuery<Snapshot>("overview")
  usePoll(query.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Conduit"
        description="Broker state and counters for this service instance."
        meta={query.data ? <InstanceMeta data={query.data} /> : undefined}
      />
      <QueryBoundary title="Conduit" query={query}>
        {(data) => (
          <>
            <StatGrid
              aria-label="Instance counters"
              items={[
                { label: "Published", value: data.published },
                { label: "RPC calls", value: data.rpcCalls },
                { label: "RPC handled", value: data.rpcHandled },
                { label: "RPC failures", value: data.rpcFailed },
                { label: "RPC timeouts", value: data.rpcTimedOut },
                { label: "Acknowledged", value: data.acknowledged },
                { label: "Failed attempts", value: data.failed },
                { label: "Retries", value: data.retried },
                {
                  label: "Dead letters",
                  value: data.deadLettered,
                  tone:
                    data.deadLettered > 0
                      ? ("danger" as const)
                      : ("default" as const),
                },
                {
                  label: "Dropped hook observations",
                  value: data.observerDrops,
                },
              ].map((item) => ({
                ...item,
                value: Number(item.value).toLocaleString(),
              }))}
            />
            <Section
              title="Providers"
              description="Brokers this instance publishes and subscribes through."
            >
              <ResourceTable
                columns={providerColumns}
                rows={data.providers ?? []}
                rowKey={(p) => p.name}
                density="compact"
                emptyMessage="No providers configured."
              />
            </Section>
            <Section
              title="Streams"
              description="Durable streams on the broker and what they retain."
            >
              <ResourceTable
                columns={streamColumns}
                rows={data.streams ?? []}
                rowKey={(s) => s.config.name}
                density="compact"
                emptyMessage="No streams configured."
              />
            </Section>
            <Section
              title="Subscriptions"
              description="Handlers this instance registered, and how each is delivered."
            >
              <ResourceTable
                columns={subscriptionColumns}
                rows={data.subscriptions ?? []}
                rowKey={(s) => s.id}
                density="compact"
                emptyMessage="No subscriptions configured."
              />
            </Section>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}

const instanceColumns: Column<Instance>[] = [
  {
    id: "service",
    header: "Service",
    cell: (i) => <span className="font-medium">{i.identity.serviceID}</span>,
  },
  {
    id: "instance",
    header: "Instance",
    cell: (i) => (
      <span className="font-mono text-xs break-all">
        {i.identity.instanceID}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: (i) => (
      <Badge variant="outline">{i.ready ? "Ready" : "Draining"}</Badge>
    ),
  },
  {
    id: "version",
    header: "Version",
    cell: (i) => i.version || <NoneCell label="value" />,
  },
  {
    id: "endpoints",
    header: "Advertised endpoints",
    cell: (i) =>
      i.endpoints?.length ? (
        <div className="flex min-w-0 flex-col gap-1">
          {i.endpoints.map((e) => (
            <span className="font-mono text-xs break-all" key={e.url}>
              {e.url}
            </span>
          ))}
        </div>
      ) : (
        <NoneCell label="value" />
      ),
  },
]
export function ConduitServicesPage() {
  const query = useQuery<{ instances: Instance[] }>("services.list")
  usePoll(query.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Services"
        description="Ready instances share a service ID. Clients resolve the service name within this namespace."
      />
      <Section aria-label="Service list">
        <QueryBoundary title="Services" query={query}>
          {(data) => (
            <ResourceTable
              columns={instanceColumns}
              rows={data.instances ?? []}
              rowKey={(i) => `${i.identity.serviceID}/${i.identity.instanceID}`}
              density="compact"
              emptyMessage="No registered service instances."
            />
          )}
        </QueryBoundary>
      </Section>
    </section>
  )
}

const letterColumns: Column<Letter>[] = [
  {
    id: "type",
    header: "Event",
    cell: (l) => <span className="font-mono text-xs">{l.messageType}</span>,
  },
  {
    id: "message",
    header: "Message ID",
    cell: (l) => (
      <span className="font-mono text-xs break-all">{l.messageID}</span>
    ),
  },
  {
    id: "subscription",
    header: "Subscription",
    cell: (l) => l.delivery.subscriptionID,
  },
  {
    id: "attempt",
    header: "Attempts",
    align: "end",
    cell: (l) => l.delivery.attempt,
  },
  {
    id: "failed",
    header: "Failed",
    cell: (l) => <Timestamp value={l.failedAt} label="failure time" />,
  },
  {
    id: "status",
    header: "Status",
    cell: (l) => (
      <Badge variant={l.replayed ? "outline" : "destructive"}>
        {l.replayed ? "Replayed" : "Failed"}
      </Badge>
    ),
  },
]
export function ConduitDeadLettersPage() {
  const topology = useQuery<Snapshot>("overview")
  const [selected, setSelected] = useState("")
  const provider =
    selected ||
    topology.data?.providers?.find((p) => p.capabilities.deadLetters)?.name ||
    ""
  const [cursors, setCursors] = useState<string[]>([""])
  const [target, setTarget] = useState<Letter | null>(null)
  const replay = useCommand<Receipt>("deadletters.replay")
  const query = useQuery<LetterList>(
    "deadletters.list",
    { provider, cursor: cursors.at(-1) ?? "", limit: 25 },
    { enabled: provider !== "" }
  )
  async function confirm() {
    if (!target) return
    const result = await replay.execute({
      provider,
      subscription: target.delivery.subscriptionID,
      id: target.id,
    })
    if (result) {
      setTarget(null)
      void query.refetch()
    }
  }
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Dead letters"
        description="Replay sends the original message to its failed subscription. Processing may repeat business effects."
      />
      <QueryBoundary title="Providers" query={topology}>
        {(data) =>
          data.providers?.some((p) => p.capabilities.deadLetters) ? (
            <Section
              aria-label="Dead letter list"
              actions={
                <div className="flex items-center gap-2">
                  <label
                    className="shrink-0 text-sm whitespace-nowrap"
                    htmlFor="conduit-provider"
                  >
                    Provider
                  </label>
                  <NativeSelect
                    id="conduit-provider"
                    value={provider}
                    onChange={(e) => {
                      setSelected(e.target.value)
                      setCursors([""])
                    }}
                  >
                    {data.providers
                      .filter((p) => p.capabilities.deadLetters)
                      .map((p) => (
                        <NativeSelectOption key={p.name} value={p.name}>
                          {p.name}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </div>
              }
            >
              <QueryBoundary title="Dead letters" query={query}>
                {(letters) => (
                  <>
                    <ResourceTable
                      columns={letterColumns}
                      rows={letters.letters ?? []}
                      rowKey={(l) => l.id}
                      density="compact"
                      emptyMessage="No dead letters for this service."
                      rowActions={(l) => (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={l.replayed}
                          aria-label={`Replay ${l.messageID}`}
                          onClick={() => {
                            replay.reset()
                            setTarget(l)
                          }}
                        >
                          Replay
                        </Button>
                      )}
                    />
                    <nav
                      aria-label="Pagination"
                      className="flex justify-end gap-2"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cursors.length === 1 || query.loading}
                        onClick={() => setCursors((c) => c.slice(0, -1))}
                      >
                        Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!letters.nextCursor || query.loading}
                        onClick={() =>
                          setCursors((c) => [...c, letters.nextCursor])
                        }
                      >
                        Next
                      </Button>
                    </nav>
                  </>
                )}
              </QueryBoundary>
            </Section>
          ) : (
            <ZeroState
              title="No dead letter provider"
              body="Configure a broker with dead letter support to inspect failed deliveries."
            />
          )
        }
      </QueryBoundary>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !replay.loading) setTarget(null)
        }}
        title="Replay this event?"
        description={`Send ${target?.messageID ?? ""} to ${target?.delivery.subscriptionID ?? ""} again with its original message ID. The handler may repeat external effects.`}
        confirmLabel="Replay event"
        pending={replay.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert title="Could not replay event" error={replay.error} />
      </ConfirmDialog>
    </section>
  )
}

const hookColumns: Column<HookEvent>[] = [
  {
    id: "duration",
    header: "Duration",
    cell: (e) =>
      e.duration ? (
        `${(e.duration / 1e6).toFixed(1)} ms`
      ) : (
        <NoneCell label="value" />
      ),
  },
  {
    id: "time",
    header: "Time",
    cell: (e) => <Timestamp value={e.at} label="event time" />,
  },
  {
    id: "stage",
    header: "Outcome",
    cell: (e) => (
      <Badge variant={e.stage.includes("failed") ? "destructive" : "outline"}>
        {e.stage}
      </Badge>
    ),
  },
  {
    id: "message",
    header: "Message",
    cell: (e) =>
      e.message ? (
        <span className="font-mono text-xs break-all">{e.message.id}</span>
      ) : (
        <NoneCell label="value" />
      ),
  },
  {
    id: "subscription",
    header: "Subscription",
    cell: (e) => e.delivery?.subscriptionID || <NoneCell label="value" />,
  },
  {
    id: "attempt",
    header: "Attempt",
    align: "end",
    cell: (e) => e.delivery?.attempt || <NoneCell label="value" />,
  },
]
export function ConduitHooksPage() {
  const query = useQuery<{ events: HookEvent[] }>("hooks.list")
  usePoll(query.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Delivery hooks"
        description="The latest 100 runtime outcomes. Payloads, headers and handler error text are excluded."
      />
      <Section aria-label="Hook event list">
        <QueryBoundary title="Delivery hooks" query={query}>
          {(data) => (
            <ResourceTable
              columns={hookColumns}
              rows={[...(data.events ?? [])].reverse()}
              rowKey={(e) =>
                `${e.at}/${e.stage}/${e.message?.id ?? ""}/${e.delivery?.consumerID ?? ""}`
              }
              density="compact"
              emptyMessage="No communication outcomes recorded yet."
            />
          )}
        </QueryBoundary>
      </Section>
    </section>
  )
}
