import { useState } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Frame, Section, Facts, Stamp } from "../components"
import { useDurableCursor } from "../durable-cursor"
import { Read } from "../read"
import { DurablePayloadPanel } from "../durable-payload"
import { useDurableRead } from "../durable-read"
import { DurablePageRead, DurableTable } from "../durable-table"
import { runPath, displayState, decodeRunPart } from "../durable-types"
import type {
  DurableDeliveries,
  DurableDetail,
  DurableEvent,
  DurableExecution,
  DurablePage,
  DurableTask,
  RunKey,
} from "../durable-types"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"

const identity = (row: RunKey) => (
  <PluginLink
    className="font-mono text-xs break-all text-primary hover:underline"
    to={runPath(row)}
  >
    {row.workflow_id} / {row.run_id}
  </PluginLink>
)
export function DurableExecutionPage({ params }: PluginPageProps) {
  let target: RunKey
  try {
    target = {
      namespace: decodeRunPart(params.namespace),
      workflow_id: decodeRunPart(params.workflow),
      run_id: decodeRunPart(params.run),
    }
  } catch {
    return (
      <Frame title="Invalid execution link">
        <ZeroState
          title="Execution link needs regeneration"
          body="Choose the run from the execution list to open its exact identity."
          action={
            <PluginLink to="/durable" className="text-primary hover:underline">
              Return to executions
            </PluginLink>
          }
        />
      </Frame>
    )
  }
  return <ExecutionDetail key={runPath(target)} target={target} />
}
function ExecutionDetail({ target }: { target: RunKey }) {
  const query = useDurableRead<DurableDetail>("durable.execution", {
    ...target,
  })
  const [tab, setTab] = useState("history")
  return (
    <Frame
      title={target.workflow_id || "Durable execution"}
      description={`${target.namespace} / ${target.run_id}`}
      actions={
        <PluginLink
          to="/durable"
          className="text-xs text-primary hover:underline"
        >
          Executions
        </PluginLink>
      }
    >
      <Read title="Durable execution" query={query} intervalMs={10_000}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Badge
                variant={data.state === "failed" ? "destructive" : "outline"}
              >
                {displayState(data.state)}
              </Badge>
              <span>
                Build{" "}
                <span className="font-mono break-all">{data.build_id}</span>
              </span>
              <span>
                Revision <span className="font-mono">{data.revision}</span>
              </span>
              <span>
                Run <span className="font-mono">{data.run_number}</span> · Retry{" "}
                <span className="font-mono">{data.retry_attempt}</span>
              </span>
              <span>Runtime {data.runtime}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {data.runtime === "unavailable"
                ? "Historical build runtime is unavailable. Persisted metadata remains inspectable."
                : "Runtime availability is reported for this exact namespace and build."}{" "}
              Polls every 10 seconds while visible.
            </p>
            <details className="text-xs">
              <summary className="cursor-pointer rounded-sm py-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
                Execution metadata and run links
              </summary>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Facts
                  items={[
                    [
                      "Namespace",
                      <span className="font-mono text-xs break-all">
                        {data.namespace}
                      </span>,
                    ],
                    ["Workflow type", data.workflow_type],
                    [
                      "Last sequence",
                      <span className="font-mono text-xs">
                        {data.last_sequence}
                      </span>,
                    ],
                    [
                      "Created",
                      <Stamp value={data.created_at} label="creation time" />,
                    ],
                    [
                      "Updated",
                      <Stamp value={data.updated_at} label="update time" />,
                    ],
                  ]}
                />
                <Facts
                  items={[
                    [
                      "Run deadline",
                      <Stamp
                        value={data.run_deadline_at}
                        label="run deadline"
                      />,
                    ],
                    [
                      "Execution deadline",
                      <Stamp
                        value={data.execution_deadline_at}
                        label="execution deadline"
                      />,
                    ],
                    [
                      "Run available",
                      <Stamp
                        value={data.run_available_at}
                        label="run availability"
                      />,
                    ],
                    ...data.links.map(
                      (link) =>
                        [displayState(link.kind), identity(link)] as [
                          string,
                          React.ReactNode,
                        ]
                    ),
                  ]}
                />
              </div>
            </details>
            {data.links_restricted && (
              <p role="status" className="text-xs text-muted-foreground">
                Some run links are restricted. Linked details check access
                independently.
              </p>
            )}
            {!query.error && <DurablePayloadPanel target={target} />}
            <nav
              aria-label="Execution inspection"
              className="flex flex-wrap gap-1 border-b pb-2"
            >
              {["history", "tasks", "chain", "children", "audit", "hooks"].map(
                (name) => (
                  <Button
                    key={name}
                    size="sm"
                    variant={tab === name ? "secondary" : "ghost"}
                    aria-pressed={tab === name}
                    onClick={() => setTab(name)}
                  >
                    {name === "chain"
                      ? "Run chain"
                      : name === "audit"
                        ? "Source audit"
                        : name === "hooks"
                          ? "Hook delivery"
                          : name[0].toUpperCase() + name.slice(1)}
                  </Button>
                )
              )}
            </nav>
            {tab === "tasks" ? (
              <Tasks target={target} />
            ) : tab === "audit" || tab === "hooks" ? (
              <Deliveries key={tab} target={target} kind={tab} />
            ) : tab === "history" ? (
              <Paged<DurableEvent>
                target={target}
                kind="history"
                title="history events"
                rowKey={(row) => row.sequence}
                columns={[
                  {
                    id: "sequence",
                    header: "Sequence",
                    cell: (row) => (
                      <span className="font-mono text-xs">{row.sequence}</span>
                    ),
                  },
                  {
                    id: "type",
                    header: "Event",
                    cell: (row) => (
                      <span className="font-medium">{row.type}</span>
                    ),
                  },
                  {
                    id: "time",
                    header: "Time",
                    cell: (row) => (
                      <Stamp value={row.time} label="event time" />
                    ),
                  },
                ]}
              />
            ) : (
              <Paged<DurableExecution>
                key={tab}
                target={target}
                kind={tab}
                title={tab === "chain" ? "runs" : "children"}
                rowKey={runPath}
                columns={[
                  { id: "key", header: "Workflow / run", cell: identity },
                  {
                    id: "state",
                    header: "State",
                    cell: (row) => displayState(row.state),
                  },
                  {
                    id: "revision",
                    header: "Revision",
                    cell: (row) => (
                      <span className="font-mono text-xs">{row.revision}</span>
                    ),
                  },
                  {
                    id: "build",
                    header: "Build / runtime",
                    cell: (row) => (
                      <span className="font-mono text-xs">
                        {row.build_id} / {row.runtime}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      </Read>
    </Frame>
  )
}
function Paged<T>({
  target,
  kind,
  title,
  columns,
  rowKey,
  filters = {},
  reset,
}: {
  target: RunKey
  kind: string
  title: string
  columns: Column<T>[]
  rowKey: (row: T) => string
  filters?: Record<string, string>
  reset?: () => void
}) {
  const paging = useDurableCursor(JSON.stringify({ target, kind, filters }))
  const query = useDurableRead<DurablePage<T>>(`durable.${kind}`, {
    ...target,
    ...filters,
    limit: 25,
    cursor: paging.cursor ?? "",
  })
  return (
    <Section title={title}>
      <DurablePageRead
        paging={paging}
        title={title}
        query={query}
        intervalMs={paging.cursor ? null : 10_000}
      >
        {(data) => (
          <DurableTable
            title={title}
            data={data}
            columns={columns}
            rowKey={rowKey}
            paging={paging}
            loading={query.loading}
            refresh={query.refetch}
            filtered={Object.values(filters).some(Boolean)}
            reset={reset}
          />
        )}
      </DurablePageRead>
    </Section>
  )
}
function Tasks({ target }: { target: RunKey }) {
  const [kind, setKind] = useState("")
  return (
    <>
      <label className="flex max-w-48 flex-col gap-1 text-xs">
        Task kind
        <Input
          className="h-8"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        />
      </label>
      <Paged<DurableTask>
        target={target}
        kind="tasks"
        title="tasks"
        filters={{ kind }}
        reset={() => setKind("")}
        rowKey={(row) => row.id}
        columns={[
          {
            id: "id",
            header: "Task / kind",
            cell: (row) => (
              <span className="font-mono text-xs break-all">
                {row.id}
                <br />
                {row.kind}
              </span>
            ),
          },
          {
            id: "state",
            header: "State",
            cell: (row) => displayState(row.state),
          },
          {
            id: "attempt",
            header: "Attempt / version",
            cell: (row) => (
              <span className="font-mono text-xs">
                {row.attempt} / {row.version}
              </span>
            ),
          },
          {
            id: "available",
            header: "Available",
            cell: (row) => (
              <Stamp value={row.available_at} label="task availability" />
            ),
          },
          {
            id: "lease",
            header: "Lease until",
            cell: (row) => (
              <Stamp value={row.lease_until} label="lease expiry" />
            ),
          },
          {
            id: "deadline",
            header: "Deadline",
            cell: (row) => (
              <Stamp value={row.deadline_at} label="task deadline" />
            ),
          },
          {
            id: "heartbeat",
            header: "Heartbeat",
            cell: (row) => <Stamp value={row.heartbeat_at} label="heartbeat" />,
          },
        ]}
      />
    </>
  )
}
function Deliveries({ target, kind }: { target: RunKey; kind: string }) {
  const paging = useDurableCursor(JSON.stringify({ target, kind }))
  const query = useDurableRead<DurableDeliveries>(`durable.${kind}`, {
    ...target,
    limit: 25,
    cursor: paging.cursor ?? "",
  })
  return (
    <Section
      title={
        kind === "audit"
          ? "Chronicle source audit"
          : "Relay source hook delivery"
      }
    >
      <DurablePageRead
        paging={paging}
        title="Source delivery"
        query={query}
        intervalMs={paging.cursor ? null : 10_000}
      >
        {(data) => (
          <>
            <p className="text-xs">
              Pending {data.pending} (includes blocked {data.blocked}). Blocked
              sources need repair and do not automatically retry.
            </p>
            <p className="text-xs text-muted-foreground">
              Sink accepted means verified persisted source acceptance.{" "}
              {kind === "hooks"
                ? `Webhook endpoint delivery: ${data.remote_delivery}.`
                : `Chronicle external anchoring: ${data.external_anchoring}.`}{" "}
              Counts and rows may observe different instants.
            </p>
            <DurableTable
              title="source records"
              data={data}
              paging={paging}
              loading={query.loading}
              refresh={query.refetch}
              rowKey={(row) => row.id}
              columns={[
                {
                  id: "id",
                  header: "Source",
                  cell: (row) => (
                    <span className="font-mono text-xs break-all">
                      {row.id}
                    </span>
                  ),
                },
                {
                  id: "state",
                  header: "State",
                  cell: (row) => (
                    <Badge
                      variant={
                        row.state === "blocked" ? "destructive" : "outline"
                      }
                    >
                      {displayState(row.state)}
                    </Badge>
                  ),
                },
                {
                  id: "attempt",
                  header: "Attempts",
                  cell: (row) => (
                    <span className="font-mono text-xs">{row.attempts}</span>
                  ),
                },
                {
                  id: "accepted",
                  header: "Source accepted",
                  cell: (row) => (
                    <Stamp value={row.accepted_at} label="source acceptance" />
                  ),
                },
                {
                  id: "sink",
                  header: "Sink accepted",
                  cell: (row) => (
                    <Stamp
                      value={row.sink_accepted_at}
                      label="sink acceptance"
                    />
                  ),
                },
                {
                  id: "retry",
                  header: "Next attempt",
                  cell: (row) => (
                    <Stamp value={row.next_attempt_at} label="next attempt" />
                  ),
                },
              ]}
            />
          </>
        )}
      </DurablePageRead>
    </Section>
  )
}
