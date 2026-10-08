import { useRef, useState } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  usePoll,
  useQuery,
  type PluginPageProps,
} from "@forge-go/dashboard-plugin"
import {
  Button,
  buttonVariants,
} from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
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
import {
  CoverageNotice,
  Empty,
  NewLink,
  Pager,
  RefreshStatus,
  Status,
  Value,
} from "../components/common"
import {
  collections,
  label,
  path,
  type Capabilities,
  type Collection,
  type Overview,
  type Page,
  type Row,
} from "../types"
const fields: Record<Collection, string[]> = {
  instincts: ["category", "sensitivity", "action", "strategies"],
  awareness: ["focus", "action", "detectors"],
  boundaries: ["limits", "response"],
  values: ["severity", "action", "rules"],
  judgments: ["domain", "threshold", "action", "assessors"],
  reflexes: ["priority", "triggers", "actions"],
  profiles: [
    "instincts",
    "awareness",
    "boundaries",
    "values",
    "judgments",
    "reflexes",
  ],
  policies: ["scope_level", "scope_key", "rules"],
  scans: [
    "direction",
    "decision",
    "findings",
    "pii_count",
    "duration_ms",
    "profile_used",
  ],
  compliance: [
    "framework",
    "scope_level",
    "period_start",
    "period_end",
    "generated_at",
  ],
}
export function columns(collection: Collection): Column<Row>[] {
  return [
    {
      id: "identity",
      header:
        collection === "scans"
          ? "Stored scan"
          : collection === "compliance"
            ? "Framework"
            : "Name",
      cell: (r) => (
        <PluginLink to={path(collection, r.id)} className="font-medium">
          {String(r.name ?? r.framework ?? r.id)}
        </PluginLink>
      ),
    },
    ...fields[collection]
      .filter((f) => f !== "framework")
      .map((field) => ({
        id: field,
        header: label(field),
        cell: (r: Row) =>
          Array.isArray(r[field]) ? (
            <span className="font-mono text-xs">
              {(r[field] as unknown[]).length}
            </span>
          ) : (
            <Value value={r[field]} field={field} />
          ),
      })),
    ...(collections.includes(collection as (typeof collections)[number])
      ? [
          {
            id: "enabled",
            header: "Status",
            cell: (r: Row) => <Status enabled={r.enabled} />,
          },
        ]
      : []),
    {
      id: "updated_at",
      header: collection === "scans" ? "Recorded" : "Updated",
      cell: (r) => (
        <Timestamp
          label="record time"
          value={collection === "scans" ? r.created_at : r.updated_at}
        />
      ),
    },
  ]
}
export function CollectionPage({
  collection,
}: PluginPageProps & { collection: Collection }) {
  const caps = useQuery<Capabilities>("capabilities")
  const [offset, setOffset] = useState(0)
  const [enabled, setEnabled] = useState("")
  const [search, setSearch] = useState("")
  const [value, setValue] = useState("")
  const [direction, setDirection] = useState("")
  const primary = {
    instincts: "category",
    awareness: "focus",
    judgments: "domain",
    scans: "decision",
    compliance: "framework",
  }[collection as string]
  const query = useQuery<Page>(`${collection}.list`, {
    limit: 25,
    offset,
    ...(search ? { search } : {}),
    ...(enabled ? { enabled: enabled === "true" } : {}),
    ...(value ? { field: primary, value } : {}),
    ...(direction ? { direction } : {}),
  })
  usePoll(query.refetch)
  const editable = collections.includes(
    collection as (typeof collections)[number]
  )
  const options =
    collection === "scans"
      ? ["allow", "block", "flag", "redact"]
      : collection === "compliance"
        ? ["eu_ai_act", "nist_ai_rmf", "soc2"]
        : (caps.data?.schemas[collection]?.find((f) => f.key === primary)
            ?.options ?? [])
  const reset = (fn: (v: string) => void) => (v: string) => {
    setOffset(0)
    fn(v)
  }
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title={label(collection)}
        description={
          collection === "scans"
            ? "Stored decisions and findings. Example records carry source labels."
            : collection === "compliance"
              ? "Stored reports. Report generation is unavailable."
              : "Manage configuration in the authorized tenant and app."
        }
        actions={
          editable && caps.data?.can_manage ? (
            <NewLink collection={collection} />
          ) : undefined
        }
      />
      <CoverageNotice />
      <FilterBar
        search={
          editable
            ? {
                value: search,
                onChange: reset(setSearch),
                label: `Search ${collection}`,
              }
            : undefined
        }
        filters={[
          ...(editable
            ? [
                {
                  id: "enabled",
                  label: "Status",
                  value: enabled,
                  onChange: reset(setEnabled),
                  options: [
                    { value: "", label: "All" },
                    { value: "true", label: "Enabled" },
                    { value: "false", label: "Disabled" },
                  ],
                },
              ]
            : []),
          ...(primary
            ? [
                {
                  id: primary,
                  label: label(primary),
                  value,
                  onChange: reset(setValue),
                  options: [
                    { value: "", label: "All" },
                    ...options.map((v) => ({ value: v, label: label(v) })),
                  ],
                },
              ]
            : []),
          ...(collection === "scans"
            ? [
                {
                  id: "direction",
                  label: "Direction",
                  value: direction,
                  onChange: reset(setDirection),
                  options: [
                    { value: "", label: "All" },
                    { value: "input", label: "Input" },
                    { value: "output", label: "Output" },
                  ],
                },
              ]
            : []),
        ]}
      />
      <QueryBoundary title={label(collection)} query={query} keepPreviousData>
        {(page) => (
          <>
            {page.items.length === 0 ? (
              <Empty
                title={`No ${collection}`}
                body={
                  search || enabled || value || direction
                    ? "No records match these filters. Adjust the filters to continue."
                    : "This scope has no stored records yet."
                }
                action={
                  editable && caps.data?.can_manage ? (
                    <NewLink collection={collection} />
                  ) : undefined
                }
              />
            ) : (
              <ResourceTable
                emptyMessage="No records in this scope."
                rows={page.items}
                columns={columns(collection)}
                rowKey={(r) => r.id}
                caption={`${page.total} ${collection}`}
              />
            )}
            <Pager page={page} onChange={setOffset} />
          </>
        )}
      </QueryBoundary>
      <RefreshStatus query={query} />
    </section>
  )
}
export function OverviewPage() {
  const caps = useQuery<Capabilities>("capabilities")
  const overview = useQuery<Overview>("overview")
  const scans = useQuery<Page>("scans.list", { limit: 5, offset: 0 })
  usePoll(overview.refetch)
  usePoll(scans.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Shield"
        description="Safety configuration and stored record review."
        actions={
          <PluginLink
            to="/profiles"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            Manage profiles
          </PluginLink>
        }
      />
      <CoverageNotice />
      <QueryBoundary title="Shield scope" query={caps}>
        {(c) => (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span>
              Tenant <code>{c.scope.tenant_id}</code>
            </span>
            <span>
              App <code>{c.scope.app_id}</code>
            </span>
            <span>{c.can_manage ? "Manage access" : "Read access"}</span>
          </div>
        )}
      </QueryBoundary>
      <QueryBoundary
        title="Configuration summary"
        query={overview}
        keepPreviousData
      >
        {(o) => (
          <div className="flex flex-wrap gap-2">
            {o.sections.map((s) => (
              <PluginLink
                key={s.collection}
                to={path(s.collection)}
                className="flex items-center gap-3 rounded-md border px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground">
                  {label(s.collection)}
                </span>
                <span className="font-mono font-medium">
                  {s.available ? s.total : "Unavailable"}
                </span>
              </PluginLink>
            ))}
          </div>
        )}
      </QueryBoundary>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Recent stored scans</h2>
        <PluginLink to="/scans" className="text-xs underline">
          All scans
        </PluginLink>
      </div>
      <QueryBoundary title="Stored scans" query={scans} keepPreviousData>
        {(p) =>
          p.items.length ? (
            <ResourceTable
              emptyMessage="No records in this scope."
              rows={p.items}
              columns={columns("scans")}
              rowKey={(r) => r.id}
            />
          ) : (
            <Empty
              title="No stored scans"
              body="No historical scans have been stored in this scope. Live evaluation is unavailable."
            />
          )
        }
      </QueryBoundary>
      <RefreshStatus query={scans} />
    </section>
  )
}
function DetailActions({
  collection,
  row,
  caps,
}: {
  collection: Collection
  row: Row
  caps: Capabilities
}) {
  const [open, setOpen] = useState(false)
  const busy = useRef(false)
  const remove = useCommand(`${collection}.delete`)
  const toggle = useCommand(`${collection}.setEnabled`)
  const navigate = useNavigateTo()
  async function confirm() {
    if (busy.current) return
    busy.current = true
    try {
      const result = await remove.execute({ id: row.id })
      if (result !== undefined) {
        setOpen(false)
        navigate(path(collection), { replace: true })
      }
    } finally {
      busy.current = false
    }
  }
  return caps.can_manage ? (
    <>
      <PluginLink
        to={`${path(collection, row.id)}/edit`}
        className={buttonVariants({ size: "sm", variant: "outline" })}
      >
        Edit
      </PluginLink>
      <Button
        size="sm"
        variant="outline"
        disabled={toggle.loading}
        onClick={() =>
          void toggle.execute({ id: row.id, enabled: !row.enabled })
        }
      >
        {row.enabled ? "Disable" : "Enable"}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          remove.reset()
          setOpen(true)
        }}
      >
        Delete
      </Button>
      <CommandAlert error={toggle.error} title="Could not change status" />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${row.name}?`}
        description="This removes the saved configuration. Referencing profiles must be updated first."
        pending={remove.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert
          error={remove.error}
          title="Could not delete configuration"
        />
      </ConfirmDialog>
    </>
  ) : null
}
function Assignments({ id, caps }: { id: string; caps: Capabilities }) {
  const q = useQuery<{ tenant_id: string; assigned: boolean }>(
    "policies.assignments",
    { id }
  )
  const assign = useCommand("policies.assign")
  const unassign = useCommand("policies.unassign")
  return (
    <section className="rounded-md border p-3">
      <h2 className="mb-2 text-sm font-medium">Tenant assignment</h2>
      <QueryBoundary query={q} title="Policy assignment">
        {(a) => (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              <code>{a.tenant_id}</code>:{" "}
              {a.assigned ? "Assigned" : "Not assigned"}
            </span>
            {caps.can_manage && (
              <Button
                size="sm"
                variant="outline"
                disabled={assign.loading || unassign.loading}
                onClick={() =>
                  void (a.assigned ? unassign : assign).execute({ id })
                }
              >
                {a.assigned ? "Unassign" : "Assign to this tenant"}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              Assignment is stored; enforcement is unavailable.
            </span>
          </div>
        )}
      </QueryBoundary>
      <CommandAlert
        error={assign.error ?? unassign.error}
        title="Could not update assignment"
      />
    </section>
  )
}
function ReferenceUsage({
  collection,
  row,
}: {
  collection: Collection
  row: Row
}) {
  const q = useQuery<string[]>("profiles.references", {
    collection,
    name: row.name,
  })
  return (
    <section className="rounded-md border p-3">
      <h2 className="mb-2 text-sm font-medium">Referenced by profiles</h2>
      <QueryBoundary title="Profile references" query={q}>
        {(refs) =>
          refs.length ? (
            <div className="flex flex-wrap gap-2">
              {refs.map((id) => (
                <PluginLink
                  key={id}
                  to={path("profiles", id)}
                  className="font-mono text-xs underline"
                >
                  {id}
                </PluginLink>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              No profile references.
            </span>
          )
        }
      </QueryBoundary>
    </section>
  )
}
export function DetailPage({
  collection,
  params,
}: PluginPageProps & { collection: Collection }) {
  const id = params.id ?? ""
  const caps = useQuery<Capabilities>("capabilities")
  const q = useQuery<Row>(`${collection}.detail`, { id })
  usePoll(q.refetch)
  const tokens = useQuery<Page>(
    "pii.byScan",
    { id, limit: 25, offset: 0 },
    { enabled: collection === "scans" }
  )
  const editable = collections.includes(
    collection as (typeof collections)[number]
  )
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title={
          q.data?.name ??
          (collection === "scans"
            ? "Stored scan"
            : collection === "compliance"
              ? "Stored report"
              : label(collection))
        }
        actions={
          <>
            <PluginLink
              to={path(collection)}
              className={buttonVariants({ size: "sm", variant: "ghost" })}
            >
              Back to {collection}
            </PluginLink>
            {editable && q.data && caps.data && (
              <DetailActions
                collection={collection}
                row={q.data}
                caps={caps.data}
              />
            )}
          </>
        }
      />
      <CoverageNotice />
      <QueryBoundary title="Resource" query={q} keepPreviousData>
        {(row) => (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <code className="break-all">{row.id}</code>
              {editable && <Status enabled={row.enabled} />}
              <Timestamp value={row.created_at} label="created" />
            </div>
            <dl className="grid min-w-0 gap-3 rounded-md border p-3">
              {Object.entries(row)
                .filter(
                  ([k]) =>
                    ![
                      "id",
                      "name",
                      "enabled",
                      "created_at",
                      "updated_at",
                    ].includes(k)
                )
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="grid min-w-0 gap-2 border-b pb-3 last:border-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)]"
                  >
                    <dt className="text-xs font-medium text-muted-foreground">
                      {label(key)}
                    </dt>
                    <dd className="min-w-0">
                      <Value value={value} field={key} />
                    </dd>
                  </div>
                ))}
            </dl>
            {editable &&
              collection !== "profiles" &&
              collection !== "policies" && (
                <ReferenceUsage collection={collection} row={row} />
              )}
          </>
        )}
      </QueryBoundary>
      {collection === "policies" && caps.data && (
        <Assignments id={id} caps={caps.data} />
      )}{" "}
      {collection === "scans" && (
        <QueryBoundary title="PII metadata" query={tokens}>
          {(page) => (
            <section>
              <h2 className="mb-2 text-sm font-medium">PII metadata</h2>
              {page.items.length ? (
                <ResourceTable
                  emptyMessage="No records in this scope."
                  rows={page.items}
                  columns={[
                    {
                      id: "type",
                      header: "Type",
                      cell: (r) => String(r.pii_type),
                    },
                    {
                      id: "placeholder",
                      header: "Placeholder",
                      cell: (r) => String(r.placeholder),
                    },
                    {
                      id: "expiry",
                      header: "Expires",
                      cell: (r) => (
                        <Value value={r.expires_at} field="expires_at" />
                      ),
                    },
                  ]}
                  rowKey={(r) => r.id}
                />
              ) : (
                <Empty
                  title="No PII metadata"
                  body="No tokens are stored for this scan."
                />
              )}
            </section>
          )}
        </QueryBoundary>
      )}
    </section>
  )
}
export function SettingsPage() {
  const q = useQuery<Record<string, unknown>>("config.detail")
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Shield settings"
        description="Effective server configuration. Runtime editing and persistent settings are unavailable."
      />
      <CoverageNotice />
      <QueryBoundary title="Effective configuration" query={q}>
        {(row) => (
          <Value
            value={{
              ...row,
              shutdown_timeout_ms:
                typeof row.shutdown_timeout === "number"
                  ? row.shutdown_timeout / 1e6
                  : undefined,
              shutdown_timeout: undefined,
            }}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
