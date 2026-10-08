import {
  MessageSquare,
  Columns2,
  MessagesSquare,
  ListOrdered,
  Wrench,
  Layers,
} from "@forge-go/dashboard-kit/icons"
import { Copy, Eye, Pencil, Plus, Trash2 } from "@forge-go/dashboard-kit/icons"
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
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import {
  IconAction,
  IconLink,
  AuditDates,
  Back,
  Code,
  Reload,
  ScopeLine,
  State,
  useAccess,
  Value,
} from "../components"
import { changedFields, FormFields, type Draft } from "../form"
import { initialFields, schemas, type Field } from "../schema"
import type { Agent, ConfigRecord, Entity, Page, Resource, Run } from "../types"
const title = (s: string) => s[0].toUpperCase() + s.slice(1)
function summary(resource: Resource, row: ConfigRecord) {
  switch (resource) {
    case "agents":
      return "model" in row ? row.model || "Runtime default" : "Runtime default"
    case "personas":
      return "identity" in row
        ? `${row.skills?.length ?? 0} skills · ${row.traits?.length ?? 0} traits`
        : ""
    case "skills":
      return "default_proficiency" in row
        ? row.default_proficiency || "Default proficiency"
        : "Default proficiency"
    case "traits":
      return "category" in row
        ? row.category || "Uncategorized"
        : "Uncategorized"
    case "behaviors":
      return "priority" in row
        ? `Priority ${row.priority ?? 0} · ${row.triggers?.length ?? 0} triggers`
        : "Priority 0"
    case "orchestrations":
      return "strategy" in row
        ? `${row.strategy} · ${row.participants.length} participants`
        : ""
  }
}
export function ConfigList({ resource }: { resource: Resource }) {
  const spec = schemas[resource],
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [exact, setExact] = useState(false),
    [selected, setSelected] = useState<ConfigRecord | null>(null),
    allowed = useAccess("manage")
  const q = useQuery<Page<ConfigRecord>>(`${resource}.list`, {
    search,
    limit: 25,
    offset: (page - 1) * 25,
    exact,
  })
  usePoll(q.refetch)
  const del = useCommand(`${resource}.delete`)
  const columns: Column<ConfigRecord>[] = [
    {
      id: "name",
      header: "Name",
      cell: (r) => (
        <PluginLink
          to={`/${resource}/${r.id}`}
          className="font-medium underline underline-offset-4"
        >
          {r.name}
        </PluginLink>
      ),
    },
    {
      id: "summary",
      header: resource === "agents" ? "Model" : "Composition",
      cell: (r) => summary(resource, r),
    },
    {
      id: "description",
      header: "Description",
      className: "max-w-72",
      cell: (r) => <Value value={r.description} label="description" />,
    },
    {
      id: "scope",
      header: "Scope",
      cell: (r) => <ScopeLine scope={r.scope} />,
    },
    {
      id: "updated",
      header: "Updated",
      cell: (r) => <Timestamp value={r.updated_at} label="updated" />,
    },
  ]
  if (resource === "agents")
    columns.splice(
      2,
      0,
      {
        id: "enabled",
        header: "State",
        cell: (r) => (
          <State value={(r as Agent).enabled ? "enabled" : "disabled"} />
        ),
      },
      {
        id: "persona",
        header: "Persona",
        cell: (r) => <Value value={(r as Agent).persona_ref} label="persona" />,
      }
    )
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title={title(resource)}
        description={spec.description}
        actions={
          <>
            <Reload onClick={q.refetch} />
            {allowed && (
              <IconLink
                to={`/${resource}/new`}
                label={`New ${spec.singular.toLowerCase()}`}
                icon={Plus}
              />
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1">
          <FilterBar
            search={{
              value: search,
              onChange: (v) => {
                setSearch(v)
                setPage(1)
              },
              label: `Search ${resource}`,
              placeholder: `Search ${resource}`,
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={exact}
            onChange={(e) => {
              setExact(e.target.checked)
              setPage(1)
            }}
          />
          Exact scope
        </label>
      </div>
      <QueryBoundary title={title(resource)} query={q} keepPreviousData>
        {(data) => (
          <ResourceTable
            columns={columns}
            rows={data.items}
            rowKey={(r) => r.id}
            caption={`${data.total} ${resource}`}
            emptyMessage={
              search ? `No ${resource} match your search` : `No ${resource} yet`
            }
            emptyAction={
              search ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("")
                    setPage(1)
                  }}
                >
                  Clear search
                </Button>
              ) : allowed ? (
                <PluginLink to={`/${resource}/new`}>
                  Create {spec.singular.toLowerCase()}
                </PluginLink>
              ) : undefined
            }
            rowActions={(r) => (
              <>
                <IconLink to={`/${resource}/${r.id}`} label="View" icon={Eye} />
                {allowed && (
                  <>
                    <IconLink
                      to={`/${resource}/${r.id}/edit`}
                      label="Edit"
                      icon={Pencil}
                    />
                    <IconAction
                      label="Delete"
                      icon={Trash2}
                      onClick={() => {
                        del.reset()
                        setSelected(r)
                      }}
                    />
                  </>
                )}
              </>
            )}
            pagination={{ page, pageSize: 25, total: data.total }}
            onPageChange={setPage}
          />
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={selected !== null}
        onOpenChange={(v) => {
          if (!v) setSelected(null)
        }}
        title={`Delete ${selected?.name ?? spec.singular}?`}
        description="This removes the saved configuration. Referenced configurations cannot be deleted."
        confirmLabel="Delete"
        pending={del.loading}
        onConfirm={async () => {
          if (
            selected &&
            (await del.execute({ id: selected.id })) !== undefined
          )
            setSelected(null)
        }}
      >
        <CommandAlert error={del.error} title="Delete failed" />
      </ConfirmDialog>
    </section>
  )
}
function ReferenceLink({
  field,
  name,
  owner,
}: {
  field: Field
  name: string
  owner: { kind: Resource; id: string }
}) {
  const q = useQuery<Page<Entity>>("references.list", {
    kind: field.ref,
    owner_kind: owner.kind,
    owner_id: owner.id,
    search: name,
    limit: 100,
    offset: 0,
  })
  const row = q.data?.items.find((r) => r.name === name)
  return row ? (
    <PluginLink
      className="underline underline-offset-4"
      to={`/${field.ref}/${row.id}`}
    >
      {name}
    </PluginLink>
  ) : (
    <span>
      {name}
      {q.error && (
        <span className="ml-1 text-xs text-muted-foreground">
          (reference unavailable)
        </span>
      )}
    </span>
  )
}
function FieldView({
  field,
  value,
  owner,
}: {
  field: Field
  value: unknown
  owner: { kind: Resource; id: string }
}) {
  if (field.ref && typeof value === "string" && value)
    return <ReferenceLink field={field} name={value} owner={owner} />
  if (field.kind === "prompt")
    return value ? (
      <Code text={String(value)} label={field.label} />
    ) : (
      <Value value={value} label={field.label} />
    )
  if (field.kind === "json" && value && Object.keys(value).length)
    return (
      <Code text={JSON.stringify(value, null, 2)} label={field.label} json />
    )
  if (field.kind === "array" && Array.isArray(value) && value.length)
    return (
      <div className="grid gap-2">
        {value.map((v, i) => (
          <div key={i} className="rounded-md border p-3">
            <FieldView field={field.item!} value={v} owner={owner} />
          </div>
        ))}
      </div>
    )
  if (field.kind === "object" && value && typeof value === "object")
    return (
      <dl className="grid min-w-0 gap-2">
        {field.fields?.map((f) => (
          <div
            key={f.key}
            className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
          >
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="min-w-0 text-sm">
              <FieldView
                field={f}
                value={(value as Draft)[f.key]}
                owner={owner}
              />
            </dd>
          </div>
        ))}
      </dl>
    )
  return <Value value={value} label={field.label} />
}
function Clone({ resource, row }: { resource: Resource; row: ConfigRecord }) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    cmd = useCommand<ConfigRecord>(`${resource}.clone`),
    navigate = useNavigateTo()
  return (
    <>
      <IconAction
        label="Clone"
        icon={Copy}
        onClick={() => {
          cmd.reset()
          setName(`${row.name}-copy`)
          setOpen(true)
        }}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Clone ${row.name}`}
        description="Create an independent copy with a new stable name."
        confirmLabel="Clone"
        destructive={false}
        pending={cmd.loading}
        confirmDisabled={!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)}
        onConfirm={async () => {
          const saved = await cmd.execute({ id: row.id, name })
          if (saved) {
            setOpen(false)
            navigate(`/${resource}/${saved.id}`)
          }
        }}
      >
        <Input
          aria-label="Clone name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <CommandAlert error={cmd.error} title="Clone failed" />
      </ConfirmDialog>
    </>
  )
}
function DeleteConfiguration({
  resource,
  row,
}: {
  resource: Resource
  row: ConfigRecord
}) {
  const [open, setOpen] = useState(false),
    command = useCommand(`${resource}.delete`),
    navigate = useNavigateTo()
  return (
    <>
      <IconAction
        label="Delete"
        icon={Trash2}
        onClick={() => {
          command.reset()
          setOpen(true)
        }}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${row.name}?`}
        description="This removes the saved configuration. Referenced configurations cannot be deleted."
        confirmLabel="Delete"
        pending={command.loading}
        onConfirm={async () => {
          if ((await command.execute({ id: row.id })) !== undefined) {
            setOpen(false)
            navigate(`/${resource}`, { replace: true })
          }
        }}
      >
        <CommandAlert error={command.error} title="Delete failed" />
      </ConfirmDialog>
    </>
  )
}
function AgentActivity({ agent }: { agent: Agent }) {
  const q = useQuery<Page<Run>>("runs.list", {
    agent_id: agent.id,
    limit: 5,
    offset: 0,
  })
  usePoll(q.refetch)
  const stats = useQuery<{
    total: number
    completed: number
    success_rate: number | null
    last_run?: Run
  }>("agents.stats", { id: agent.id })
  usePoll(stats.refetch)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Execution</h2>
        <div className="flex flex-wrap gap-1">
          <IconLink
            to={`/chat/${agent.id}`}
            label="Chat"
            icon={MessageSquare}
          />
          <IconLink
            to={`/playground/${agent.id}`}
            label="Playground"
            icon={Columns2}
          />
          <IconLink
            to={`/sessions/agent/${agent.id}`}
            label="Sessions"
            icon={MessagesSquare}
          />
          <IconLink
            to={`/runs/agent/${agent.id}`}
            label="All runs"
            icon={ListOrdered}
          />
          <IconLink
            to={`/tools/${agent.id}`}
            label="Authorized tools"
            icon={Wrench}
          />
          <IconLink
            to={`/overlays/${agent.id}`}
            label="Prompt overlays"
            icon={Layers}
          />
        </div>
      </div>
      <QueryBoundary
        title="Agent statistics"
        query={stats}
        skeletonRows={1}
        keepPreviousData
      >
        {(data) => (
          <p className="text-sm text-muted-foreground">
            {data.total} runs · {data.completed} completed ·{" "}
            {data.success_rate === null
              ? "No success rate yet"
              : `${(data.success_rate * 100).toFixed(1)}% success`}
            {data.last_run && (
              <>
                {" "}
                · Last run{" "}
                <Timestamp value={data.last_run.created_at} label="last run" />
              </>
            )}
          </p>
        )}
      </QueryBoundary>
      <QueryBoundary title="Recent runs" query={q} keepPreviousData>
        {(data) =>
          data.items.length ? (
            <ResourceTable
              rows={data.items}
              rowKey={(r) => r.id}
              emptyMessage="No runs"
              caption={`${data.total} runs, showing the latest ${data.items.length}`}
              columns={[
                {
                  id: "id",
                  header: "Run",
                  cell: (r) => (
                    <PluginLink
                      to={`/runs/${r.id}`}
                      className="font-mono text-xs underline"
                    >
                      {r.id}
                    </PluginLink>
                  ),
                },
                {
                  id: "state",
                  header: "State",
                  cell: (r) => <State value={r.state} />,
                },
                { id: "steps", header: "Steps", cell: (r) => r.step_count },
                {
                  id: "created",
                  header: "Created",
                  cell: (r) => (
                    <Timestamp value={r.created_at} label="created" />
                  ),
                },
              ]}
            />
          ) : (
            <ZeroState
              title="No runs yet"
              body="Start a conversation to inspect a real run."
              action={
                <PluginLink to={`/chat/${agent.id}`}>Open chat</PluginLink>
              }
            />
          )
        }
      </QueryBoundary>
    </div>
  )
}
export function ConfigDetail({
  resource,
  id,
}: {
  resource: Resource
  id: string
}) {
  const q = useQuery<ConfigRecord>(`${resource}.detail`, { id }),
    allowed = useAccess("manage"),
    spec = schemas[resource]
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Back to={`/${resource}`} label={resource} />
      <QueryBoundary title={spec.singular} query={q}>
        {(row) => (
          <>
            <PageHeader
              title={row.name}
              description={row.description}
              actions={
                <>
                  {allowed && (
                    <>
                      {["agents", "personas"].includes(resource) && (
                        <Clone resource={resource} row={row} />
                      )}
                      <IconLink
                        to={`/${resource}/${id}/edit`}
                        label={`Edit ${spec.singular.toLowerCase()}`}
                        icon={Pencil}
                      />
                      <DeleteConfiguration resource={resource} row={row} />
                    </>
                  )}
                </>
              }
            />
            <div className="flex flex-wrap items-center gap-3">
              <code className="text-xs break-all">{row.id}</code>
              <ScopeLine scope={row.scope} />
            </div>
            <AuditDates created={row.created_at} updated={row.updated_at} />
            {resource === "orchestrations" && (
              <PluginLink
                to={`/orchestrations/${id}/execute`}
                className={buttonVariants({ size: "sm" })}
              >
                Execute orchestration
              </PluginLink>
            )}
            {resource === "agents" && <AgentActivity agent={row as Agent} />}
            <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 lg:grid-cols-2">
              {spec.fields
                .filter((f) => !["name", "description"].includes(f.key))
                .map((f) => {
                  const value = (row as unknown as Draft)[f.key]
                  const structured = [
                    "array",
                    "object",
                    "json",
                    "prompt",
                  ].includes(f.kind ?? "")
                  return structured ? (
                    <div
                      key={f.key}
                      className="col-span-full min-w-0 border-b py-2"
                    >
                      <details>
                        <summary className="cursor-pointer text-xs font-medium">
                          {f.label}{" "}
                          <span className="ml-1 font-normal text-muted-foreground">
                            {Array.isArray(value)
                              ? `${value.length} entries`
                              : value &&
                                  (typeof value !== "object" ||
                                    Object.keys(value).length > 0)
                                ? "Configured"
                                : "Empty"}
                          </span>
                        </summary>
                        <div className="mt-2 min-w-0 text-sm">
                          <FieldView
                            field={f}
                            value={value}
                            owner={{ kind: resource, id }}
                          />
                        </div>
                      </details>
                    </div>
                  ) : (
                    <dl
                      key={f.key}
                      className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] items-start gap-2 border-b py-1.5"
                    >
                      <dt className="text-xs text-muted-foreground">
                        {f.label}
                      </dt>
                      <dd className="min-w-0 text-sm">
                        <FieldView
                          field={f}
                          value={value}
                          owner={{ kind: resource, id }}
                        />
                      </dd>
                    </dl>
                  )
                })}
            </div>
            {resource === "agents" && (
              <PluginSlot
                name="cortex.agent.detail.sections"
                params={{ agentId: id, agent: row }}
              />
            )}
            {resource === "personas" && (
              <PluginSlot
                name="cortex.persona.detail.sections"
                params={{ personaId: id, persona: row }}
              />
            )}
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
function ConfigForm({
  resource,
  initial,
}: {
  resource: Resource
  initial?: ConfigRecord
}) {
  const spec = schemas[resource],
    initialDraft: Draft = initial ? { ...initial } : initialFields(spec.fields),
    [draft, setDraft] = useState(initialDraft),
    [invalid, setInvalid] = useState<Record<string, boolean>>({}),
    [localError, setLocalError] = useState(""),
    cmd = useCommand<ConfigRecord>(
      `${resource}.${initial ? "update" : "create"}`
    ),
    navigate = useNavigateTo(),
    allowed = useAccess("manage")
  const fields = spec.fields.filter((f) => !initial || f.key !== "name"),
    patch = changedFields(initialDraft, draft, fields)
  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setLocalError("")
        if (Object.keys(invalid).length) {
          setLocalError("Fix the highlighted JSON fields before saving.")
          return
        }
        const blank = fields.filter(
          (f) =>
            f.kind === "number" &&
            Object.hasOwn(draft, f.key) &&
            draft[f.key] === ""
        )
        if (blank.length) {
          setLocalError(
            `Enter a number for ${blank.map((f) => f.label).join(", ")}.`
          )
          return
        }
        const saved = await cmd.execute(
          initial ? { id: initial.id, patch } : { data: draft }
        )
        if (saved) navigate(`/${resource}/${saved.id}`)
      }}
    >
      <PageHeader
        title={
          initial
            ? `Edit ${initial.name}`
            : `New ${spec.singular.toLowerCase()}`
        }
        description={spec.description}
        actions={
          <Button
            type="submit"
            size="sm"
            disabled={
              cmd.loading ||
              !allowed ||
              Object.keys(invalid).length > 0 ||
              (!!initial && Object.keys(patch).length === 0)
            }
          >
            {cmd.loading ? "Saving…" : "Save configuration"}
          </Button>
        }
      />
      {initial && (
        <p className="text-xs text-muted-foreground">
          Name: {initial.name} · <ScopeLine scope={initial.scope} />
        </p>
      )}
      {resource !== "skills" && resource !== "orchestrations" && (
        <p className="text-xs text-muted-foreground">
          Persona assignments, cognitive styles, communication, perception and
          behavior rules are saved configuration. ReAct currently applies
          persona identity, inline skill fragments and inline trait prompt
          injections.
        </p>
      )}
      <CommandAlert error={cmd.error} title="Save failed" />
      {localError && (
        <p role="alert" className="text-sm text-destructive">
          {localError}
        </p>
      )}
      <fieldset
        disabled={cmd.loading || !allowed}
        className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <FormFields
          fields={fields}
          value={draft}
          onChange={setDraft}
          onValidity={(path, valid) =>
            setInvalid((prev) => {
              const next = { ...prev }
              if (valid) {
                for (const key of Object.keys(next)) {
                  if (key === path || key.startsWith(path + "."))
                    delete next[key]
                }
              } else next[path] = true
              return next
            })
          }
          owner={initial ? { kind: resource, id: initial.id } : undefined}
        />
      </fieldset>
      <div className="flex gap-3">
        <Button
          type="submit"
          size="sm"
          disabled={
            cmd.loading ||
            !allowed ||
            Object.keys(invalid).length > 0 ||
            (!!initial && Object.keys(patch).length === 0)
          }
        >
          {cmd.loading ? "Saving…" : "Save configuration"}
        </Button>
        <PluginLink
          to={initial ? `/${resource}/${initial.id}` : `/${resource}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Cancel
        </PluginLink>
      </div>
    </form>
  )
}
export function ConfigEdit({
  resource,
  id,
}: {
  resource: Resource
  id?: string
}) {
  const q = useQuery<ConfigRecord>(
    `${resource}.detail`,
    { id },
    { enabled: !!id }
  )
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Back to={id ? `/${resource}/${id}` : `/${resource}`} label={resource} />
      {id ? (
        <QueryBoundary title={schemas[resource].singular} query={q}>
          {(data) => (
            <ConfigForm key={data.id} resource={resource} initial={data} />
          )}
        </QueryBoundary>
      ) : (
        <ConfigForm resource={resource} />
      )}
    </section>
  )
}
