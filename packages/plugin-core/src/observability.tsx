import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@forge-go/dashboard-kit/components/tabs"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@forge-go/dashboard-kit/components/sheet"
import {
  Page,
  Panel,
  Properties,
  Records,
  Status,
  valueText,
} from "./components"
import type { AuditRecord, MetricsReport, Trace, TraceDetail } from "./types"

type TraceSpan = NonNullable<TraceDetail["spans"]>[number]

function traceMessage(span: TraceSpan, direction: "request" | "response") {
  const message = span.http?.[direction]
  const headers = Object.fromEntries(
    Object.entries(message?.headers ?? {}).filter(
      ([name]) => !/(authorization|cookie|token|secret|api[-_]?key)/i.test(name)
    )
  )
  return { headers, body: message?.body }
}

function TraceMessage({
  span,
  direction,
}: {
  span: TraceSpan
  direction: "request" | "response"
}) {
  const { headers, body } = traceMessage(span, direction)
  let displayedBody = body
  if (body) {
    try {
      displayedBody = JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      // Plain text bodies can be displayed without formatting.
    }
  }
  return (
    <div className="grid gap-4 p-4 @2xl/main:grid-cols-2">
      <section className="min-w-0">
        <h4 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Headers
        </h4>
        {Object.keys(headers).length ? (
          <dl className="divide-y overflow-hidden rounded-md border">
            {Object.entries(headers).map(([name, value]) => (
              <div className="space-y-1 px-3 py-2 text-xs" key={name}>
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="font-mono break-all">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">
            Headers not captured for this span.
          </p>
        )}
      </section>
      <section className="min-w-0">
        <h4 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Body
        </h4>
        {displayedBody ? (
          <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {displayedBody}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">
            Body not captured for this span.
          </p>
        )}
      </section>
    </div>
  )
}

export function MetricsPage() {
  const query = useQuery<MetricsReport>("metrics-report")
  return (
    <Page
      title="Metrics"
      description="Registered instruments, current values, and collection health."
      refresh={query.refetch}
      busy={query.loading}
      data={query.data}
    >
      <QueryBoundary title="Metrics" query={query}>
        {(data) => (
          <>
            <StatGrid
              items={[
                { label: "Total metrics", value: data.totalMetrics },
                {
                  label: "Metric types",
                  value: Object.keys(data.metricsByType ?? {}).length,
                },
                { label: "Collectors", value: data.collectors?.length ?? 0 },
                {
                  label: "Reported values",
                  value: data.topMetrics?.length ?? 0,
                },
              ]}
            />
            <Panel
              title="Instrument distribution"
              description="Current inventory by metric type"
            >
              <div className="space-y-4 p-5">
                {Object.entries(data.metricsByType ?? {}).length ? (
                  Object.entries(data.metricsByType ?? {}).map(
                    ([type, count]) => (
                      <div
                        className="grid grid-cols-[7rem_minmax(0,1fr)_3rem] items-center gap-4 text-xs"
                        key={type}
                      >
                        <span>{type}</span>
                        <div className="h-2 overflow-hidden rounded-sm bg-muted">
                          <div
                            className="h-full bg-chart-1"
                            style={{
                              width: `${data.totalMetrics ? Math.min(100, (count / data.totalMetrics) * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <code className="text-right">{count}</code>
                      </div>
                    )
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No metric types reported.
                  </p>
                )}
              </div>
            </Panel>
            <Panel title="Metric values" description="Latest reported values">
              <Records
                noun="metrics"
                rows={data.topMetrics ?? []}
                rowKey={(row, i) => `${row.name}:${i}`}
                searchText={(row) => `${row.name} ${row.type}`}
                columns={[
                  { label: "Name", render: (row) => <code>{row.name}</code> },
                  { label: "Type", render: (row) => row.type },
                  {
                    label: "Value",
                    render: (row) => (
                      <code className="block max-w-xl break-all whitespace-pre-wrap">
                        {valueText(row.value)}
                      </code>
                    ),
                  },
                ]}
              />
            </Panel>
            <Panel title="Collectors">
              <Records
                noun="collectors"
                rows={data.collectors ?? []}
                rowKey={(row) => row.name}
                columns={[
                  { label: "Collector", render: (row) => row.name },
                  { label: "Type", render: (row) => row.type },
                  {
                    label: "Metrics",
                    render: (row) => <code>{row.metricsCount}</code>,
                  },
                  {
                    label: "Status",
                    render: (row) => <Status value={row.status} />,
                  },
                  {
                    label: "Last collection",
                    render: (row) => (
                      <Timestamp
                        value={row.lastCollection}
                        label="collection time"
                      />
                    ),
                  },
                ]}
              />
            </Panel>
          </>
        )}
      </QueryBoundary>
    </Page>
  )
}
function TraceInspection({ id }: { id: string }) {
  const query = useQuery<TraceDetail>("traces.detail", { id })
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)
  return (
    <QueryBoundary title="Trace details" query={query}>
      {(data) => {
        const selectedSpan =
          (data.spans ?? []).find((span) => span.span_id === selectedSpanId) ??
          data.spans?.[0]
        return (
          <div className="space-y-4">
            <Properties
              values={{
                "Trace ID": data.trace_id,
                "Duration (ms)": data.duration / 1e6,
                Spans: data.spans?.length ?? 0,
              }}
            />
            <Panel
              title="Span waterfall"
              description="Timing relative to the complete trace"
            >
              <div className="divide-y">
                {(data.spans ?? []).map((span) => (
                  <button
                    type="button"
                    aria-pressed={selectedSpan?.span_id === span.span_id}
                    onClick={() => setSelectedSpanId(span.span_id)}
                    className="block w-full space-y-2 px-4 py-3 text-left hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-accent/40"
                    key={span.span_id}
                  >
                    <div
                      className="flex items-start justify-between gap-4 text-xs"
                      style={{
                        paddingLeft: `${Math.min(8, Math.max(0, span.depth)) * 8}px`,
                      }}
                    >
                      <code className="break-all">{span.name}</code>
                      <code className="shrink-0">
                        {(span.duration / 1e6).toFixed(2)} ms
                      </code>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-sm bg-muted">
                      <div
                        className={`absolute h-2 min-w-px rounded-sm ${span.status === 2 ? "bg-destructive" : "bg-chart-1"}`}
                        style={{
                          left: `${Math.max(0, Math.min(100, span.offset_percent))}%`,
                          width: `${Math.max(0, Math.min(100 - Math.max(0, span.offset_percent), span.width_percent))}%`,
                        }}
                      />
                    </div>
                    <Status
                      value={
                        span.status === 2
                          ? "error"
                          : span.status === 1
                            ? "ok"
                            : "unset"
                      }
                    />
                  </button>
                ))}
              </div>
            </Panel>
            {selectedSpan && (
              <Panel title={selectedSpan.name} description="Span details">
                <Tabs
                  defaultValue="request"
                  key={selectedSpan.span_id}
                  className="gap-0"
                >
                  <TabsList
                    variant="line"
                    className="mx-3 mt-2 grid w-[calc(100%-1.5rem)] grid-cols-3"
                  >
                    <TabsTrigger
                      value="request"
                      className="min-w-0 px-1 text-xs"
                    >
                      Request
                    </TabsTrigger>
                    <TabsTrigger
                      value="response"
                      className="min-w-0 px-1 text-xs"
                    >
                      Response
                    </TabsTrigger>
                    <TabsTrigger
                      value="attributes"
                      className="min-w-0 px-1 text-xs"
                    >
                      Attributes
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="request">
                    <TraceMessage span={selectedSpan} direction="request" />
                  </TabsContent>
                  <TabsContent value="response">
                    <TraceMessage span={selectedSpan} direction="response" />
                  </TabsContent>
                  <TabsContent value="attributes">
                    {Object.keys(selectedSpan.attributes ?? {}).length ? (
                      <Properties values={selectedSpan.attributes ?? {}} />
                    ) : (
                      <p className="p-4 text-xs text-muted-foreground">
                        No attributes recorded for this span.
                      </p>
                    )}
                  </TabsContent>
                </Tabs>
              </Panel>
            )}
          </div>
        )
      }}
    </QueryBoundary>
  )
}
export function TracesPage() {
  const query = useQuery<{ traces: Trace[] | null; total: number }>(
    "traces.list"
  )
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <Page
      title="Traces"
      description="Inspect recent requests and follow their spans."
      refresh={query.refetch}
      busy={query.loading}
      data={query.data}
    >
      <QueryBoundary title="Traces" query={query}>
        {(data) => (
          <>
            <StatGrid
              items={[
                { label: "Stored traces", value: data.total },
                {
                  label: "Loaded traces",
                  value: data.traces?.length ?? 0,
                  hint: "Up to 200 recent traces",
                },
                {
                  label: "Errors in loaded traces",
                  value: (data.traces ?? []).filter(
                    (trace) => trace.status === "error"
                  ).length,
                },
                {
                  label: "Spans in loaded traces",
                  value: (data.traces ?? []).reduce(
                    (total, trace) => total + trace.spanCount,
                    0
                  ),
                },
              ]}
            />
            <Panel
              title="Recent traces"
              description="Search the loaded traces by operation, ID, protocol, or status"
            >
              <Records
                noun="traces"
                rows={data.traces ?? []}
                rowKey={(row) => row.traceID}
                searchText={(row) =>
                  `${row.rootSpanName} ${row.traceID} ${row.protocol} ${row.status}`
                }
                columns={[
                  {
                    label: "Operation",
                    render: (row) => (
                      <div>
                        <Button
                          variant="link"
                          className="h-auto px-0 font-mono text-xs"
                          onClick={() => setSelected(row.traceID)}
                        >
                          {row.rootSpanName}
                        </Button>
                        <div className="max-w-60 truncate font-mono text-[11px] text-muted-foreground">
                          {row.traceID}
                        </div>
                      </div>
                    ),
                  },
                  { label: "Protocol", render: (row) => row.protocol },
                  {
                    label: "Status",
                    render: (row) => <Status value={row.status} />,
                  },
                  {
                    label: "Duration",
                    render: (row) => <code>{row.durationMs} ms</code>,
                  },
                  {
                    label: "Spans",
                    render: (row) => <code>{row.spanCount}</code>,
                  },
                  {
                    label: "Started",
                    render: (row) => (
                      <Timestamp value={row.startTime} label="start time" />
                    ),
                  },
                ]}
              />
            </Panel>
          </>
        )}
      </QueryBoundary>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Trace details</SheetTitle>
            <SheetDescription>
              Span timing and attributes reported by the application.
            </SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-6">
            {selected && <TraceInspection key={selected} id={selected} />}
          </div>
        </SheetContent>
      </Sheet>
    </Page>
  )
}
export function AuditTable({ compact = false }: { compact?: boolean }) {
  const query = useQuery<{ records: AuditRecord[] | null; total: number }>(
    "audit.list",
    { limit: compact ? 5 : 200 }
  )
  const [selected, setSelected] = useState<AuditRecord | null>(null)
  return (
    <>
      <Panel
        title={compact ? "Recent activity" : "Audit activity"}
        description={
          compact
            ? "Recent dashboard operations"
            : "The latest 200 audit records. Search filters these loaded records."
        }
        action={
          compact ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              role="link"
              render={<PluginLink to="/logs">View all</PluginLink>}
            >
              View all
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={query.loading}
              onClick={query.refetch}
            >
              Refresh activity
            </Button>
          )
        }
      >
        <QueryBoundary title="Audit activity" query={query}>
          {(data) => (
            <Records
              noun="events"
              rows={data.records ?? []}
              rowKey={(row, index) =>
                `${row.time}:${row.correlationID}:${index}`
              }
              searchText={
                compact
                  ? undefined
                  : (row) =>
                      `${row.intent} ${row.contributor} ${row.user ?? ""} ${row.result}`
              }
              columns={[
                {
                  label: "Time",
                  render: (row) => (
                    <Timestamp
                      className="font-mono text-xs"
                      value={row.time}
                      label="event time"
                    />
                  ),
                },
                {
                  label: "Operation",
                  render: (row) => (
                    <Button
                      variant="link"
                      className="h-auto px-0 font-mono text-xs"
                      onClick={() => setSelected(row)}
                    >
                      {row.intent}
                    </Button>
                  ),
                },
                {
                  label: "Extension",
                  render: (row) => <code>{row.contributor}</code>,
                },
                {
                  label: "Result",
                  render: (row) => <Status value={row.result} />,
                },
                ...(!compact
                  ? [
                      {
                        label: "Latency",
                        render: (row: AuditRecord) => (
                          <code>{row.latencyMs} ms</code>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </QueryBoundary>
      </Panel>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Audit event</SheetTitle>
            <SheetDescription>
              Operation outcome and correlation details.
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <Properties
              values={{
                Time: selected.time,
                Intent: selected.intent,
                Contributor: selected.contributor,
                User: selected.user,
                Subject: selected.subject,
                Result: selected.result,
                "Latency (ms)": selected.latencyMs,
                "Correlation ID": selected.correlationID,
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
export function LogsPage() {
  return (
    <Page
      title="Logs & activity"
      description="Review dashboard audit events and operation outcomes."
    >
      <div className="rounded-md border bg-muted/40 px-5 py-3 text-sm text-muted-foreground">
        Audit activity is available here. Application log streaming is not
        exposed by this server contract.
      </div>
      <AuditTable />
    </Page>
  )
}
