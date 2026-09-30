import { useState, type ComponentType } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { EventListResponse } from "../types"
import { eventColumns } from "../components/event-columns"
import { formatSeq } from "../format"

const PAGE = 50

export interface EventFilters {
  after: string
  before: string
  userId: string
  sessionId: string
  requestId: string
  categories: string
  actions: string
  resources: string
  severity: string
  outcome: string
}

const EMPTY: EventFilters = {
  after: "", before: "", userId: "", sessionId: "", requestId: "",
  categories: "", actions: "", resources: "", severity: "", outcome: "",
}

const LABELS: Record<keyof EventFilters, string> = {
  after: "After", before: "Before", userId: "User", sessionId: "Session", requestId: "Request",
  categories: "Categories", actions: "Actions", resources: "Resources", severity: "Severity", outcome: "Outcome",
}

const LIST_FIELDS = ["categories", "actions", "resources", "severity", "outcome"] as const
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean)

/** A datetime-local value is the operator's local time: the contract wants an instant. */
function rfc3339(local: string): string | undefined {
  const t = new Date(local)
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString()
}

/** The filters as the contract takes them: lists for the multi-value fields, RFC3339 times. */
export function toQueryParams(f: EventFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const after = f.after ? rfc3339(f.after) : undefined
  const before = f.before ? rfc3339(f.before) : undefined
  if (after) out.after = after
  if (before) out.before = before
  for (const k of ["userId", "sessionId", "requestId"] as const) if (f[k].trim()) out[k] = f[k].trim()
  for (const k of LIST_FIELDS) if (list(f[k]).length) out[k] = list(f[k])
  return out
}

export function activeFilters(f: EventFilters): { label: string; value: string }[] {
  return (Object.keys(LABELS) as (keyof EventFilters)[]).filter((k) => f[k].trim()).map((k) => ({ label: LABELS[k], value: f[k].trim() }))
}

export const EventsPage: ComponentType<PluginPageProps> = () => {
  const [draft, setDraft] = useState<EventFilters>(EMPTY)
  const [applied, setApplied] = useState<EventFilters>(EMPTY)
  const [offset, setOffset] = useState(0)
  const q = useQuery<EventListResponse>("events.list", { ...toQueryParams(applied), limit: PAGE, offset })
  const active = activeFilters(applied)

  const clear = () => {
    setDraft(EMPTY)
    setApplied(EMPTY)
    setOffset(0)
  }

  const field = (k: keyof EventFilters, type = "text", placeholder = "") => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{LABELS[k]}</span>
      <Input aria-label={LABELS[k]} type={type} placeholder={placeholder} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
    </label>
  )
  const select = (k: "outcome" | "severity", options: string[]) => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{LABELS[k]}</span>
      <NativeSelect aria-label={LABELS[k]} className="w-full" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
        <NativeSelectOption value="">Any</NativeSelectOption>
        {options.map((o) => (
          <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  )

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Events" description="Every event in your scope's audit trail. Filters run on the server, so a search covers the whole log, not the page on screen." />
      <form
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          setApplied(draft)
          setOffset(0)
        }}
      >
        {field("actions", "text", "user.login, role.grant")}
        {field("resources", "text", "patient_record")}
        {field("categories", "text", "auth, data")}
        {select("outcome", ["success", "failure", "denied"])}
        {select("severity", ["info", "warning", "critical"])}
        {field("userId")}
        {field("sessionId")}
        {field("requestId")}
        {field("after", "datetime-local")}
        {field("before", "datetime-local")}
        <div className="col-span-2 flex items-end gap-2 md:col-span-2">
          <Button type="submit">Apply filters</Button>
          {/* Named apart from the empty state's "Clear filters" so both can be on screen at once. */}
          {active.length > 0 && (
            <Button type="button" variant="outline" onClick={clear}>
              Reset filters
            </Button>
          )}
        </div>
      </form>
      <QueryBoundary title="events" query={q} skeletonRows={10}>
        {(data) => (
          <ResourceTable
            columns={eventColumns({ showUser: true })}
            rows={data.events}
            rowKey={(e) => e.id}
            caption={`${formatSeq(data.events.length)} of ${formatSeq(data.total)} events`}
            emptyMessage={active.length ? "No events match these filters" : "This chain holds no events yet."}
            emptyAction={
              active.length ? (
                <div className="flex flex-col items-center gap-2 text-sm">
                  <p>{active.map((f) => `${f.label}: ${f.value}`).join("; ")}</p>
                  <Button type="button" variant="outline" onClick={clear}>
                    Clear filters
                  </Button>
                </div>
              ) : undefined
            }
            pagination={{ page: offset / PAGE + 1, pageSize: PAGE, total: data.total }}
            onPageChange={(page) => setOffset((page - 1) * PAGE)}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
