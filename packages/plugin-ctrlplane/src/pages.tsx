import { useState } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import {
  QueryBoundary,
  CommandAlert,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import {
  CommandButton,
  Details,
  Fields,
  initialValues,
  JsonView,
  payloadFor,
  State,
  Value,
} from "./components"
import { deployFields, domainFields, resources, routeFields } from "./resources"
import { identity, label, mainImage, record, rows, text } from "./types"
import type { Field, Listing, PageProps, Row } from "./types"

const linkClass = "font-medium underline underline-offset-2"
function resourceLink(kind: string, row: Row) {
  return `/${kind}/${encodeURIComponent(identity(row))}`
}
export function DataTable({
  value,
  columns,
  title,
  kind,
  actions,
  emptyAction,
}: {
  value: unknown
  columns: string[]
  title: string
  kind?: string
  actions?: (row: Row) => React.ReactNode
  emptyAction?: React.ReactNode
}) {
  const items = rows(value)
  const meta = record(value)
  const incomplete =
    meta.complete === false ||
    (Number(meta.total) > items.length && !meta.next_cursor)
  return (
    <div className="min-w-0 space-y-2">
      {incomplete && (
        <p role="status" className="text-xs text-muted-foreground">
          Showing a bounded result. Narrow the selection to inspect more
          records.
        </p>
      )}
      <ResourceTable
        rows={items}
        rowKey={(row) =>
          identity(row) || text(row.timestamp) || JSON.stringify(row)
        }
        columns={columns.map((name) => ({
          id: name,
          header: label(name),
          cell: (row: Row) =>
            name === "image" ? (
              <Value name="image" value={mainImage(row)} />
            ) : name === "name" && kind ? (
              <PluginLink to={resourceLink(kind, row)} className={linkClass}>
                {text(row.name)}
              </PluginLink>
            ) : name === "id" && kind ? (
              <PluginLink
                to={resourceLink(kind, row)}
                className="font-mono text-xs underline"
              >
                {text(row.id)}
              </PluginLink>
            ) : (
              <Value name={name} value={row[name]} />
            ),
        }))}
        caption={`${items.length} ${title.toLowerCase()} in this result`}
        emptyMessage={`No ${title.toLowerCase()}${incomplete ? " in this window" : " found"}.`}
        emptyAction={
          emptyAction ?? (
            <PluginLink to="/workloads" className={linkClass}>
              Browse workloads
            </PluginLink>
          )
        }
        rowActions={actions}
      />
    </div>
  )
}
function Toolbar({
  filters,
  values,
  setValues,
}: {
  filters: string[]
  values: Row
  setValues: (value: Row) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      {filters.map((name) => (
        <label key={name} className="flex flex-col gap-1 text-xs">
          {label(name)}
          <Input
            className="w-40"
            aria-label={`Filter ${name}`}
            type={["since", "until"].includes(name) ? "datetime-local" : "text"}
            value={text(values[name])}
            onChange={(e) => setValues({ ...values, [name]: e.target.value })}
          />
        </label>
      ))}
      {Object.values(values).some(Boolean) && (
        <Button variant="ghost" size="sm" onClick={() => setValues({})}>
          Clear filters
        </Button>
      )}
    </div>
  )
}
export function ResourceList({
  kind,
  embedded = false,
}: {
  kind: string
  embedded?: boolean
}) {
  const resource = resources[kind]
  const [filters, setFilters] = useState<Row>({})
  const [cursor, setCursor] = useState("")
  const query = useQuery<Listing | Row[]>(`${kind}.list`, {
    ...filters,
    limit: 50,
    cursor,
  })
  return (
    <div className="space-y-3">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">{resource.title}</h2>
          <PluginLink to={`/${kind}/create`} className={linkClass}>
            Create {resource.singular.toLowerCase()}
          </PluginLink>
        </div>
      ) : (
        <PageHeader
          title={resource.title}
          actions={
            <>
              <Button size="sm" variant="outline" onClick={query.refetch}>
                Refresh
              </Button>
              {resource.create && (
                <PluginLink to={`/${kind}/create`} className={linkClass}>
                  Create {resource.singular.toLowerCase()}
                </PluginLink>
              )}
            </>
          }
        />
      )}
      {resource.filters && (
        <Toolbar
          filters={resource.filters}
          values={filters}
          setValues={(next) => {
            setFilters(next)
            setCursor("")
          }}
        />
      )}
      <QueryBoundary title={resource.title} query={query}>
        {(data) => (
          <>
            <DataTable
              value={data}
              columns={resource.columns}
              title={resource.title}
              kind={kind}
              emptyAction={
                Object.values(filters).some(Boolean) || cursor ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFilters({})
                      setCursor("")
                    }}
                  >
                    Reset selection
                  </Button>
                ) : resource.create ? (
                  <PluginLink to={`/${kind}/create`} className={linkClass}>
                    Create {resource.singular.toLowerCase()}
                  </PluginLink>
                ) : (
                  <Button size="sm" variant="outline" onClick={query.refetch}>
                    Refresh
                  </Button>
                )
              }
              actions={
                kind === "workloads"
                  ? (row) => (
                      <CommandButton
                        action={{
                          ...resource.actions!.at(-1)!,
                          redirect: "/workloads",
                        }}
                        target={{ id: row.id }}
                        title={text(row.name)}
                      />
                    )
                  : undefined
              }
            />
            {record(data).next_cursor && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCursor(text(record(data).next_cursor))}
              >
                Next page
              </Button>
            )}
            {cursor && (
              <Button size="sm" variant="ghost" onClick={() => setCursor("")}>
                First page
              </Button>
            )}
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
interface Section {
  label: string
  intent: string
  columns?: string[]
  kind?: string
  params?: Row
  actions?: (row: Row) => React.ReactNode
}
function SectionContent({
  section,
  params,
}: {
  section: Section
  params: Row
}) {
  const query = useQuery<unknown>(section.intent, {
    ...params,
    ...section.params,
  })
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{section.label}</h2>
        <Button size="sm" variant="ghost" onClick={query.refetch}>
          Refresh {section.label.toLowerCase()}
        </Button>
      </div>
      <QueryBoundary title={section.label} query={query}>
        {(data) =>
          section.intent === "system.stats" ? (
            <>
              <StatGrid
                className="grid-cols-1 gap-2 sm:grid-cols-3"
                items={Object.entries(record(data)).map(([key, value]) => ({
                  label: label(key),
                  value: text(value),
                }))}
              />
              <p className="text-xs text-muted-foreground">
                Global instance and healthy-provider counters are unavailable in
                the current admin service.
              </p>
            </>
          ) : section.columns ? (
            <DataTable
              value={data}
              columns={section.columns}
              title={section.label}
              kind={section.kind}
              actions={section.actions}
            />
          ) : (
            <Details
              row={
                section.intent === "telemetry.detail"
                  ? { resources: record(data).resources }
                  : record(data)
              }
              fields={
                section.intent === "telemetry.detail"
                  ? ["resources"]
                  : Object.keys(record(data))
              }
            />
          )
        }
      </QueryBoundary>
    </div>
  )
}
export function ResourceDetail({ kind, params }: PageProps & { kind: string }) {
  const resource = resources[kind]
  const id = params?.id ?? ""
  const target =
    kind === "workers" || kind === "providers" ? { name: id } : { id }
  const query = useQuery<Row | Row[]>(
    kind === "providers" ? "providers.list" : `${kind}.detail`,
    kind === "providers" ? {} : target
  )
  const [tab, setTab] = useState(
    params?.section ? label(params.section) : "Info"
  )
  return (
    <div className="space-y-3">
      <PageHeader
        title={resource.singular}
        actions={
          <>
            <PluginLink className={linkClass} to={`/${kind}`}>
              All {resource.title.toLowerCase()}
            </PluginLink>
            <Button size="sm" variant="outline" onClick={query.refetch}>
              Refresh
            </Button>
          </>
        }
      />
      <QueryBoundary title={resource.singular} query={query}>
        {(data) => {
          const row =
            kind === "providers"
              ? rows(data).find((row) => row.name === id)
              : record(data)
          if (!row)
            return (
              <ZeroState
                title="Provider not found"
                body="The provider may have been unregistered. Return to the provider list."
                action={
                  <PluginLink to="/providers">Browse providers</PluginLink>
                }
              />
            )
          const sections: Section[] = []
          const childParams: Row = {
            id,
            instance_id: kind === "instances" ? id : undefined,
            workload_id: kind === "workloads" ? id : undefined,
            limit: 50,
          }
          if (kind === "workloads")
            sections.push({
              label: "Replicas",
              intent: "workloads.instances",
              columns: resources.instances.columns,
              kind: "instances",
            })
          if (kind === "instances" || kind === "workloads")
            sections.push(
              {
                label: "Deployments",
                intent: "deployments.list",
                columns: ["id", ...resources.deployments.columns],
                kind: "deployments",
              },
              {
                label: "Releases",
                intent: "releases.list",
                columns: ["id", ...resources.releases.columns],
                kind: "releases",
                actions:
                  kind === "instances"
                    ? (release) => (
                        <CommandButton
                          action={{
                            intent: "deployments.rollback",
                            label: "Roll back",
                            destructive: true,
                            description:
                              "Restore this saved release to the selected instance.",
                          }}
                          target={{ instance_id: id, release_id: release.id }}
                        />
                      )
                    : undefined,
              },
              {
                label: "Health",
                intent:
                  kind === "workloads" ? "workloads.health" : "health.detail",
              },
              {
                label: "Domains",
                intent: "domains.list",
                columns: [
                  "hostname",
                  "verified",
                  "tls_enabled",
                  "verify_token",
                  "dns_target",
                  "cert_expiry",
                  "created_at",
                ],
                actions:
                  kind === "instances"
                    ? (domain) => (
                        <div className="flex gap-1">
                          <CommandButton
                            action={{
                              intent: "domains.verify",
                              label: "Record verification",
                              description:
                                "The current service records verification without checking external DNS. Confirm ownership independently first.",
                            }}
                            target={{ id: domain.id }}
                          />
                          <CommandButton
                            action={{
                              intent: "domains.provisionCert",
                              label: "Record certificate",
                              description:
                                "The current service records certificate metadata. External ACME issuance is not established by this operation.",
                            }}
                            target={{ id: domain.id }}
                          />
                          <CommandButton
                            action={{
                              intent: "domains.delete",
                              label: "Remove",
                              destructive: true,
                            }}
                            target={{ id: domain.id }}
                          />
                        </div>
                      )
                    : undefined,
              },
              {
                label: "Routes",
                intent: "routes.list",
                columns: [
                  "id",
                  "service_name",
                  "hostname",
                  "path",
                  "port",
                  "protocol",
                  "weight",
                  "tls_verify",
                  "strip_prefix",
                  "rewrite_redirects",
                  "rewrite_cookie_path",
                  "upstream_origin",
                ],
                actions:
                  kind === "instances"
                    ? (route) => (
                        <div className="flex gap-1">
                          <CommandButton
                            action={{
                              intent: "routes.update",
                              label: "Edit",
                              nested: true,
                              fields: routeFields.filter(
                                (f) => !["port", "protocol"].includes(f.key)
                              ),
                            }}
                            target={{ id: route.id }}
                            seed={route}
                          />
                          <CommandButton
                            action={{
                              intent: "routes.delete",
                              label: "Remove",
                              destructive: true,
                            }}
                            target={{ id: route.id }}
                          />
                        </div>
                      )
                    : undefined,
              }
            )
          if (kind === "instances")
            sections.push(
              {
                label: "Checks",
                intent: "health.checks",
                columns: [
                  "name",
                  "service_name",
                  "type",
                  "target",
                  "interval",
                  "timeout",
                  "enabled",
                ],
                actions: (check) => (
                  <div className="flex gap-1">
                    <CommandButton
                      action={{ intent: "health.run", label: "Run check" }}
                      target={{ id: check.id }}
                    />
                    <CommandButton
                      action={{
                        intent: "health.remove",
                        label: "Remove",
                        destructive: true,
                      }}
                      target={{ id: check.id }}
                    />
                  </div>
                ),
              },
              {
                label: "Secrets",
                intent: "secrets.list",
                columns: ["key", "type", "version", "created_at", "updated_at"],
                actions: (secret) => (
                  <CommandButton
                    action={{
                      intent: "secrets.delete",
                      label: "Delete secret",
                      destructive: true,
                    }}
                    target={{ instance_id: id, key: secret.key }}
                  />
                ),
              },
              { label: "Telemetry", intent: "telemetry.detail" }
            )
          if (kind === "datacenters")
            sections.push(
              {
                label: "Instances",
                intent: "datacenters.instances",
                columns: resources.instances.columns,
                kind: "instances",
              },
              {
                label: "Bootstrap services",
                intent: "bootstrap.list",
                columns: [
                  "name",
                  "state",
                  "provider_name",
                  "region",
                  "kind",
                  "attempts",
                  "last_error",
                  "updated_at",
                ],
                actions: (bootstrap) =>
                  bootstrap.state === "failed" ? (
                    <CommandButton
                      action={{
                        intent: "bootstrap.retry",
                        label: "Retry failed bootstrap",
                      }}
                      target={{ id: bootstrap.id }}
                    />
                  ) : null,
              }
            )
          if (kind === "tenants")
            sections.push({ label: "Quota", intent: "tenants.quota" })
          if (kind === "providers")
            sections.push({
              label: "Instances",
              intent: "instances.list",
              params: { provider: id },
              columns: resources.instances.columns,
              kind: "instances",
            })
          const section = sections.find((s) => s.label === tab)
          return (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-medium">
                  {text(row.name) || identity(row)}
                </h2>
                <div className="flex flex-wrap gap-1">
                  {resource.edit && (
                    <PluginLink
                      className={linkClass}
                      to={`/${kind}/${encodeURIComponent(id)}/edit`}
                    >
                      Edit
                    </PluginLink>
                  )}
                  {resource.actions?.map((action) => (
                    <CommandButton
                      key={action.intent}
                      action={{
                        ...action,
                        redirect: action.intent.endsWith(".delete")
                          ? `/${kind}`
                          : undefined,
                      }}
                      target={target}
                      title={text(row.name)}
                      seed={row}
                    />
                  ))}
                  {kind === "releases" && (
                    <CommandButton
                      action={{
                        intent: "deployments.rollback",
                        label: "Roll back",
                        destructive: true,
                      }}
                      target={{
                        instance_id: row.instance_id,
                        release_id: row.id,
                      }}
                    />
                  )}
                  {kind === "instances" && (
                    <CommandButton
                      action={{
                        intent: "deployments.create",
                        label: "Deploy",
                        fields: deployFields,
                      }}
                      target={{ instance_id: id }}
                      seed={row}
                    />
                  )}
                </div>
              </div>
              <div
                role="tablist"
                aria-label={`${resource.singular} sections`}
                className="flex flex-wrap gap-1 border-b pb-2"
              >
                {["Info", ...sections.map((s) => s.label)].map((name) => (
                  <Button
                    key={name}
                    role="tab"
                    aria-selected={name === tab}
                    size="sm"
                    variant={name === tab ? "secondary" : "ghost"}
                    onClick={() => setTab(name)}
                  >
                    {name}
                  </Button>
                ))}
              </div>
              <div role="tabpanel">
                {!section ? (
                  <div className="space-y-3">
                    <Details row={row} fields={resource.fields} />
                    {Object.entries(row)
                      .filter(
                        ([key, value]) =>
                          typeof value === "object" &&
                          value !== null &&
                          !resource.fields.includes(key)
                      )
                      .map(([key, value]) => (
                        <details key={key} open={key === "services"}>
                          <summary className="cursor-pointer text-sm font-medium">
                            {label(key)}
                          </summary>
                          <div className="mt-2">
                            {key === "services" ? (
                              <DataTable
                                value={value}
                                columns={["name", "role", "image", "resources"]}
                                actions={(service) => (
                                  <details>
                                    <summary className="cursor-pointer text-xs">
                                      Configuration
                                    </summary>
                                    <JsonView
                                      value={service}
                                      title={`${text(service.name)} configuration`}
                                    />
                                  </details>
                                )}
                                title="Services"
                              />
                            ) : key === "endpoints" ? (
                              <DataTable
                                value={value}
                                title="Endpoints"
                                columns={[
                                  "service_name",
                                  "url",
                                  "port",
                                  "protocol",
                                  "public",
                                ]}
                              />
                            ) : (
                              <JsonView value={value} title={label(key)} />
                            )}
                          </div>
                        </details>
                      ))}
                    {text(record(row.labels)["ctrlplane.workload"]) && (
                      <PluginLink
                        className={linkClass}
                        to={`/workloads/${encodeURIComponent(text(record(row.labels)["ctrlplane.workload"]))}`}
                      >
                        Parent workload
                      </PluginLink>
                    )}
                    {kind === "deployments" && text(row.release_id) && (
                      <PluginLink
                        className={linkClass}
                        to={`/releases/${text(row.release_id)}`}
                      >
                        Inspect release
                      </PluginLink>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {kind === "instances" && tab === "Domains" && (
                      <CommandButton
                        action={{
                          intent: "domains.create",
                          label: "Add domain",
                          fields: domainFields,
                        }}
                        target={{ instance_id: id }}
                      />
                    )}
                    {kind === "instances" && tab === "Routes" && (
                      <CommandButton
                        action={{
                          intent: "routes.create",
                          label: "Add route",
                          fields: routeFields,
                        }}
                        target={{ instance_id: id }}
                      />
                    )}
                    {kind === "instances" && tab === "Secrets" && (
                      <p className="text-xs text-muted-foreground">
                        Secret values are managed by the configured vault. This
                        view returns metadata only.
                      </p>
                    )}
                    {kind === "instances" && tab === "Telemetry" && (
                      <p className="text-xs text-muted-foreground">
                        Only the resource snapshot is populated by the current
                        telemetry service. Other aggregate fields are not
                        measurements.
                      </p>
                    )}
                    <SectionContent
                      key={section.intent}
                      section={section}
                      params={childParams}
                    />
                  </div>
                )}
              </div>
            </>
          )
        }}
      </QueryBoundary>
    </div>
  )
}

export function ResourceEditor({ kind, params }: PageProps & { kind: string }) {
  const edit = Boolean(params?.id)
  const query = useQuery<Row>(
    `${kind}.detail`,
    { id: params?.id },
    { enabled: edit }
  )
  const fields = (edit ? resources[kind].edit : resources[kind].create) ?? []
  return (
    <div className="space-y-3">
      <PageHeader
        title={`${edit ? "Edit" : "Create"} ${resources[kind].singular.toLowerCase()}`}
        actions={
          <PluginLink className={linkClass} to={`/${kind}`}>
            All {kind}
          </PluginLink>
        }
      />
      {edit ? (
        <QueryBoundary title={resources[kind].singular} query={query}>
          {(row) => (
            <EditorForm
              key={text(row.updated_at)}
              kind={kind}
              fields={fields}
              row={row}
            />
          )}
        </QueryBoundary>
      ) : (
        <EditorForm kind={kind} fields={fields} />
      )}
    </div>
  )
}
function EditorForm({
  kind,
  fields,
  row = {},
}: {
  kind: string
  fields: Field[]
  row?: Row
}) {
  const [values, setValues] = useState<Row>(() => initialValues(fields, row))
  const [validation, setValidation] = useState("")
  const command = useCommand<Row>(`${kind}.${row.id ? "update" : "create"}`)
  const navigate = useNavigateTo()
  async function save() {
    try {
      const payload = payloadFor(fields, values)
      setValidation("")
      const result = await command.execute(
        row.id ? { id: row.id, request: payload } : payload
      )
      if (result?.id)
        navigate(`/${kind}/${encodeURIComponent(text(result.id))}`)
    } catch (error) {
      setValidation(error instanceof Error ? error.message : "Invalid fields.")
    }
  }
  return (
    <form
      className="max-w-3xl space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <Fields fields={fields} values={values} setValues={setValues} />
      {validation && (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      )}
      <CommandAlert title="Save failed" error={command.error} />
      <Button type="submit" disabled={command.loading}>
        {command.loading ? "Saving…" : "Save"}
      </Button>
    </form>
  )
}
export function SelectionPage({ surface }: { surface: string }) {
  const query = useQuery<Listing>("instances.list", { limit: 50 })
  return (
    <div className="space-y-3">
      <PageHeader
        title={label(surface)}
        description="Choose an instance to inspect and manage its resources."
      />
      <QueryBoundary title="Instances" query={query}>
        {(data) => (
          <DataTable
            value={data}
            columns={resources.instances.columns}
            title="Instances"
            kind="instances"
            actions={(row) => (
              <PluginLink
                className={linkClass}
                to={`/instances/${text(row.id)}/${surface === "network" ? "domains" : surface}`}
              >
                Open {surface}
              </PluginLink>
            )}
          />
        )}
      </QueryBoundary>
    </div>
  )
}
function WorkloadHealthRow({ row }: { row: Row }) {
  const query = useQuery<Row>("workloads.health", { id: row.id })
  return (
    <QueryBoundary title={`Health for ${text(row.name)}`} query={query}>
      {(health) => (
        <div className="flex flex-wrap items-center gap-3 border-b py-2 text-sm">
          <PluginLink to={resourceLink("workloads", row)} className={linkClass}>
            {text(row.name)}
          </PluginLink>
          <State value={health.status} />
          <span>
            {text(health.healthy_count)}/{text(health.replica_count)} healthy
          </span>
          <span>
            {text(health.degraded_count)} degraded ·{" "}
            {text(health.unhealthy_count)} unhealthy ·{" "}
            {text(health.unknown_count)} unknown
          </span>
        </div>
      )}
    </QueryBoundary>
  )
}
function WorkloadHealthSummary() {
  const query = useQuery<Listing>("workloads.list", { limit: 20 })
  return (
    <QueryBoundary title="Workload health" query={query}>
      {(data) => (
        <div>
          <h2 className="text-sm font-medium">Workload health</h2>
          <p className="text-xs text-muted-foreground">
            Up to 20 workloads in the authenticated tenant. Missing checks
            remain unknown.
          </p>
          {rows(data).length ? (
            rows(data).map((row) => (
              <WorkloadHealthRow key={identity(row)} row={row} />
            ))
          ) : (
            <ZeroState
              title="No workload health"
              body="Create a workload to inspect its replica health."
              action={
                <PluginLink to="/workloads/create">Create workload</PluginLink>
              }
            />
          )}
        </div>
      )}
    </QueryBoundary>
  )
}
export function HealthPage() {
  const query = useQuery<Row>("health.summary", { limit: 100 })
  return (
    <div className="space-y-3">
      <PageHeader
        title="Health"
        description="Unknown means no passing evidence is available. Counts cover the current bounded instance sample."
        actions={
          <Button variant="outline" size="sm" onClick={query.refetch}>
            Refresh
          </Button>
        }
      />
      <WorkloadHealthSummary />
      <QueryBoundary title="Health" query={query}>
        {(data) => (
          <>
            <div className="flex flex-wrap gap-3 text-sm">
              {Object.entries(record(data.counts)).map(([key, value]) => (
                <span key={key}>
                  <State value={key} /> {text(value)}
                </span>
              ))}
            </div>
            <DataTable
              value={{
                ...data,
                items: rows(data).map((row) => ({
                  ...record(row.instance),
                  health_status: record(row.health).status,
                  uptime_percent: record(row.health).uptime_percent,
                  checks: Array.isArray(record(row.health).checks)
                    ? (record(row.health).checks as unknown[]).length
                    : undefined,
                  last_checked: record(row.health).last_checked,
                  error: row.error,
                })),
              }}
              columns={[
                "name",
                "health_status",
                "uptime_percent",
                "checks",
                "last_checked",
                "error",
                "provider_name",
                "region",
              ]}
              title="Instances"
              kind="instances"
            />
            <PluginLink to="/workloads" className={linkClass}>
              Inspect workload health by replica
            </PluginLink>
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
export function LogPage({ kind }: { kind: "audit" | "events" }) {
  const [filters, setFilters] = useState<Row>({})
  const query = useQuery<Row>(`${kind}.list`, {
    ...Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [
        key,
        ["since", "until"].includes(key) && value
          ? new Date(text(value)).toISOString()
          : value,
      ])
    ),
    limit: 100,
  })
  return (
    <div className="space-y-3">
      <PageHeader
        title={kind === "audit" ? "Audit log" : "Recent events"}
        description={
          kind === "events"
            ? "An in-process event window. Restarting the server clears it."
            : "A bounded audit window. Use filters to narrow the records."
        }
        actions={
          <Button size="sm" variant="outline" onClick={query.refetch}>
            Refresh
          </Button>
        }
      />
      <Toolbar
        filters={
          kind === "audit"
            ? ["tenant_id", "actor_id", "resource", "action", "since", "until"]
            : ["type"]
        }
        values={filters}
        setValues={setFilters}
      />
      <QueryBoundary title={label(kind)} query={query}>
        {(data) => (
          <DataTable
            value={data}
            columns={
              kind === "audit"
                ? [
                    "created_at",
                    "actor_id",
                    "action",
                    "resource",
                    "resource_id",
                    "ip_address",
                    "details",
                  ]
                : [
                    "timestamp",
                    "type",
                    "tenant_id",
                    "actor_id",
                    "instance_id",
                    "payload",
                  ]
            }
            title={kind === "audit" ? "Audit entries" : "Events"}
          />
        )}
      </QueryBoundary>
    </div>
  )
}
export function ConfigPage() {
  const query = useQuery<Row>("config.detail")
  return (
    <div className="space-y-3">
      <PageHeader
        title="Settings"
        description="Read-only configuration. A configured flag does not establish live connectivity."
      />
      <QueryBoundary title="Settings" query={query}>
        {(data) => <Details row={data} fields={Object.keys(data)} />}
      </QueryBoundary>
    </div>
  )
}
export function OverviewPage() {
  const session = useQuery<Row>("session.detail")
  return (
    <div className="space-y-3">
      <PageHeader
        title="Ctrlplane"
        description="Deploy workloads and inspect their replicas."
      />
      <QueryBoundary title="Session" query={session}>
        {(data) => (
          <>
            <p className="text-xs text-muted-foreground">
              Tenant{" "}
              <span className="font-mono">
                {text(data.tenant_id) || "system scope"}
              </span>{" "}
              · {text(data.subject)}
            </p>
            {data.admin === true && (
              <SectionContent
                section={{ label: "System overview", intent: "system.stats" }}
                params={{}}
              />
            )}
            <ResourceList kind="workloads" embedded />
            <WorkloadHealthSummary />
            <SectionContent
              section={{
                label: "Recent deployments",
                intent: "deployments.recent",
                columns: [
                  "id",
                  "instance_id",
                  "image",
                  "state",
                  "strategy",
                  "created_at",
                ],
                kind: "deployments",
              }}
              params={{ limit: 10 }}
            />
            {data.admin === true && (
              <SectionContent
                section={{
                  label: "Workers",
                  intent: "workers.list",
                  columns: resources.workers.columns,
                  kind: "workers",
                }}
                params={{}}
              />
            )}
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
