import { useState, type FormEvent } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription } from "@forge-go/dashboard-kit/components/alert"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import {
  CHECK_SUBJECT_KINDS,
  DECISIONS,
  checkColumns,
  type CheckLogList,
  type CheckSummary,
} from "../components/check-log"
import { useNamespaceFilter } from "../components/namespace-filter"
import type { ConfigDetail } from "./config"

const PAGE_SIZE = 25

const HOUR_MS = 3_600_000

/** The time windows, keyed by the select's value. "" is any time. */
const WINDOWS = {
  "1h": { label: "Last hour", ms: HOUR_MS },
  "24h": { label: "Last 24 hours", ms: 24 * HOUR_MS },
  "7d": { label: "Last 7 days", ms: 7 * 24 * HOUR_MS },
  "30d": { label: "Last 30 days", ms: 30 * 24 * HOUR_MS },
} as const

type WindowKey = keyof typeof WINDOWS

/** The five fields the store matches exactly, held as typed text. */
interface ExactFields {
  subjectKind: string
  subjectId: string
  action: string
  resourceType: string
  resourceId: string
}

const NO_EXACT: ExactFields = {
  subjectKind: "",
  subjectId: "",
  action: "",
  resourceType: "",
  resourceId: "",
}

/** Only the exact-match fields somebody filled in, trimmed. Blank ones are absent. */
function exactParams(fields: ExactFields): Partial<ExactFields> {
  const out: Partial<ExactFields> = {}
  for (const key of Object.keys(fields) as (keyof ExactFields)[]) {
    const value = fields[key].trim()
    if (value !== "") out[key] = value
  }
  return out
}

function checks(n: number): string {
  return `${n} ${n === 1 ? "check" : "checks"}`
}

/**
 * What the engine decided and could not record.
 *
 * The counts belong to the server process that answered, not to this tenant:
 * the writer's queue is shared by every tenant the process serves, so the
 * line says so instead of implying the loss is this tenant's.
 */
function LossLine({ loss }: { loss: NonNullable<CheckLogList["notRecorded"]> }) {
  const total = loss.queueFull + loss.writeFailed
  if (total === 0) return null
  const causes: string[] = []
  if (loss.queueFull > 0) causes.push(`${loss.queueFull} because the log queue was full`)
  if (loss.writeFailed > 0) causes.push(`${loss.writeFailed} because the store refused the write`)
  return (
    <p className="text-sm text-muted-foreground">
      This server failed to record {checks(total)} since it started (
      <Timestamp value={loss.since} label="start" />
      ): {causes.join(", ")}. Those checks were decided, and they have no row here. The count
      covers every tenant this server handles.
    </p>
  )
}

export function WardenCheckLogPage() {
  // One-based, matching ResourceTable's PaginationState. Every setter of a
  // filter below resets it, because a page number carried across filters
  // lands on page N of a shorter set.
  const [page, setPage] = useState(1)
  const namespace = useNamespaceFilter(() => setPage(1))
  const [decision, setDecision] = useState("")
  const [cached, setCached] = useState<"" | "cached" | "evaluated">("")
  const [timeWindow, setTimeWindow] = useState<"" | WindowKey>("")
  // The instant is fixed when the window is chosen. Computing it while
  // rendering would move it on every render, so the query key would change
  // and the page would refetch forever.
  const [after, setAfter] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState<ExactFields>(NO_EXACT)
  const [applied, setApplied] = useState<ExactFields>(NO_EXACT)

  const appliedParams = exactParams(applied)
  const params = {
    ...namespace.param,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    // Unset filters are ABSENT, not empty strings: the server reads "" as a
    // value, and `cached: ""` is not even a boolean.
    ...(decision !== "" && { decision }),
    ...(cached !== "" && { cached: cached === "cached" }),
    ...(after !== undefined && { after }),
    ...appliedParams,
  }

  const list = useQuery<CheckLogList>("checkLogs.list", params)
  const config = useQuery<ConfigDetail>("config.detail")

  const filtered =
    namespace.value !== "all" ||
    decision !== "" ||
    cached !== "" ||
    after !== undefined ||
    Object.keys(appliedParams).length > 0

  // Retention can shrink the set while an operator is on a later page. The
  // table shows no pager for an empty page, so without this they would be
  // stranded on a page that says nothing.
  if (list.data && (list.data.items ?? []).length === 0 && list.data.total > 0 && page > 1) {
    setPage(1)
  }

  function chooseWindow(next: string) {
    const key = next as "" | WindowKey
    setTimeWindow(key)
    setAfter(key === "" ? undefined : new Date(Date.now() - WINDOWS[key].ms).toISOString())
    setPage(1)
  }

  function apply(event: FormEvent) {
    event.preventDefault()
    setApplied(draft)
    setPage(1)
  }

  function clear() {
    setDraft(NO_EXACT)
    setApplied(NO_EXACT)
    setPage(1)
  }

  // `=== false`, not `!config.data?.checkLogEnabled`: a config read that
  // failed or has not landed says nothing about logging, and the page must
  // not guess.
  const loggingOff = config.data?.checkLogEnabled === false

  function emptyMessage(): string {
    if (filtered) return "No checks match these filters."
    // The alert above carries the logging-off sentence, once.
    if (loggingOff) return "No checks are in the log."
    return "No checks have been recorded yet."
  }

  const columns = checkColumns()

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Check log" />

      <FilterBar
        filters={[
          namespace.filterConfig,
          {
            id: "decision",
            label: "Decision",
            value: decision,
            options: [
              { label: "Any decision", value: "" },
              ...DECISIONS.map((d) => ({ label: d, value: d })),
            ],
            onChange: (next) => {
              setDecision(next)
              setPage(1)
            },
          },
          {
            id: "cached",
            label: "Cached",
            value: cached,
            options: [
              { label: "Any", value: "" },
              { label: "Cached", value: "cached" },
              { label: "Not cached", value: "evaluated" },
            ],
            onChange: (next) => {
              setCached(next as "" | "cached" | "evaluated")
              setPage(1)
            },
          },
          {
            id: "window",
            label: "Time",
            value: timeWindow,
            options: [
              { label: "Any time", value: "" },
              ...(Object.keys(WINDOWS) as WindowKey[]).map((key) => ({
                label: WINDOWS[key].label,
                value: key,
              })),
            ],
            onChange: chooseWindow,
          },
        ]}
      />

      <form className="flex flex-wrap items-end gap-3" onSubmit={apply}>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="check-log-subject-kind">Subject kind</Label>
          <NativeSelect
            id="check-log-subject-kind"
            value={draft.subjectKind}
            onChange={(e) => setDraft((d) => ({ ...d, subjectKind: e.target.value }))}
          >
            <NativeSelectOption value="">Any kind</NativeSelectOption>
            {CHECK_SUBJECT_KINDS.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {kind}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </span>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="check-log-subject-id">Subject id</Label>
          <Input
            id="check-log-subject-id"
            className="font-mono text-xs"
            value={draft.subjectId}
            onChange={(e) => setDraft((d) => ({ ...d, subjectId: e.target.value }))}
          />
        </span>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="check-log-action">Action</Label>
          <Input
            id="check-log-action"
            className="font-mono text-xs"
            value={draft.action}
            onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
          />
        </span>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="check-log-resource-type">Resource type</Label>
          <Input
            id="check-log-resource-type"
            className="font-mono text-xs"
            value={draft.resourceType}
            onChange={(e) => setDraft((d) => ({ ...d, resourceType: e.target.value }))}
          />
        </span>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="check-log-resource-id">Resource id</Label>
          <Input
            id="check-log-resource-id"
            className="font-mono text-xs"
            value={draft.resourceId}
            onChange={(e) => setDraft((d) => ({ ...d, resourceId: e.target.value }))}
          />
        </span>
        <Button type="submit">Apply</Button>
        <Button type="button" variant="outline" onClick={clear}>
          Clear
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        Checks cannot be filtered by the rule that decided them yet.
      </p>

      <QueryBoundary title="Check log" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          // The server's total, never rows.length: rows is one page.
          const caption =
            after === undefined
              ? checks(data.total)
              : `${checks(data.total)} since ${formatTimestamp(after)}`
          return (
            <div className="flex flex-col gap-4">
              {loggingOff && (
                <Alert>
                  <AlertDescription>
                    {data.total > 0
                      ? "Check logging is off, so warden is not recording checks. These rows were recorded before it was turned off."
                      : "Check logging is off, so warden is not recording checks."}
                  </AlertDescription>
                </Alert>
              )}
              {data.notRecorded && <LossLine loss={data.notRecorded} />}
              <ResourceTable<CheckSummary>
                columns={columns}
                rows={rows}
                rowKey={(c) => c.id}
                caption={caption}
                emptyMessage={emptyMessage()}
                pagination={{ page, pageSize: data.limit, total: data.total }}
                onPageChange={setPage}
              />
            </div>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
