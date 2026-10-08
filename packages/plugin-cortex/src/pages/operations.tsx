import { CircleStop } from "@forge-go/dashboard-kit/icons"
import { Pencil, Eraser, Trash2 } from "@forge-go/dashboard-kit/icons"
import { ChevronLeft, ChevronRight } from "@forge-go/dashboard-kit/icons"
import { useState } from "react"
import {
  PluginLink,
  PluginSlot,
  useCommand,
  useNavigateTo,
  usePoll,
  useQuery,
} from "@forge-go/dashboard-plugin"
import {
  Button,
  buttonVariants,
} from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import {
  AuditDates,
  Back,
  IconAction,
  Code,
  Reload,
  ScopeLine,
  State,
  useAccess,
  Value,
} from "../components"
import type {
  Agent,
  Checkpoint,
  Memory,
  Page,
  Run,
  RunDetail,
  Runtime,
  Session,
} from "../types"
export const runColumns: Column<Run>[] = [
  {
    id: "id",
    header: "Run",
    cell: (r) => (
      <PluginLink to={`/runs/${r.id}`} className="font-mono text-xs underline">
        {r.id}
      </PluginLink>
    ),
  },
  {
    id: "agent",
    header: "Agent",
    cell: (r) => (
      <PluginLink
        to={`/agents/${r.agent_id}`}
        className="font-mono text-xs underline"
      >
        {r.agent_id}
      </PluginLink>
    ),
  },
  { id: "state", header: "State", cell: (r) => <State value={r.state} /> },
  { id: "steps", header: "Steps", cell: (r) => r.step_count },
  { id: "tokens", header: "Tokens", cell: (r) => r.tokens_used },
  {
    id: "duration",
    header: "Duration",
    cell: (r) =>
      r.started_at && r.completed_at
        ? `${Math.max(0, new Date(r.completed_at).getTime() - new Date(r.started_at).getTime())} ms`
        : ["running", "paused", "created"].includes(r.state)
          ? "In progress"
          : "Unavailable",
  },
  {
    id: "created",
    header: "Created",
    cell: (r) => <Timestamp value={r.created_at} label="created" />,
  },
]
export function RunsPage({ agentId }: { agentId?: string }) {
  const [page, setPage] = useState(1),
    [state, setState] = useState(""),
    [agent, setAgent] = useState(agentId ?? "")
  const q = useQuery<Page<Run>>("runs.list", {
    agent_id: agent,
    state,
    limit: 25,
    offset: (page - 1) * 25,
  })
  usePoll(q.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Runs"
        description="Saved execution, tool activity and failures."
        actions={<Reload onClick={q.refetch} />}
      />
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Filter agent ID"
          placeholder="Agent ID"
          className="max-w-96"
          value={agent}
          onChange={(e) => {
            setAgent(e.target.value)
            setPage(1)
          }}
        />
        <NativeSelect
          aria-label="Run state"
          value={state}
          onChange={(e) => {
            setState(e.target.value)
            setPage(1)
          }}
        >
          {[
            "",
            "created",
            "running",
            "paused",
            "completed",
            "failed",
            "cancelled",
          ].map((v) => (
            <NativeSelectOption key={v} value={v}>
              {v || "All states"}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <QueryBoundary title="Runs" query={q} keepPreviousData>
        {(data) => (
          <ResourceTable
            columns={runColumns}
            rows={data.items}
            rowKey={(r) => r.id}
            caption={`${data.total} runs`}
            emptyMessage={
              agent || state ? "No runs match these filters" : "No runs yet"
            }
            emptyAction={<PluginLink to="/chat">Open chat</PluginLink>}
            pagination={{ page, pageSize: 25, total: data.total }}
            onPageChange={setPage}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
function ResumePanel({ detail }: { detail: RunDetail }) {
  const cmd = useCommand<Run>("runs.resume"),
    [results, setResults] = useState<
      Record<string, { content: string; error: string }>
    >({}),
    allowed = useAccess("run")
  if (!detail.suspension) return null
  const { reason, pending } = detail.suspension
  if (reason !== "external_tool")
    return (
      <p className="rounded-md border p-3 text-sm">
        Waiting for{" "}
        {reason === "approval" ? (
          <PluginLink className="underline" to="/checkpoints">
            a checkpoint decision
          </PluginLink>
        ) : (
          "an agent reply through the messaging bus"
        )}
        .
      </p>
    )
  return (
    <form
      className="grid gap-3 rounded-md border p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        await cmd.execute({
          id: detail.run.id,
          tool_results: pending.map((p) => ({
            tool_call_id: p.id,
            ...results[p.id],
          })),
        })
      }}
    >
      <h2 className="text-sm font-medium">External tool results</h2>
      {pending.map((p) => (
        <div key={p.id} className="grid gap-2">
          <p className="text-sm">
            {p.name} · <code>{p.id}</code>
          </p>
          <Code text={p.arguments} label={`${p.name} arguments`} json />
          <Input
            aria-label={`${p.name} result`}
            placeholder="Result"
            value={results[p.id]?.content ?? ""}
            onChange={(e) =>
              setResults({
                ...results,
                [p.id]: {
                  content: e.target.value,
                  error: results[p.id]?.error ?? "",
                },
              })
            }
          />
          <Input
            aria-label={`${p.name} error`}
            placeholder="Execution error, if any"
            value={results[p.id]?.error ?? ""}
            onChange={(e) =>
              setResults({
                ...results,
                [p.id]: {
                  error: e.target.value,
                  content: results[p.id]?.content ?? "",
                },
              })
            }
          />
        </div>
      ))}
      <CommandAlert error={cmd.error} title="Resume failed" />
      <Button
        type="submit"
        size="sm"
        className="w-fit"
        disabled={
          cmd.loading ||
          !allowed ||
          pending.some((p) => !results[p.id]?.content && !results[p.id]?.error)
        }
      >
        {cmd.loading ? "Resuming…" : "Submit results and resume"}
      </Button>
    </form>
  )
}
export function RunPage({ id }: { id: string }) {
  const q = useQuery<RunDetail>("runs.detail", { id })
  usePoll(q.refetch)
  const cmd = useCommand("runs.cancel"),
    [open, setOpen] = useState(false),
    allowed = useAccess("run")
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Back to="/runs" label="runs" />
      <QueryBoundary title="Run" query={q} keepPreviousData>
        {(data) => (
          <>
            <PageHeader
              title="Run review"
              description={data.run.id}
              actions={
                <>
                  <State value={data.run.state} />
                  {allowed &&
                    ["running", "paused"].includes(data.run.state) && (
                      <IconAction
                        label="Cancel run"
                        icon={CircleStop}
                        onClick={() => {
                          cmd.reset()
                          setOpen(true)
                        }}
                      />
                    )}
                </>
              }
            />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <PluginLink
                to={`/agents/${data.run.agent_id}`}
                className="underline"
              >
                Agent configuration
              </PluginLink>
              {data.run.session_id && (
                <PluginLink
                  to={`/sessions/${data.run.session_id}`}
                  className="underline"
                >
                  Conversation memory
                </PluginLink>
              )}
              <PluginLink to={`/safety/scans/run/${id}`} className="underline">
                Safety scans
              </PluginLink>
              <ScopeLine scope={data.run.scope} />
            </div>
            <AuditDates created={data.run.created_at} />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <p>{data.run.step_count} steps</p>
              <p>{data.run.tokens_used} tokens</p>
            </div>
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              <div className="min-w-0">
                <h2 className="mb-2 text-sm font-medium">Input</h2>
                <Code text={data.run.input} label="Run input" />
              </div>
              <div className="min-w-0">
                <h2 className="mb-2 text-sm font-medium">Output</h2>
                <Code text={data.run.output ?? ""} label="Run output" />
              </div>
            </div>
            {data.run.error && (
              <p
                role="alert"
                className="rounded-md border border-destructive p-3 text-sm text-destructive"
              >
                {data.run.error}
              </p>
            )}
            <ResumePanel detail={data} />
            <h2 className="text-sm font-medium">Steps and tool calls</h2>
            {data.steps.length ? (
              data.steps.map((step) => (
                <article
                  key={step.id}
                  className="grid min-w-0 gap-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <h3>
                      Step {step.index + 1} · {step.type}
                    </h3>
                    <span>{step.tokens_used} tokens</span>
                  </div>
                  {step.input && (
                    <Code
                      text={step.input}
                      label={`Step ${step.index + 1} input`}
                    />
                  )}
                  <Code
                    text={step.output ?? ""}
                    label={`Step ${step.index + 1} output`}
                  />
                  {(data.tool_calls[step.id] ?? []).map((call) => (
                    <div
                      key={call.id}
                      className="grid gap-2 rounded-md bg-muted/30 p-3"
                    >
                      <h4 className="text-sm font-medium">{call.tool_name}</h4>
                      <Code
                        text={call.arguments}
                        label={`${call.tool_name} arguments`}
                        json
                      />
                      {call.result && (
                        <Code
                          text={call.result}
                          label={`${call.tool_name} result`}
                        />
                      )}
                      <Value value={call.error} label="tool error" />
                    </div>
                  ))}
                </article>
              ))
            ) : (
              <ZeroState
                title="No steps recorded"
                body="Recorded steps appear here as execution progresses."
              />
            )}
            <PluginSlot
              name="cortex.run.detail.sections"
              params={{ runId: id, run: data.run }}
            />
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel this run?"
        description="The engine will cancel this run and close pending approvals."
        confirmLabel="Cancel run"
        pending={cmd.loading}
        onConfirm={async () => {
          if ((await cmd.execute({ id })) !== undefined) setOpen(false)
        }}
      >
        <CommandAlert error={cmd.error} title="Cancellation failed" />
      </ConfirmDialog>
    </section>
  )
}
export const checkpointColumns: Column<Checkpoint>[] = [
  {
    id: "reason",
    header: "Reason",
    cell: (r) => (
      <PluginLink to={`/checkpoints/${r.id}`} className="underline">
        {r.reason}
      </PluginLink>
    ),
  },
  {
    id: "run",
    header: "Run",
    cell: (r) => (
      <PluginLink
        to={`/runs/${r.run_id}`}
        className="font-mono text-xs underline"
      >
        {r.run_id}
      </PluginLink>
    ),
  },
  { id: "step", header: "Step", cell: (r) => r.step_index + 1 },
  { id: "state", header: "State", cell: (r) => <State value={r.state} /> },
  {
    id: "created",
    header: "Created",
    cell: (r) => <Timestamp value={r.created_at} label="created" />,
  },
]
export function CheckpointsPage() {
  const [page, setPage] = useState(1),
    q = useQuery<Page<Checkpoint>>("checkpoints.list", {
      limit: 25,
      offset: (page - 1) * 25,
    })
  usePoll(q.refetch)
  return (
    <section className="flex flex-col gap-3">
      <PageHeader
        title="Pending approvals"
        description="Review the stored context before allowing a paused tool call."
        actions={<Reload onClick={q.refetch} />}
      />
      <QueryBoundary title="Checkpoints" query={q} keepPreviousData>
        {(data) => (
          <ResourceTable
            columns={checkpointColumns}
            rows={data.items}
            rowKey={(r) => r.id}
            caption={`${data.total} pending checkpoints`}
            emptyMessage="No pending approvals"
            pagination={{ page, pageSize: 25, total: data.total }}
            onPageChange={setPage}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
export function CheckpointPage({ id }: { id: string }) {
  const q = useQuery<Checkpoint>("checkpoints.detail", { id })
  usePoll(q.refetch)
  const [choice, setChoice] = useState<boolean | null>(null),
    [reason, setReason] = useState(""),
    cmd = useCommand("checkpoints.resolve"),
    allowed = useAccess("approve")
  return (
    <section className="flex flex-col gap-3">
      <Back to="/checkpoints" label="pending approvals" />
      <QueryBoundary title="Checkpoint" query={q} keepPreviousData>
        {(data) => (
          <>
            <PageHeader
              title="Review checkpoint"
              description={data.reason}
              actions={<State value={data.state} />}
            />
            <p className="font-mono text-xs break-all">{data.id}</p>
            <ScopeLine scope={data.scope} />
            <PluginLink
              to={`/runs/${data.run_id}`}
              className="text-sm underline"
            >
              Review run and tool arguments
            </PluginLink>
            <p className="text-sm">Step {data.step_index + 1}</p>
            {data.decision ? (
              <Value value={data.decision} label="decision" />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!allowed}
                  onClick={() => {
                    cmd.reset()
                    setReason("")
                    setChoice(true)
                  }}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!allowed}
                  onClick={() => {
                    cmd.reset()
                    setReason("")
                    setChoice(false)
                  }}
                >
                  Reject
                </Button>
              </div>
            )}
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={choice !== null}
        onOpenChange={(v) => {
          if (!v) setChoice(null)
        }}
        title={choice ? "Approve this checkpoint?" : "Reject this checkpoint?"}
        description="Your identity and reason are saved with the decision. Approval may execute the pending tool."
        confirmLabel={choice ? "Approve" : "Reject"}
        destructive={!choice}
        pending={cmd.loading}
        confirmDisabled={!reason.trim()}
        onConfirm={async () => {
          if (
            (await cmd.execute({ id, approved: choice, reason })) !== undefined
          )
            setChoice(null)
        }}
      >
        <Input
          aria-label="Decision reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
        <CommandAlert error={cmd.error} title="Decision failed" />
      </ConfirmDialog>
    </section>
  )
}
export function AgentPicker({
  selected,
  onChange,
}: {
  selected: string
  onChange: (id: string) => void
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    q = useQuery<Page<Agent>>("agents.list", {
      search,
      limit: 25,
      offset: page * 25,
    })
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Input
        aria-label="Find agent"
        placeholder="Find agent"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(0)
        }}
      />
      <QueryBoundary
        title="Agent choices"
        query={q}
        skeletonRows={1}
        keepPreviousData
      >
        {(data) => (
          <>
            <NativeSelect
              aria-label="Agent"
              value={selected}
              onChange={(e) => onChange(e.target.value)}
            >
              <NativeSelectOption value="">Select an agent</NativeSelectOption>
              {selected && !data.items.some((r) => r.id === selected) && (
                <NativeSelectOption value={selected}>
                  {selected} (selected)
                </NativeSelectOption>
              )}
              {data.items.map((r) => (
                <NativeSelectOption key={r.id} value={r.id}>
                  {r.name}
                  {r.enabled ? "" : " (disabled)"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {data.total > 25 && (
              <div className="flex gap-2">
                <IconAction
                  label="Previous agents"
                  icon={ChevronLeft}
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                />
                <IconAction
                  label="More agents"
                  icon={ChevronRight}
                  disabled={(page + 1) * 25 >= data.total}
                  onClick={() => setPage(page + 1)}
                />
              </div>
            )}
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
export function SessionsPage({ agentId }: { agentId?: string }) {
  const [agent, setAgent] = useState(agentId ?? ""),
    [page, setPage] = useState(1),
    [title, setTitle] = useState(""),
    create = useCommand<Session>("sessions.create"),
    allowed = useAccess("manage"),
    navigate = useNavigateTo(),
    q = useQuery<Page<Session>>("sessions.list", {
      agent_id: agent,
      limit: 25,
      offset: (page - 1) * 25,
    })
  usePoll(q.refetch)
  return (
    <section className="flex flex-col gap-3">
      <PageHeader
        title="Sessions and memory"
        description="Persistent conversations with stable IDs, message counts and scoped history."
        actions={<Reload onClick={q.refetch} />}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <AgentPicker
          selected={agent}
          onChange={(v) => {
            setAgent(v)
            setPage(1)
          }}
        />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const saved = await create.execute({ agent_id: agent, title })
            if (saved) navigate(`/sessions/${saved.id}`)
          }}
        >
          <Input
            className="min-w-48 flex-1"
            aria-label="New session title"
            placeholder="New session title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Button
            type="submit"
            size="sm"
            disabled={!agent || !title.trim() || create.loading || !allowed}
          >
            Create session
          </Button>
        </form>
      </div>
      <CommandAlert error={create.error} title="Session creation failed" />
      <QueryBoundary title="Sessions" query={q} keepPreviousData>
        {(data) => (
          <ResourceTable
            rows={data.items}
            rowKey={(r) => r.id}
            caption={`${data.total} sessions`}
            emptyMessage="No sessions yet"
            emptyAction={
              <PluginLink to="/chat">Start a conversation</PluginLink>
            }
            columns={[
              {
                id: "title",
                header: "Session",
                cell: (r) => (
                  <PluginLink to={`/sessions/${r.id}`} className="underline">
                    {r.title || "Untitled session"}
                    {r.is_default ? " (default)" : ""}
                  </PluginLink>
                ),
              },
              {
                id: "agent",
                header: "Agent",
                cell: (r) => (
                  <PluginLink
                    to={`/agents/${r.agent_id}`}
                    className="font-mono text-xs"
                  >
                    {r.agent_id}
                  </PluginLink>
                ),
              },
              {
                id: "messages",
                header: "Messages",
                cell: (r) => r.message_count,
              },
              { id: "tokens", header: "Tokens", cell: (r) => r.token_count },
              {
                id: "updated",
                header: "Updated",
                cell: (r) => <Timestamp value={r.updated_at} label="updated" />,
              },
            ]}
            pagination={{ page, pageSize: 25, total: data.total }}
            onPageChange={setPage}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
export function SessionPage({ id }: { id: string }) {
  const q = useQuery<Memory>("memory.detail", { id, limit: 500 })
  usePoll(q.refetch)
  const clear = useCommand("memory.clear"),
    del = useCommand("sessions.delete"),
    rename = useCommand<Session>("sessions.update"),
    [mode, setMode] = useState<"clear" | "delete" | "rename" | null>(null),
    [title, setTitle] = useState(""),
    allowed = useAccess("manage"),
    navigate = useNavigateTo(),
    cmd = mode === "delete" ? del : mode === "rename" ? rename : clear
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Back to="/sessions" label="sessions" />
      <QueryBoundary title="Memory" query={q} keepPreviousData>
        {(data) => (
          <>
            <PageHeader
              title={data.session.title || "Conversation memory"}
              description={data.session.id}
              actions={
                allowed ? (
                  <>
                    {[
                      "rename",
                      "clear",
                      ...(data.session.is_default ? [] : ["delete"]),
                    ].map((action) => (
                      <IconAction
                        label={
                          action === "rename"
                            ? "Rename"
                            : action === "clear"
                              ? "Clear memory"
                              : "Delete session"
                        }
                        icon={
                          action === "rename"
                            ? Pencil
                            : action === "clear"
                              ? Eraser
                              : Trash2
                        }
                        key={action}
                        onClick={() => {
                          clear.reset()
                          del.reset()
                          rename.reset()
                          setTitle(data.session.title)
                          setMode(action as typeof mode)
                        }}
                      />
                    ))}
                  </>
                ) : undefined
              }
            />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <ScopeLine scope={data.session.scope} />
              <span>
                {data.session.message_count} messages ·{" "}
                {data.session.token_count} tokens
              </span>
              <PluginLink
                to={`/chat/${data.session.agent_id}/session/${id}`}
                className="underline"
              >
                Continue chat
              </PluginLink>
            </div>
            {!data.complete && (
              <p role="status" className="text-xs text-muted-foreground">
                Showing the latest 500 messages. This is a partial history.
              </p>
            )}
            {data.messages.length ? (
              data.messages.map((m, i) => (
                <article
                  key={`${i}-${m.timestamp}`}
                  className="grid min-w-0 gap-2 rounded-md border p-3"
                >
                  <header className="flex flex-wrap justify-between gap-2 text-xs">
                    <span className="font-medium">{m.role}</span>
                    <Timestamp value={m.timestamp} label="message time" />
                  </header>
                  <Code text={m.content} label={`${m.role} message ${i + 1}`} />
                  {m.tool_calls && (
                    <Value value={m.tool_calls} label="tool calls" />
                  )}
                </article>
              ))
            ) : (
              <ZeroState
                title="No messages"
                body="This session has no saved conversation history."
                action={
                  <PluginLink
                    to={`/chat/${data.session.agent_id}/session/${id}`}
                  >
                    Start chatting
                  </PluginLink>
                }
              />
            )}
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={mode !== null}
        onOpenChange={(v) => {
          if (!v) setMode(null)
        }}
        title={
          mode === "delete"
            ? "Delete this session?"
            : mode === "rename"
              ? "Rename this session"
              : "Clear saved memory?"
        }
        description={
          mode === "rename"
            ? "The session keeps its ID and history."
            : "Saved conversation messages will be removed."
        }
        destructive={mode !== "rename"}
        confirmLabel={
          mode === "rename"
            ? "Save title"
            : mode === "delete"
              ? "Delete session"
              : "Clear memory"
        }
        pending={cmd.loading}
        confirmDisabled={mode === "rename" && !title.trim()}
        onConfirm={async () => {
          const saved = await cmd.execute(
            mode === "rename" ? { id, title } : { id }
          )
          if (saved !== undefined) {
            setMode(null)
            if (mode === "delete") navigate("/sessions", { replace: true })
          }
        }}
      >
        {mode === "rename" && (
          <Input
            aria-label="Session title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
        <CommandAlert error={cmd.error} title="Session command failed" />
      </ConfirmDialog>
    </section>
  )
}
function IntegrationSummary() {
  const knowledge = useQuery<{
    available: boolean
    total?: number
    summary?: { collections: number; documents: number; chunks: number }
  }>("knowledge.list", { limit: 1, offset: 0 })
  const safety = useQuery<{
    available: boolean
    summary?: {
      total: number
      blocked: number
      allowed: number
      flagged: number
    }
  }>("safety.scans", { limit: 1, offset: 0 })
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      <QueryBoundary
        title="Knowledge summary"
        query={knowledge}
        skeletonRows={1}
        keepPreviousData
      >
        {(data) => (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2">
            <PluginLink to="/knowledge" className="font-medium underline">
              Knowledge
            </PluginLink>
            <span className="text-muted-foreground">
              {!data.available
                ? "Provider not installed"
                : data.summary
                  ? `${data.summary.collections} collections · ${data.summary.documents} documents · ${data.summary.chunks} chunks`
                  : "Summary not supplied"}
            </span>
          </div>
        )}
      </QueryBoundary>
      <QueryBoundary
        title="Safety summary"
        query={safety}
        skeletonRows={1}
        keepPreviousData
      >
        {(data) => (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2">
            <PluginLink to="/safety/scans" className="font-medium underline">
              Safety scans
            </PluginLink>
            <span className="text-muted-foreground">
              {data.available && data.summary
                ? `${data.summary.total} scans · ${data.summary.blocked} blocked · ${data.summary.flagged} flagged · ${data.summary.allowed} allowed · ${data.summary.total ? ((100 * data.summary.blocked) / data.summary.total).toFixed(1) + "% block rate" : "No block rate yet"}`
                : data.available
                  ? "Summary not supplied"
                  : "Provider not installed"}
            </span>
          </div>
        )}
      </QueryBoundary>
    </div>
  )
}
export function OverviewPage() {
  const stats = useQuery<Record<string, number>>("overview.stats"),
    runtime = useQuery<Runtime>("runtime.detail"),
    runs = useQuery<Page<Run>>("runs.list", { limit: 5, offset: 0 }),
    checks = useQuery<Page<Checkpoint>>("checkpoints.list", {
      limit: 5,
      offset: 0,
    })
  usePoll(stats.refetch)
  usePoll(runs.refetch)
  usePoll(checks.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Cortex"
        description="Agent configuration, execution and human review."
        actions={
          <PluginLink to="/chat" className={buttonVariants({ size: "sm" })}>
            Open chat
          </PluginLink>
        }
      />
      <QueryBoundary title="Runtime" query={runtime} skeletonRows={1}>
        {(data) => (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
            <span>
              {data.execution_label} · <ScopeLine scope={data.scope} />
            </span>
            <PluginLink to="/settings" className="underline">
              Runtime capabilities
            </PluginLink>
          </div>
        )}
      </QueryBoundary>
      <QueryBoundary title="Counts" query={stats} keepPreviousData>
        {(data) => (
          <StatGrid
            className="grid-cols-2 gap-2 @xl/main:grid-cols-4"
            items={Object.entries(data).map(([label, value]) => ({
              label,
              value,
              tone:
                label === "checkpoints" && value > 0 ? "warning" : "default",
            }))}
          />
        )}
      </QueryBoundary>
      <IntegrationSummary />
      <QueryBoundary title="Pending approvals" query={checks} keepPreviousData>
        {(data) => (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <h2 className="font-medium">Pending approvals</h2>
              <PluginLink to="/checkpoints" className="underline">
                View all ({data.total})
              </PluginLink>
            </div>
            <ResourceTable
              rows={data.items}
              rowKey={(r) => r.id}
              columns={checkpointColumns}
              caption={`${data.total} pending checkpoints`}
              emptyMessage="No pending approvals"
            />
          </div>
        )}
      </QueryBoundary>
      <QueryBoundary title="Recent runs" query={runs} keepPreviousData>
        {(data) => (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Recent runs</h2>
            <ResourceTable
              rows={data.items}
              rowKey={(r) => r.id}
              columns={runColumns}
              caption={`${data.total} runs, latest ${data.items.length}`}
              emptyMessage="No runs yet"
              emptyAction={
                <PluginLink to="/chat">Start a conversation</PluginLink>
              }
            />
          </div>
        )}
      </QueryBoundary>
      <PluginSlot name="cortex.overview.widgets" />
    </section>
  )
}
