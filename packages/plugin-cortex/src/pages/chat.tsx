import { Columns2, X, Eye, CircleStop } from "@forge-go/dashboard-kit/icons"
import { ChevronLeft, ChevronRight } from "@forge-go/dashboard-kit/icons"
import { useEffect, useState } from "react"
import {
  ContractError,
  PluginLink,
  PluginSlot,
  useCommand,
  usePluginClient,
  usePoll,
  useQuery,
  useSlotEntries,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import {
  IconAction,
  Code,
  ScopeLine,
  State,
  useAccess,
  Value,
} from "../components"
import { FormFields, type Draft } from "../form"
import { schemas } from "../schema"
import { AgentPicker } from "./operations"
import type {
  Agent,
  LiveEvent,
  LiveFeed,
  Memory,
  Page,
  RunDetail,
  Runtime,
  Session,
} from "../types"
function LiveRun({
  id,
  onDone,
  state,
}: {
  id: string
  onDone: () => void
  state?: string
}) {
  const client = usePluginClient(),
    [events, setEvents] = useState<LiveEvent[]>([]),
    [error, setError] = useState<ContractError>(),
    [done, setDone] = useState(false),
    [partial, setPartial] = useState(false),
    [available, setAvailable] = useState(true),
    [retry, setRetry] = useState(0),
    cancel = useCommand("runs.cancel"),
    [stopping, setStopping] = useState(false)
  useEffect(() => {
    let stopped = false,
      cursor = 0,
      timer: ReturnType<typeof setTimeout> | undefined
    const pump = async () => {
      if (stopped) return
      if (document.visibilityState === "hidden") {
        timer = setTimeout(pump, 500)
        return
      }
      try {
        const feed = await client.query<LiveFeed>("runs.events", {
          id,
          after: cursor,
        })
        if (stopped) return
        cursor = feed.next
        setAvailable(feed.available)
        setPartial((v) => v || feed.lost)
        setEvents((prev) =>
          feed.events.length ? [...prev, ...feed.events] : prev
        )
        if (feed.done) {
          setDone(true)
          onDone()
          return
        }
        timer = setTimeout(pump, 350)
      } catch (err) {
        if (!stopped) setError(err as ContractError)
      }
    }
    void pump()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
    // onDone changes with the parent render, while this stream's identity stays fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, client, retry])
  const text = events
    .filter((e) => e.event === "token")
    .map((e) => String(e.data.content ?? ""))
    .join("")
  return (
    <article className="grid min-w-0 gap-2 rounded-md border p-3">
      <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <PluginLink to={`/runs/${id}`} className="font-mono text-xs underline">
          {id}
        </PluginLink>
        <div className="flex items-center gap-2">
          <State
            value={
              done
                ? (state ??
                  (events.some((e) => e.event === "suspended")
                    ? "suspended"
                    : events.some((e) => e.event === "error")
                      ? "failed"
                      : "completed"))
                : "running"
            }
          />
          {!done && (
            <IconAction
              label={stopping ? "Stopping…" : "Stop"}
              icon={CircleStop}
              disabled={cancel.loading || stopping}
              onClick={async () => {
                if ((await cancel.execute({ id })) !== undefined)
                  setStopping(true)
              }}
            />
          )}
        </div>
      </header>
      <CommandAlert error={cancel.error} title="Stop failed" />
      <CommandAlert error={error} title="Live events failed" />
      {error && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => {
            setError(undefined)
            setEvents([])
            setRetry(retry + 1)
          }}
        >
          Retry live events
        </Button>
      )}
      {(!available || partial) && (
        <p role="status" className="text-xs text-muted-foreground">
          {!available
            ? "The live feed has expired or the server restarted."
            : "Some live events were dropped."}{" "}
          Open the saved run for its durable result.
        </p>
      )}
      {text &&
        (done ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Stream transcript
            </summary>
            <Code text={text} label="Live assistant response" />
          </details>
        ) : (
          <Code text={text} label="Live assistant response" />
        ))}
      <div className="grid gap-1 text-xs text-muted-foreground">
        {events
          .filter((e) => e.event !== "token")
          .map((e, i) => (
            <div key={i} className="min-w-0">
              <span className="font-medium">
                {e.event.replaceAll("_", " ")}
              </span>
              {e.event === "suspended" ? (
                <PluginLink to={`/runs/${id}`} className="ml-2 underline">
                  Review suspended run and pending calls
                </PluginLink>
              ) : e.event === "checkpoint" ? (
                <PluginLink
                  to={`/checkpoints/${String(e.data.checkpoint_id ?? e.data.id ?? "")}`}
                  className="ml-2 underline"
                >
                  Review approval
                </PluginLink>
              ) : (
                <details className="inline-block align-top">
                  <summary className="ml-2 cursor-pointer">
                    {e.event === "tool_call"
                      ? String(e.data.tool_name ?? "Tool call")
                      : e.event === "done"
                        ? `${String(e.data.tokens_used ?? 0)} tokens · ${String(e.data.duration_ms ?? 0)} ms`
                        : "Details"}
                  </summary>
                  <div className="mt-1">
                    <Value value={e.data} label={e.event} />
                  </div>
                </details>
              )}
            </div>
          ))}
      </div>
      <PluginSlot
        name="cortex.chat.message.actions"
        params={{ runId: id, events }}
      />
    </article>
  )
}
function SessionSelector({
  agentId,
  value,
  onChange,
}: {
  agentId: string
  value: string
  onChange: (id: string) => void
}) {
  const [page, setPage] = useState(0),
    q = useQuery<Page<Session>>("sessions.list", {
      agent_id: agentId,
      limit: 25,
      offset: page * 25,
    })
  return (
    <QueryBoundary
      title="Session choices"
      query={q}
      skeletonRows={1}
      keepPreviousData
    >
      {(data) => (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="Session"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <NativeSelectOption value="">
              Default conversation
            </NativeSelectOption>
            {value && !data.items.some((s) => s.id === value) && (
              <NativeSelectOption value={value}>
                {value} (selected)
              </NativeSelectOption>
            )}
            {data.items.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.title || "Untitled"}
                {s.is_default ? " (default)" : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {data.total > 25 && (
            <>
              <IconAction
                label="Previous sessions"
                icon={ChevronLeft}
                disabled={!page}
                onClick={() => setPage(page - 1)}
              />
              <IconAction
                label="More sessions"
                icon={ChevronRight}
                disabled={(page + 1) * 25 >= data.total}
                onClick={() => setPage(page + 1)}
              />
            </>
          )}
        </div>
      )}
    </QueryBoundary>
  )
}
function ChatPane({
  agentId,
  initialSession = "",
  playground = false,
  label = "Conversation",
  compare = false,
  onActiveChange,
}: {
  agentId: string
  initialSession?: string
  playground?: boolean
  label?: string
  compare?: boolean
  onActiveChange: (active: boolean) => void
}) {
  const [session, setSession] = useState(initialSession),
    [input, setInput] = useState(""),
    [active, setActive] = useState(false),
    [runId, setRunId] = useState(""),
    [overrides, setOverrides] = useState<Draft>({}),
    [invalid, setInvalid] = useState<Record<string, boolean>>({}),
    [preview, setPreview] = useState(false),
    [localError, setLocalError] = useState(""),
    start = useCommand<{ id: string }>("runs.start"),
    create = useCommand<Session>("sessions.create"),
    allowed = useAccess("run"),
    canManage = useAccess("manage")
  const ag = useQuery<Agent>("agents.detail", { id: agentId }),
    runtime = useQuery<Runtime>("runtime.detail"),
    history = useQuery<Memory>(
      "memory.detail",
      { id: session, limit: 100 },
      { enabled: !!session }
    ),
    prompt = useQuery<{ prompt: string }>(
      "prompt.preview",
      { id: agentId, session_id: session, overrides },
      { enabled: preview }
    ),
    detail = useQuery<RunDetail>(
      "runs.detail",
      { id: runId },
      { enabled: !!runId }
    )
  useEffect(() => {
    onActiveChange(active)
  }, [active, onActiveChange])
  usePoll(history.refetch, 1500)
  usePoll(detail.refetch, 1500)
  const overrideFields = schemas.agents.fields.filter((f) =>
    [
      "model",
      "temperature",
      "max_steps",
      "max_tokens",
      "system_prompt",
      "persona_ref",
      "inline_skills",
      "inline_traits",
      "tools",
    ].includes(f.key)
  )
  const panels = useSlotEntries("cortex.playground.panels", {
      agentId,
      sessionId: session,
      overrides,
    }),
    tabs = useSlotEntries("cortex.playground.tabs", {
      agentId,
      sessionId: session,
      overrides,
    })
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-medium">{label}</h2>
      <QueryBoundary title="Agent" query={ag} skeletonRows={1}>
        {(agent) => (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <PluginLink to={`/agents/${agent.id}`} className="underline">
              {agent.name}
            </PluginLink>
            <ScopeLine scope={agent.scope} />
            <State value={agent.enabled ? "enabled" : "disabled"} />
          </div>
        )}
      </QueryBoundary>
      <fieldset disabled={active} className="flex flex-col gap-2">
        <SessionSelector
          agentId={agentId}
          value={session}
          onChange={setSession}
        />
      </fieldset>
      {compare && !session && (
        <p className="text-xs text-muted-foreground">
          A separate session is created for this comparison pane before the
          first run.
        </p>
      )}
      {playground && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Run overrides
          </summary>
          <p className="my-2 text-xs text-muted-foreground">
            Overrides apply to this run. ReAct is the implemented loop. Stored
            behavior rules and cognitive phases do not change execution.
          </p>
          <fieldset
            disabled={active}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <FormFields
              fields={overrideFields}
              value={overrides}
              onChange={setOverrides}
              owner={{ kind: "agents", id: agentId }}
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
          <IconAction
            label={
              preview ? "Close prompt preview" : "Preview assembled prompt"
            }
            icon={preview ? X : Eye}
            className="mt-3"
            onClick={() => setPreview((v) => !v)}
          />
          {preview && (
            <div className="mt-3">
              <QueryBoundary
                title="Prompt preview"
                query={prompt}
                keepPreviousData
              >
                {(data) => (
                  <Code text={data.prompt} label="Assembled system prompt" />
                )}
              </QueryBoundary>
            </div>
          )}
          {panels.map((p) => (
            <div key={p.key} className="mt-3">
              {p.node}
            </div>
          ))}
          {tabs.map((t) => (
            <details key={t.key}>
              <summary>{t.label ?? t.id}</summary>
              {t.node}
            </details>
          ))}
        </details>
      )}
      {session && (
        <QueryBoundary title="Saved history" query={history} keepPreviousData>
          {(data) =>
            data.messages.length ? (
              <div
                className="grid max-h-96 gap-2 overflow-auto rounded-md border p-3"
                aria-label="Saved conversation"
              >
                {data.messages.map((m, i) => (
                  <div key={`${m.timestamp}-${i}`}>
                    <p className="text-xs font-medium text-muted-foreground">
                      {m.role}
                    </p>
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {m.content}
                    </p>
                  </div>
                ))}
                {!data.complete && (
                  <p className="text-xs text-muted-foreground">
                    Latest 100 messages. Open session memory for more.
                  </p>
                )}
              </div>
            ) : (
              <ZeroState
                title="No saved messages"
                body="Send a message to start this session."
              />
            )
          }
        </QueryBoundary>
      )}
      {runId && (
        <LiveRun
          key={runId}
          id={runId}
          state={detail.data?.run.state}
          onDone={() => {
            setActive(false)
            void detail.refetch()
            void history.refetch()
          }}
        />
      )}
      <PluginSlot
        name="cortex.chat.toolbar"
        params={{ agentId, sessionId: session }}
      />
      <form
        className="grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setLocalError("")
          if (active) return
          let sid = session
          if (compare && !sid) {
            if (!canManage) {
              setLocalError(
                "Choose a saved session for comparison, or request session management access."
              )
              return
            }
            const saved = await create.execute({
              agent_id: agentId,
              title: `${label} ${new Date().toISOString()}`,
            })
            if (!saved) return
            sid = saved.id
            setSession(sid)
          }
          setActive(true)
          const saved = await start.execute({
            id: agentId,
            input,
            session_id: sid,
            overrides,
          })
          if (saved) {
            setRunId(saved.id)
            setInput("")
          } else setActive(false)
        }}
      >
        <CommandAlert
          error={runtime.error}
          title="Execution provider check failed"
        />
        {runtime.error && (
          <Button
            size="xs"
            variant="outline"
            type="button"
            onClick={() => void runtime.refetch()}
          >
            Retry execution provider check
          </Button>
        )}
        <Code text={input} label={`${label} input`} onChange={setInput} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {runtime.data?.execution_label ?? "Checking execution provider…"}
          </span>
          <Button
            type="submit"
            size="sm"
            disabled={
              active ||
              start.loading ||
              !input.trim() ||
              !allowed ||
              !runtime.data?.llm ||
              !ag.data?.enabled ||
              Object.keys(invalid).length > 0
            }
          >
            {active ? "Running…" : "Send"}
          </Button>
        </div>
        <CommandAlert
          error={start.error ?? create.error}
          title="Execution failed"
        />
        {localError && (
          <p role="alert" className="text-sm text-destructive">
            {localError}
          </p>
        )}
      </form>
      {detail.data?.run.session_id && !session && (
        <Button
          size="xs"
          variant="outline"
          className="w-fit"
          onClick={() => setSession(detail.data!.run.session_id!)}
        >
          Show saved session
        </Button>
      )}
      {runId && (
        <PluginLink to={`/runs/${runId}`} className="text-sm underline">
          Open saved run review
        </PluginLink>
      )}
    </section>
  )
}
export function ChatPage({
  agentId,
  sessionId,
  playground = false,
}: {
  agentId?: string
  sessionId?: string
  playground?: boolean
}) {
  const [agent, setAgent] = useState(agentId ?? ""),
    [compare, setCompare] = useState(false),
    [leftActive, setLeftActive] = useState(false),
    [rightActive, setRightActive] = useState(false)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title={playground ? "Playground" : "Chat"}
        description={
          playground
            ? "Inspect prompt assembly and compare separate sessions with per-run overrides."
            : "Run a saved agent with persistent conversation history."
        }
        actions={
          playground ? (
            <IconAction
              label={compare ? "Close comparison" : "Compare sessions"}
              icon={compare ? X : Columns2}
              disabled={leftActive || rightActive}
              onClick={() => setCompare((v) => !v)}
            />
          ) : (
            <PluginLink
              to={agent ? `/playground/${agent}` : "/playground"}
              className="text-sm underline"
            >
              Open playground
            </PluginLink>
          )
        }
      />
      <fieldset disabled={leftActive || rightActive} className="max-w-lg">
        <AgentPicker selected={agent} onChange={setAgent} />
      </fieldset>
      {agent ? (
        <div
          className={compare ? "grid min-w-0 gap-4 lg:grid-cols-2" : "min-w-0"}
        >
          <ChatPane
            onActiveChange={setLeftActive}
            key={`left-${agent}-${compare}`}
            agentId={agent}
            initialSession={sessionId}
            playground={playground}
            compare={compare}
            label={compare ? "Comparison A" : "Conversation"}
          />
          {compare && (
            <ChatPane
              onActiveChange={setRightActive}
              key={`right-${agent}`}
              agentId={agent}
              playground
              compare
              label="Comparison B"
            />
          )}
        </div>
      ) : (
        <ZeroState
          title="Select an agent"
          body="Choose a saved configuration to start a conversation or inspect run overrides."
          action={
            <PluginLink to="/agents">Review agent configurations</PluginLink>
          }
        />
      )}
    </section>
  )
}
