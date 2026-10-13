import { useRef, useState } from "react"
import {
  PluginLink,
  PluginSlot,
  useCommand,
  useNavigateTo,
  usePoll,
  useQuery,
  type PluginPageProps,
} from "@forge-go/dashboard-plugin"
import {
  Pencil,
  Power,
  PowerOff,
  Trash2,
  Link2,
  Unlink2,
  SlidersHorizontal,
} from "@forge-go/dashboard-kit/icons"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
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
import { Section } from "@forge-go/dashboard-kit/components/section"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  CoverageNotice,
  IconAction,
  IconLink,
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
        <PluginLink
          to={path(collection, r.id)}
          className="font-medium"
          aria-label={String(r.name ?? r.framework ?? r.id)}
        >
          <span title={r.id}>
            {String(
              r.name ??
                r.framework ??
                (r.id.length > 18
                  ? `${r.id.slice(0, 9)}…${r.id.slice(-6)}`
                  : r.id)
            )}
          </span>{" "}
          {typeof r.metadata === "object" &&
            r.metadata !== null &&
            String((r.metadata as Record<string, unknown>).source).includes(
              "example"
            ) && (
              <span className="ml-2 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                Example
              </span>
            )}
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
    <section className="flex min-w-0 flex-col gap-4">
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
      <Section
        aria-label={`${label(collection)} list`}
        actions={
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
        }
      >
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
      </Section>
      <RefreshStatus query={query} />
    </section>
  )
}
export function OverviewPage() {
  const overview = useQuery<Overview>("overview")
  const scans = useQuery<Page>("scans.list", { limit: 5, offset: 0 })
  usePoll(overview.refetch)
  usePoll(scans.refetch)
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Shield"
        description="Safety configuration and stored record review."
        actions={
          <IconLink
            to="/profiles"
            label="Manage profiles"
            icon={SlidersHorizontal}
          />
        }
      />
      <CoverageNotice />
      <QueryBoundary
        title="Configuration summary"
        query={overview}
        keepPreviousData
      >
        {(o) => (
          <StatGrid
            aria-label="Configuration summary"
            items={o.sections.map((s) => ({
              label: label(s.collection),
              value: s.available ? s.total : "Unavailable",
              href: path(s.collection),
            }))}
            renderLink={(href, cell) => (
              <PluginLink
                to={href}
                className="grid outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                {cell}
              </PluginLink>
            )}
          />
        )}
      </QueryBoundary>
      <Section
        title="Recent stored scans"
        actions={
          <PluginLink to="/scans" className="text-xs underline">
            All scans
          </PluginLink>
        }
      >
        <QueryBoundary title="Stored scans" query={scans} keepPreviousData>
          {(p) =>
            p.items.length ? (
              <ResourceTable
                emptyMessage="No records in this scope."
                rows={p.items}
                columns={columns("scans").filter(
                  (c) => !["pii_count", "profile_used"].includes(c.id)
                )}
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
      </Section>
      <PluginSlot name="shield.overview.widgets" />
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
      <IconLink
        to={`${path(collection, row.id)}/edit`}
        label="Edit"
        icon={Pencil}
      />
      <IconAction
        label={row.enabled ? "Disable" : "Enable"}
        icon={row.enabled ? PowerOff : Power}
        disabled={toggle.loading}
        onClick={async () => {
          if (busy.current) return
          busy.current = true
          try {
            await toggle.execute({ id: row.id, enabled: !row.enabled })
          } finally {
            busy.current = false
          }
        }}
      />
      <IconAction
        label="Delete"
        icon={Trash2}
        variant="destructive"
        onClick={() => {
          remove.reset()
          setOpen(true)
        }}
      />
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
    <Section title="Tenant assignment" inset>
      <QueryBoundary query={q} title="Policy assignment">
        {(a) => (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              <code>{a.tenant_id}</code>:{" "}
              {a.assigned ? "Assigned" : "Not assigned"}
            </span>
            {caps.can_manage && (
              <IconAction
                label={a.assigned ? "Unassign" : "Assign to this tenant"}
                icon={a.assigned ? Unlink2 : Link2}
                disabled={assign.loading || unassign.loading}
                onClick={() =>
                  void (a.assigned ? unassign : assign).execute({ id })
                }
              />
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
    </Section>
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
    <Section title="Referenced by profiles" inset>
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
    </Section>
  )
}
function RecordFields({ row }: { row: Row }) {
  const entries = Object.entries(row).filter(
    ([k]) =>
      ![
        "id",
        "name",
        "enabled",
        "app_id",
        "tenant_id",
        "created_at",
        "updated_at",
      ].includes(k)
  )
  const empty = (v: unknown) =>
    v === null ||
    v === undefined ||
    v === "" ||
    (typeof v === "object" && Object.keys(v).length === 0)
  const populated = entries.filter(([, v]) => !empty(v))
  const scalar = populated.filter(([, v]) => typeof v !== "object")
  const structured = populated.filter(([, v]) => typeof v === "object")
  const missing = entries.filter(([, v]) => empty(v))
  return (
    <>
      {(scalar.length > 0 || missing.length > 0) && (
        <Section title="Details" inset>
          {scalar.length > 0 && (
            <DescriptionList
              items={scalar.map(([key, value]) => ({
                term: label(key),
                value: <Value value={value} field={key} />,
              }))}
            />
          )}
          {missing.length > 0 && (
            <div
              className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground ${scalar.length > 0 ? "mt-3" : ""}`}
            >
              {missing.map(([key]) => (
                <span key={key}>
                  {label(key)} <span className="opacity-60">None</span>
                </span>
              ))}
            </div>
          )}
        </Section>
      )}
      {structured.length > 0 && (
        <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2">
          {structured.map(([key, value]) => (
            <Section
              key={key}
              title={label(key)}
              actions={
                Array.isArray(value) ? (
                  <span className="text-xs text-muted-foreground">
                    {value.length}
                  </span>
                ) : undefined
              }
              inset
            >
              <Value value={value} field={key} />
            </Section>
          ))}
        </div>
      )}
    </>
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
  const [tokenOffset, setTokenOffset] = useState(0)
  const tokens = useQuery<Page>(
    "pii.byScan",
    { id, limit: 25, offset: tokenOffset },
    { enabled: collection === "scans" }
  )
  const editable = collections.includes(
    collection as (typeof collections)[number]
  )
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title={
          q.data?.name ??
          (collection === "scans"
            ? "Stored scan"
            : collection === "compliance"
              ? "Stored report"
              : label(collection))
        }
        meta={
          q.data ? (
            <>
              <code className="text-xs break-all">{q.data.id}</code>
              {editable && <Status enabled={q.data.enabled} />}
              <span className="text-xs text-muted-foreground">
                <Timestamp value={q.data.created_at} label="created" />
              </span>
            </>
          ) : undefined
        }
        actions={
          <>
            <IconLink to={path(collection)} label={`Back to ${collection}`} />
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
            <RecordFields row={row} />
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
      )}
      {collection === "scans" && (
        <Section title="PII metadata">
          <QueryBoundary title="PII metadata" query={tokens}>
            {(page) => (
              <>
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
                <Pager page={page} onChange={setTokenOffset} />
              </>
            )}
          </QueryBoundary>
        </Section>
      )}
      {collection === "scans" && (
        <PluginSlot name="shield.scan.detail" params={{ scanId: id }} />
      )}
      {collection === "profiles" && (
        <PluginSlot name="shield.profile.detail" params={{ profileId: id }} />
      )}
    </section>
  )
}
export function SettingsPage() {
  const q = useQuery<Record<string, unknown>>("config.detail")
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Shield settings"
        description="Effective server configuration. Runtime editing and persistent settings are unavailable."
      />
      <CoverageNotice />
      <Section title="Effective configuration" inset>
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
      </Section>
      <PluginSlot name="shield.settings" />
    </section>
  )
}
