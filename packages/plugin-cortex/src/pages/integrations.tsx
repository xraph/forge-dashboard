import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Plus, Reply, MailCheck } from "@forge-go/dashboard-kit/icons"
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
} from "@forge-go/dashboard-kit/icons"
import { useState } from "react"
import {
  PluginLink,
  PluginSlot,
  useCommand,
  useNavigateTo,
  usePoll,
  useQuery,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import {
  Back,
  IconAction,
  Code,
  Reload,
  ScopeLine,
  State,
  useAccess,
  Value,
} from "../components"
import { FormFields, type Draft } from "../form"
import { overlayFields } from "../schema"
import { AgentPicker } from "./operations"
import type {
  Catalog,
  Conversation,
  Envelope,
  MorePage,
  Overlay,
  Page,
  Runtime,
  ToolDefinition,
} from "../types"
const catalogSpecs = {
  models: {
    label: "Models",
    intent: "models.list",
    columns: [
      "name",
      "provider",
      "context_window",
      "max_output",
      "pricing",
      "capabilities",
    ],
    detail: "models",
  },
  knowledge: {
    label: "Knowledge collections",
    intent: "knowledge.list",
    columns: [
      "name",
      "document_count",
      "chunk_count",
      "embedding_model",
      "chunk_strategy",
    ],
    detail: "knowledge",
  },
  profiles: {
    label: "Safety profiles",
    intent: "safety.profiles",
    columns: ["name", "description", "enabled", "id"],
    detail: "",
  },
  scans: {
    label: "Safety scans",
    intent: "safety.scans",
    columns: [
      "id",
      "direction",
      "decision",
      "findings",
      "pii_count",
      "profile_used",
      "duration_ms",
      "created_at",
    ],
    detail: "",
  },
} as const
export function CatalogPage({
  kind,
  runId,
}: {
  kind: keyof typeof catalogSpecs
  runId?: string
}) {
  const spec = catalogSpecs[kind],
    [search, setSearch] = useState(""),
    [provider, setProvider] = useState(""),
    [page, setPage] = useState(1),
    q = useQuery<Catalog>(spec.intent, {
      search,
      provider,
      run_id: runId,
      limit: 25,
      offset: (page - 1) * 25,
    })
  usePoll(q.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title={spec.label}
        description={
          runId
            ? `Scans for run ${runId}`
            : "Authorized metadata from the installed provider. Provider configuration and live availability are separate."
        }
        actions={<Reload onClick={q.refetch} />}
      />
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search catalog"
          placeholder="Search"
          className="max-w-sm"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        {kind === "models" && (
          <Input
            aria-label="Provider filter"
            placeholder="Provider"
            className="max-w-48"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value)
              setPage(1)
            }}
          />
        )}
      </div>
      <QueryBoundary title={spec.label} query={q} keepPreviousData>
        {(data) =>
          !data.available ? (
            <ZeroState
              title={`${spec.label} provider unavailable`}
              body={data.reason ?? "An authorized provider is required."}
              action={
                <PluginLink to="/settings">
                  Review runtime capabilities
                </PluginLink>
              }
            />
          ) : (
            <>
              {data.summary && (
                <Value value={data.summary} label="scan summary" />
              )}
              {data.complete === false && (
                <p role="status" className="text-xs text-muted-foreground">
                  This provider returned a partial result.
                </p>
              )}
              <ResourceTable
                rows={data.items}
                rowKey={(r) => String(r.id)}
                caption={`${data.total ?? data.items.length} ${spec.label.toLowerCase()}`}
                emptyMessage={`No ${spec.label.toLowerCase()} match these filters`}
                columns={spec.columns.map((key) => ({
                  id: key,
                  header: key.replaceAll("_", " "),
                  cell: (r: Record<string, unknown>) =>
                    key === "name" && spec.detail ? (
                      <PluginLink
                        to={`/${spec.detail}/${encodeURIComponent(String(r.id))}`}
                        className="underline"
                      >
                        {String(r.name ?? r.id)}
                      </PluginLink>
                    ) : key === "created_at" ? (
                      <Timestamp value={String(r[key])} label="created" />
                    ) : (
                      <div className="max-w-80">
                        <Value value={r[key]} label={key} />
                      </div>
                    ),
                }))}
                pagination={
                  data.total !== undefined
                    ? { page, pageSize: 25, total: data.total }
                    : undefined
                }
                onPageChange={setPage}
              />
            </>
          )
        }
      </QueryBoundary>
    </section>
  )
}
export function CatalogDetail({
  kind,
  id,
}: {
  kind: "models" | "knowledge"
  id: string
}) {
  const q = useQuery<Catalog>(`${kind}.detail`, { id: decodeURIComponent(id) })
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Back to={`/${kind}`} label={kind} />
      <PageHeader
        title={kind === "models" ? "Model details" : "Knowledge collection"}
      />
      <QueryBoundary title="Catalog detail" query={q}>
        {(data) =>
          !data.available ? (
            <ZeroState
              title="Provider unavailable"
              body={data.reason}
              action={<PluginLink to="/settings">Review runtime</PluginLink>}
            />
          ) : data.items.length ? (
            <Value value={data.items[0]} label="details" />
          ) : (
            <ZeroState
              title="Resource unavailable"
              body="The provider returned no matching resource."
            />
          )
        }
      </QueryBoundary>
    </section>
  )
}
function ToolMetric({
  agentId,
  name,
  metric,
}: {
  agentId: string
  name: string
  metric: "agents" | "skills" | "calls" | "error_rate"
}) {
  const q = useQuery<{
    agents: unknown[]
    skills: unknown[]
    calls: number
    error_rate: number | null
  }>("tools.usage", { id: agentId, name })
  if (q.error)
    return (
      <span title={q.error.message} className="text-destructive">
        Unavailable
      </span>
    )
  if (!q.data) return <span aria-label="Loading usage">…</span>
  const value = q.data[metric]
  return (
    <span>
      {Array.isArray(value)
        ? value.length
        : value === null
          ? "No calls"
          : metric === "error_rate"
            ? `${(Number(value) * 100).toFixed(1)}%`
            : value}
    </span>
  )
}
export function ToolsPage({ agentId }: { agentId?: string }) {
  const [agent, setAgent] = useState(agentId ?? ""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    q = useQuery<{ items: ToolDefinition[]; total: number }>(
      "tools.list",
      { id: agent },
      { enabled: !!agent }
    )
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Authorized tools"
        description="Definitions visible to this agent through runtime overlays and the host tool authorizer."
      />
      <div className="max-w-lg">
        <AgentPicker
          selected={agent}
          onChange={(id) => {
            setAgent(id)
            setPage(1)
          }}
        />
      </div>
      {agent ? (
        <>
          <Input
            aria-label="Search tools"
            placeholder="Search tools"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="max-w-sm"
          />
          <QueryBoundary title="Tools" query={q}>
            {(data) => {
              const filtered = data.items.filter((t) =>
                `${t.Name} ${t.Description}`
                  .toLowerCase()
                  .includes(search.toLowerCase())
              )
              return (
                <ResourceTable
                  pagination={{ page, pageSize: 25, total: filtered.length }}
                  onPageChange={setPage}
                  rows={data.items
                    .filter((t) =>
                      `${t.Name} ${t.Description}`
                        .toLowerCase()
                        .includes(search.toLowerCase())
                    )
                    .slice((page - 1) * 25, page * 25)}
                  rowKey={(t) => t.Name}
                  caption={`${data.total} visible tools`}
                  emptyMessage="No tools match"
                  columns={[
                    {
                      id: "name",
                      header: "Name",
                      cell: (t) => (
                        <PluginLink
                          to={`/tools/${agent}/${encodeURIComponent(t.Name)}`}
                          className="underline"
                        >
                          {t.Name}
                        </PluginLink>
                      ),
                    },
                    {
                      id: "description",
                      header: "Description",
                      cell: (t) => t.Description,
                    },
                    {
                      id: "source",
                      header: "Source",
                      cell: () => "Runtime definition",
                    },
                    ...(
                      ["agents", "skills", "calls", "error_rate"] as const
                    ).map((metric) => ({
                      id: metric,
                      header:
                        metric === "error_rate"
                          ? "Error rate"
                          : metric[0].toUpperCase() + metric.slice(1),
                      cell: (t: ToolDefinition) => (
                        <ToolMetric
                          agentId={agent}
                          name={t.Name}
                          metric={metric}
                        />
                      ),
                    })),
                  ]}
                />
              )
            }}
          </QueryBoundary>
        </>
      ) : (
        <ZeroState
          title="Select an agent"
          body="Tool visibility is evaluated for a real agent and the current principal."
        />
      )}
    </section>
  )
}
export function ToolPage({ agentId, name }: { agentId: string; name: string }) {
  const q = useQuery<{ items: ToolDefinition[] }>("tools.list", {
      id: agentId,
    }),
    usage = useQuery<{
      calls: number
      errors: number
      error_rate: number | null
      agents: { id: string; name: string }[]
      skills: Record<string, unknown>[]
    }>("tools.usage", { id: agentId, name: decodeURIComponent(name) })
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Back to={`/tools/${agentId}`} label="authorized tools" />
      <PageHeader title={decodeURIComponent(name)} />
      <QueryBoundary title="Tool definition" query={q}>
        {(data) => {
          const tool = data.items.find(
            (t) => t.Name === decodeURIComponent(name)
          )
          return tool ? (
            <>
              <p className="text-sm">{tool.Description}</p>
              <Code
                text={JSON.stringify(tool.Parameters, null, 2)}
                label="Tool input schema"
                json
              />
            </>
          ) : (
            <ZeroState
              title="Tool is not visible"
              body="The agent or host policy may have changed."
            />
          )
        }}
      </QueryBoundary>
      <QueryBoundary title="Scoped tool usage" query={usage}>
        {(data) => (
          <>
            <p className="text-sm">
              {data.calls} recorded calls · {data.errors} errors ·{" "}
              {data.error_rate === null
                ? "No error rate yet"
                : `${(data.error_rate * 100).toFixed(1)}% error rate`}
            </p>
            <h2 className="text-sm font-medium">Agent references</h2>
            {data.agents.length ? (
              <div className="flex flex-wrap gap-3 text-sm">
                {data.agents.map((a) => (
                  <PluginLink
                    key={a.id}
                    to={`/agents/${a.id}`}
                    className="underline"
                  >
                    {a.name}
                  </PluginLink>
                ))}
              </div>
            ) : (
              <ZeroState
                title="No direct agent references"
                body="This tool may still be inherited or supplied by runtime policy."
              />
            )}
            <h2 className="text-sm font-medium">Skill bindings</h2>
            {data.skills.length ? (
              <Value value={data.skills} label="skill bindings" />
            ) : (
              <ZeroState
                title="No skill bindings"
                body="No scoped skill binds this tool."
              />
            )}
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
export function SettingsPage() {
  const runtime = useQuery<Runtime>("runtime.detail"),
    settings = useQuery<Record<string, unknown>>("settings.detail")
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Runtime settings"
        description="Actual process configuration. These defaults are read-only and are not persisted by Cortex."
      />
      <QueryBoundary title="Runtime capabilities" query={runtime}>
        {(data) => (
          <>
            <div className="flex flex-wrap gap-3 text-sm">
              <span>{data.execution_label}</span>
              <ScopeLine scope={data.scope} />
            </div>
            <Value
              value={{
                llm: data.llm,
                safety_scanner: data.safety,
                knowledge_provider: data.knowledge,
                tool_authorizer: data.tool_authorizer,
                audit_recorder: data.audit,
                a2a_bus: data.a2a,
                plugins: data.plugins,
              }}
              label="runtime capabilities"
            />
            <div className="rounded-md border p-3">
              <h2 className="mb-2 text-sm font-medium">Runtime boundaries</h2>
              <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                {data.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </QueryBoundary>
      <QueryBoundary title="Runtime defaults" query={settings}>
        {(data) => <Value value={data} label="settings" />}
      </QueryBoundary>
      <PluginSlot name="cortex.settings.tabs" />
    </section>
  )
}
function OverlayForm({
  agentId,
  initial,
  onSaved,
}: {
  agentId: string
  initial?: Overlay
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Draft>(initial ? { ...initial } : {}),
    [invalid, setInvalid] = useState<Record<string, boolean>>({}),
    cmd = useCommand<Overlay>("overlays.save"),
    allowed = useAccess("overlay")
  return (
    <form
      className="grid min-w-0 gap-3 rounded-md border p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (await cmd.execute({ ...draft, id: initial?.id, agent_id: agentId }))
          onSaved()
      }}
    >
      <h2 className="text-sm font-medium">
        {initial ? "Edit overlay" : "New host overlay"}
      </h2>
      <p className="text-xs text-muted-foreground">
        This applies at the agent’s exact stored scope. Narrower overlays may
        regrant tools; only host operators should hold overlay permission.
      </p>
      <fieldset
        disabled={cmd.loading || !allowed}
        className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <FormFields
          fields={overlayFields}
          value={draft}
          onChange={setDraft}
          onValidity={(path, valid) =>
            setInvalid((prev) => {
              const next = { ...prev }
              if (valid) delete next[path]
              else next[path] = true
              return next
            })
          }
        />
      </fieldset>
      <CommandAlert error={cmd.error} title="Overlay save failed" />
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={cmd.loading || !allowed || Object.keys(invalid).length > 0}
        >
          Save overlay
        </Button>
        <IconButton variant="outline" onClick={onSaved} label="Close editor" />
      </div>
    </form>
  )
}
export function OverlaysPage({ agentId }: { agentId: string }) {
  const [page, setPage] = useState(0),
    [edit, setEdit] = useState<Overlay | null | undefined>(),
    [selected, setSelected] = useState<Overlay | null>(null),
    cmd = useCommand("overlays.delete"),
    allowed = useAccess("overlay"),
    q = useQuery<MorePage<Overlay>>("overlays.list", {
      agent_id: agentId,
      limit: 25,
      offset: page * 25,
    })
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Back to={`/agents/${agentId}`} label="agent" />
      <PageHeader
        title="Prompt overlays"
        description="Ordered patches and runtime adjustments at authorized scopes."
        actions={
          allowed ? (
            <IconAction
              label="New overlay"
              icon={Plus}
              onClick={() => setEdit(null)}
            />
          ) : undefined
        }
      />
      {edit !== undefined && (
        <OverlayForm
          key={edit?.id ?? "new"}
          agentId={agentId}
          initial={edit ?? undefined}
          onSaved={() => setEdit(undefined)}
        />
      )}
      <QueryBoundary title="Overlays" query={q} keepPreviousData>
        {(data) => (
          <>
            <ResourceTable
              rows={data.items}
              rowKey={(r) => r.id}
              caption={`Showing ${data.items.length} overlays${data.has_more ? ", more available" : ""}`}
              emptyMessage="No overlays"
              columns={[
                {
                  id: "scope",
                  header: "Scope",
                  cell: (r) => <ScopeLine scope={r.scope} />,
                },
                {
                  id: "patches",
                  header: "Patches",
                  cell: (r) => r.patches?.length ?? 0,
                },
                {
                  id: "model",
                  header: "Model",
                  cell: (r) => <Value value={r.model} label="model" />,
                },
              ]}
              rowActions={
                allowed
                  ? (r) => (
                      <>
                        <IconAction
                          label="Edit"
                          icon={Pencil}
                          onClick={() => setEdit(r)}
                        />
                        <IconAction
                          label="Delete"
                          icon={Trash2}
                          onClick={() => {
                            cmd.reset()
                            setSelected(r)
                          }}
                        />
                      </>
                    )
                  : undefined
              }
            />
            <div className="flex gap-2">
              <IconAction
                label="Previous"
                icon={ChevronLeft}
                disabled={!page}
                onClick={() => setPage(page - 1)}
              />
              <IconAction
                label="Next"
                icon={ChevronRight}
                disabled={!data.has_more}
                onClick={() => setPage(page + 1)}
              />
            </div>
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={selected !== null}
        onOpenChange={(v) => {
          if (!v) setSelected(null)
        }}
        title="Delete this overlay?"
        description="Future runs will use the remaining overlays and agent configuration."
        confirmLabel="Delete overlay"
        pending={cmd.loading}
        onConfirm={async () => {
          if (
            selected &&
            (await cmd.execute({ id: selected.id })) !== undefined
          )
            setSelected(null)
        }}
      >
        <CommandAlert error={cmd.error} title="Overlay delete failed" />
      </ConfirmDialog>
    </section>
  )
}
export function ConversationsPage({ id }: { id?: string }) {
  const [page, setPage] = useState(0),
    [receiver, setReceiver] = useState(""),
    [content, setContent] = useState(""),
    [reply, setReply] = useState(""),
    send = useCommand<{ conversation_id: string }>("messages.send"),
    inbox = useCommand<{ items: unknown[] }>("messages.inbox"),
    allowed = useAccess("run"),
    manage = useAccess("manage"),
    navigate = useNavigateTo(),
    runtime = useQuery<Runtime>("runtime.detail"),
    list = useQuery<MorePage<Conversation>>(
      "conversations.list",
      { limit: 25, offset: page * 25 },
      { enabled: !id }
    ),
    detail = useQuery<{
      conversation: Conversation
      messages: Envelope[]
      complete: boolean
    }>("conversations.detail", { id }, { enabled: !!id })
  usePoll(list.refetch)
  usePoll(detail.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {id && <Back to="/conversations" label="conversations" />}
      <PageHeader
        title="Agent messaging"
        description="Scoped conversations and operator messages through the opt-in A2A bus."
      />
      {runtime.data && !runtime.data.a2a && (
        <ZeroState
          title="Messaging is not installed"
          body="Saved conversations remain readable. Sending requires a configured A2A bus."
        />
      )}
      {id ? (
        <QueryBoundary title="Conversation" query={detail} keepPreviousData>
          {(data) => (
            <>
              <ScopeLine scope={data.conversation.scope} />
              <Value value={data.conversation} label="conversation" />
              {!data.complete && (
                <p className="text-xs text-muted-foreground">
                  Showing the latest 100 messages. This history is partial.
                </p>
              )}
              {data.messages.length ? (
                data.messages.map((m) => (
                  <article
                    key={m.id}
                    className="grid min-w-0 gap-2 rounded-md border p-3"
                  >
                    <header className="flex flex-wrap justify-between gap-2 text-xs">
                      <span>
                        {m.sender.agent} →{" "}
                        {m.receivers.map((r) => r.agent).join(", ")} ·{" "}
                        {m.performative}
                      </span>
                      <Timestamp value={m.created_at} label="message time" />
                    </header>
                    <Code text={m.content} label="Message content" />
                    {m.reply_with && (
                      <IconAction
                        label={`Reply to ${m.reply_with}`}
                        icon={Reply}
                        className="w-fit"
                        onClick={() => setReply(m.reply_with!)}
                      />
                    )}
                  </article>
                ))
              ) : (
                <ZeroState
                  title="No messages"
                  body="This conversation has no saved envelopes."
                />
              )}
            </>
          )}
        </QueryBoundary>
      ) : (
        <QueryBoundary title="Conversations" query={list} keepPreviousData>
          {(data) => (
            <>
              <ResourceTable
                rows={data.items}
                rowKey={(r) => r.id}
                caption={`${data.items.length} conversations shown${data.has_more ? ", more available" : ""}`}
                emptyMessage="No conversations yet"
                columns={[
                  {
                    id: "id",
                    header: "Conversation",
                    cell: (r) => (
                      <PluginLink
                        to={`/conversations/${r.id}`}
                        className="font-mono text-xs underline"
                      >
                        {r.id}
                      </PluginLink>
                    ),
                  },
                  {
                    id: "state",
                    header: "State",
                    cell: (r) => <State value={r.status} />,
                  },
                  {
                    id: "hops",
                    header: "Hops",
                    cell: (r) => `${r.hops_used} / ${r.hop_ceiling}`,
                  },
                  {
                    id: "created",
                    header: "Created",
                    cell: (r) => (
                      <Timestamp value={r.created_at} label="created" />
                    ),
                  },
                ]}
              />
              <div className="flex gap-2">
                <IconAction
                  label="Previous"
                  icon={ChevronLeft}
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                />
                <IconAction
                  label="Next"
                  icon={ChevronRight}
                  disabled={!data.has_more}
                  onClick={() => setPage(page + 1)}
                />
              </div>
            </>
          )}
        </QueryBoundary>
      )}
      <div className="grid min-w-0 gap-3 rounded-md border p-3">
        <h2 className="text-sm font-medium">Send an operator message</h2>
        <p className="text-xs text-muted-foreground">
          The server stamps your identity as sender. Messages cannot impersonate
          an agent.
        </p>
        <AgentPicker selected={receiver} onChange={setReceiver} />
        <Input
          aria-label="Reply correlation"
          placeholder="Reply correlation token (optional)"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <Code text={content} label="Operator message" onChange={setContent} />
        <CommandAlert
          error={send.error ?? inbox.error}
          title="Messaging failed"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={
              !allowed ||
              !runtime.data?.a2a ||
              !receiver ||
              !content.trim() ||
              send.loading
            }
            onClick={async () => {
              const saved = await send.execute({
                receiver_id: receiver,
                conversation_id: id ?? "",
                content,
                in_reply_to: reply,
              })
              if (saved) {
                setContent("")
                navigate(`/conversations/${saved.conversation_id}`)
              }
            }}
          >
            Send message
          </Button>
          <IconAction
            label="Read and mark inbox"
            icon={MailCheck}
            disabled={
              !manage || !runtime.data?.a2a || !receiver || inbox.loading
            }
            onClick={() => inbox.execute({ id: receiver })}
          />
        </div>
        {inbox.data && (
          <Value value={inbox.data.items} label="Inbox (latest 100)" />
        )}
      </div>
    </section>
  )
}
interface OrchestrationRun {
  id: string
  config_id?: string
  strategy: string
  status: string
  input: string
  output?: string
  error?: string
  agent_run_ids?: string[]
  started_at: string
  completed_at?: string
}
export function OrchestrationRunsPage({ id }: { id?: string }) {
  const [page, setPage] = useState(1),
    list = useQuery<Page<OrchestrationRun>>(
      "orchestrationRuns.list",
      { limit: 25, offset: (page - 1) * 25 },
      { enabled: !id }
    ),
    detail = useQuery<OrchestrationRun>(
      "orchestrationRuns.detail",
      { id },
      { enabled: !!id }
    )
  usePoll(list.refetch)
  usePoll(detail.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader title="Orchestration runs" />
      {id ? (
        <>
          <Back to="/orchestration-runs" label="orchestration runs" />
          <QueryBoundary
            title="Orchestration run"
            query={detail}
            keepPreviousData
          >
            {(data) => (
              <>
                <Value value={data} label="orchestration result" />
                {data.config_id && (
                  <PluginLink
                    to={`/orchestrations/${data.config_id}`}
                    className="text-sm underline"
                  >
                    Saved configuration
                  </PluginLink>
                )}
                <div className="flex flex-wrap gap-3">
                  {data.agent_run_ids?.map((run) => (
                    <PluginLink
                      key={run}
                      to={`/runs/${run}`}
                      className="font-mono text-xs underline"
                    >
                      {run}
                    </PluginLink>
                  ))}
                </div>
              </>
            )}
          </QueryBoundary>
        </>
      ) : (
        <QueryBoundary title="Orchestration runs" query={list} keepPreviousData>
          {(data) => (
            <ResourceTable
              rows={data.items}
              rowKey={(r) => r.id}
              caption={`${data.total} orchestration runs`}
              emptyMessage="No orchestration runs yet"
              emptyAction={
                <PluginLink to="/orchestrations">
                  Review orchestration configurations
                </PluginLink>
              }
              columns={[
                {
                  id: "id",
                  header: "Run",
                  cell: (r) => (
                    <PluginLink
                      to={`/orchestration-runs/${r.id}`}
                      className="font-mono text-xs underline"
                    >
                      {r.id}
                    </PluginLink>
                  ),
                },
                { id: "strategy", header: "Strategy", cell: (r) => r.strategy },
                {
                  id: "state",
                  header: "State",
                  cell: (r) => <State value={r.status} />,
                },
                {
                  id: "started",
                  header: "Started",
                  cell: (r) => (
                    <Timestamp value={r.started_at} label="started" />
                  ),
                },
              ]}
              pagination={{ page, pageSize: 25, total: data.total }}
              onPageChange={setPage}
            />
          )}
        </QueryBoundary>
      )}
    </section>
  )
}
export function OrchestrationExecute({ id }: { id: string }) {
  const [input, setInput] = useState(""),
    cmd = useCommand<OrchestrationRun>("orchestrations.execute"),
    runtime = useQuery<Runtime>("runtime.detail"),
    allowed = useAccess("run")
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Back to={`/orchestrations/${id}`} label="orchestration" />
      <PageHeader
        title="Execute orchestration"
        description="Run the saved strategy with its scoped participant agents."
      />
      <Code text={input} label="Orchestration input" onChange={setInput} />
      <Button
        size="sm"
        className="w-fit"
        disabled={
          !allowed || !runtime.data?.llm || !input.trim() || cmd.loading
        }
        onClick={() => cmd.execute({ id, input })}
      >
        {cmd.loading ? "Running…" : "Execute"}
      </Button>
      <CommandAlert error={cmd.error} title="Orchestration failed" />
      {cmd.data && (
        <PluginLink
          to={`/orchestration-runs/${cmd.data.id}`}
          className="text-sm underline"
        >
          Review orchestration result
        </PluginLink>
      )}
    </section>
  )
}
