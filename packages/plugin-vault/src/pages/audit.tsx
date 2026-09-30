import { useEffect, useRef, useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_RESOURCES,
  isAuditAction,
  isAuditOutcome,
  isAuditResource,
  isDeleteAction,
} from "../audit-actions"
import type { AuditList } from "../audit-actions"
import { OutcomeBadge, ResourceBadge } from "../badges"
import type { AuditEntry } from "../flag-types"
import { configPath, flagPath, secretPath } from "../keys"

const PAGE_SIZE = 25

/** How long the key filter waits for the next keystroke before it asks. */
const DEBOUNCE_MS = 300

const READS_HIDDEN_HINT = "Reads are hidden. Turn on Show reads to include them."

const RESOURCE_OPTIONS = [
  { label: "All", value: "" },
  ...AUDIT_RESOURCES.map((r) => ({ label: r, value: r })),
]
const ACTION_OPTIONS = [
  { label: "All", value: "" },
  ...AUDIT_ACTIONS.map((a) => ({ label: a, value: a })),
]
const OUTCOME_OPTIONS = [
  { label: "All", value: "" },
  ...AUDIT_OUTCOMES.map((o) => ({ label: o, value: o })),
]

/**
 * The page a key links to, or undefined when there is none. Only a secret, a
 * flag or a config entry has a page of its own, and a delete row's key names
 * something that is gone, so a link would land on a "not found".
 */
function keyPath(e: AuditEntry): string | undefined {
  if (!e.key || isDeleteAction(e.action)) return undefined
  switch (e.resource) {
    case "secret":
      return secretPath(e.key)
    case "flag":
      return flagPath(e.key)
    case "config":
      return configPath(e.key)
    default:
      return undefined
  }
}

const columns: Column<AuditEntry>[] = [
  {
    id: "time",
    header: "Time",
    className: "whitespace-nowrap",
    cell: (e) => <Timestamp value={e.createdAt} label="time" />,
  },
  {
    id: "action",
    header: "Action",
    className: "font-mono text-xs font-medium",
    cell: (e) => e.action,
  },
  {
    id: "resource",
    header: "Resource",
    cell: (e) =>
      e.resource ? <ResourceBadge resource={e.resource} /> : <NoneCell label="resource" />,
  },
  {
    id: "key",
    header: "Key",
    className: "font-mono text-xs",
    cell: (e) => {
      if (!e.key) return <NoneCell label="key" />
      const path = keyPath(e)
      return path ? <PluginLink to={path}>{e.key}</PluginLink> : e.key
    },
  },
  {
    id: "tenant",
    header: "Tenant",
    className: "font-mono text-xs",
    cell: (e) => e.tenantId || <NoneCell label="tenant" />,
  },
  {
    id: "user",
    header: "User",
    className: "font-mono text-xs",
    // An app write has no user, and a query never sets one. Say so: a blank
    // cell would read as "still loading".
    cell: (e) => e.userId || <NoneCell label="user" />,
  },
  {
    id: "outcome",
    header: "Outcome",
    cell: (e) => (
      <span className="flex flex-col items-start gap-1">
        <OutcomeBadge outcome={e.outcome} />
        {e.outcome === "failure" && e.error ? (
          <span className="text-xs text-destructive">{e.error}</span>
        ) : null}
      </span>
    ),
  },
]

/** The times the server accepts for `since`: RFC3339 with a zone, and nothing looser. */
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/** True for a time the server would take as `since`. */
function isSince(v: string): boolean {
  return RFC3339.test(v) && !Number.isNaN(Date.parse(v))
}

/**
 * Filters the overview's links can carry:
 * `?action=secret.rotated&outcome=failure&since=2026-09-30T10:00:00.000Z`.
 *
 * The plugin API hands a page route params and no search string, and the host
 * mounts the dashboard on the browser's own location, so the search is read
 * from `window.location` exactly once, when the page mounts. A value the
 * filter does not offer is dropped rather than sent: the select would have no
 * option to show for it, and the page would filter by something it cannot say.
 * The key is free text, so it is taken as given. `since` must be an RFC3339
 * time: the server refuses anything else, so anything else is ignored here.
 */
function initialFilters(): {
  resource: string
  action: string
  outcome: string
  key: string
  since: string
} {
  let search: URLSearchParams
  try {
    search = new URLSearchParams(window.location.search)
  } catch {
    search = new URLSearchParams()
  }
  const pick = (name: string, ok: (v: string) => boolean) => {
    const v = search.get(name) ?? ""
    return ok(v) ? v : ""
  }
  return {
    resource: pick("resource", isAuditResource),
    action: pick("action", isAuditAction),
    outcome: pick("outcome", isAuditOutcome),
    key: (search.get("key") ?? "").trim(),
    since: pick("since", isSince),
  }
}

/**
 * The audit log. One read, `audit.list`, paged 25 at a time.
 *
 * Every filter goes to the server, which counts the same rows it pages, so the
 * caption's total is the number of entries the filters match and never the
 * length of the page. Any change starts again at page one: page three of
 * everything is not page three of "failures".
 *
 * Reads (`secret.get`) are off by default so they do not drown the writes.
 * They only matter while no action is chosen: the server honours an explicit
 * action, `secret.get` included, whatever the box says.
 *
 * The key box shows what you type at once and asks the server 300ms after you
 * stop, trimmed, as the config page does. Filters are read from the URL once
 * and never written back to it. A `since` from the URL shows as a chip that
 * removes it.
 */
export const AuditPage: ComponentType<PluginPageProps> = () => {
  const [initial] = useState(initialFilters)
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  const [resource, setResource] = useState(initial.resource)
  const [action, setAction] = useState(initial.action)
  const [outcome, setOutcome] = useState(initial.outcome)
  // Only ever set from the URL, and only ever cleared by its chip.
  const [since, setSince] = useState(initial.since)
  const [includeReads, setIncludeReads] = useState(false)
  // What is in the box, and what the server was last asked for.
  const [keyText, setKeyText] = useState(initial.key)
  const [key, setKey] = useState(initial.key)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function change(set: (v: string) => void) {
    return (value: string) => {
      set(value)
      setPage(1)
    }
  }

  function typeKey(next: string) {
    setKeyText(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setKey(next.trim())
      setPage(1)
    }, DEBOUNCE_MS)
  }

  const list = useQuery<AuditList>("audit.list", {
    // Absent, not empty, when a filter is not set.
    ...(resource === "" ? {} : { resource }),
    ...(key === "" ? {} : { key }),
    ...(action === "" ? {} : { action }),
    ...(outcome === "" ? {} : { outcome }),
    ...(since === "" ? {} : { since }),
    includeReads,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  // Reads only count while no action is named, so that is the only time
  // hiding them can be why the list is empty.
  const readsHidden = !includeReads && action === ""

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Audit"
        description="Every change made to secrets, flags, config, overrides and rotation policies, and every failed attempt."
      />

      {/* Outside the boundary, so filtering never takes the controls away. */}
      <FilterBar
        search={{
          value: keyText,
          onChange: typeKey,
          label: "Key",
          placeholder: "Exact key",
        }}
        filters={[
          {
            id: "resource",
            label: "Resource",
            value: resource,
            options: RESOURCE_OPTIONS,
            onChange: change(setResource),
          },
          {
            id: "action",
            label: "Action",
            value: action,
            options: ACTION_OPTIONS,
            onChange: change(setAction),
          },
          {
            id: "outcome",
            label: "Outcome",
            value: outcome,
            options: OUTCOME_OPTIONS,
            onChange: change(setOutcome),
          },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Checkbox
              id="audit-show-reads"
              checked={includeReads}
              onCheckedChange={(checked) => {
                setIncludeReads(checked === true)
                setPage(1)
              }}
            />
            <Label htmlFor="audit-show-reads">Show reads</Label>
          </div>
        }
      />

      {since === "" ? null : (
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="gap-1 pr-0.5 text-xs">
            {`Since ${formatTimestamp(since)}`}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-4"
              aria-label="Remove since filter"
              onClick={() => {
                setSince("")
                setPage(1)
              }}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </Badge>
        </div>
      )}

      <QueryBoundary title="Audit" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.entries ?? []
          // The server's total, never the page length.
          const caption = `${data.total} ${data.total === 1 ? "entry" : "entries"}`
          return (
            <ResourceTable<AuditEntry>
              columns={columns}
              rows={rows}
              rowKey={(e) => e.id}
              caption={caption}
              emptyMessage="No audit entries match these filters."
              emptyAction={
                readsHidden ? (
                  <p className="text-sm text-muted-foreground">{READS_HIDDEN_HINT}</p>
                ) : undefined
              }
              pagination={{ page, pageSize: PAGE_SIZE, total: data.total }}
              onPageChange={setPage}
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
