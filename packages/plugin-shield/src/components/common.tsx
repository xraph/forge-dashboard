import { useState, type ReactNode } from "react"
import {
  PluginLink,
  useQuery,
  type QueryState,
} from "@forge-go/dashboard-plugin"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  type LucideIcon,
} from "@forge-go/dashboard-kit/icons"
import { IconButton as IconAction } from "@forge-go/dashboard-kit/components/icon-button"
export { IconAction }
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { label, singular, type Capabilities, type Page } from "../types"
export function IconLink({
  label,
  to,
  icon: Icon = ArrowLeft,
}: {
  label: string
  to: string
  icon?: LucideIcon
}) {
  return (
    <IconAction
      label={label}
      icon={Icon}
      render={
        <PluginLink to={to}>
          <Icon aria-hidden="true" className="size-4" />
        </PluginLink>
      }
    />
  )
}
export function CoverageNotice() {
  const caps = useQuery<Capabilities>("capabilities")
  return (
    <div
      role="note"
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs"
    >
      <span className="font-medium">Safety evaluation is unavailable</span>
      <span className="text-muted-foreground">
        Six layers unfinished. Configuration and history only.
      </span>
      {caps.data && (
        <span className="text-muted-foreground">
          Tenant <code>{caps.data.scope.tenant_id}</code> · App{" "}
          <code>{caps.data.scope.app_id}</code>
        </span>
      )}
    </div>
  )
}
export function Status({ enabled }: { enabled?: boolean }) {
  return (
    <Badge variant={enabled ? "secondary" : "outline"}>
      {enabled ? "Enabled" : "Disabled"}
    </Badge>
  )
}
export function Empty({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return <ZeroState title={title} body={body} action={action} />
}
export function NewLink({ collection }: { collection: string }) {
  return (
    <IconLink
      to={`/${collection}/new`}
      label={`New ${singular(collection)}`}
      icon={Plus}
    />
  )
}
export function RefreshStatus({ query }: { query: QueryState<Page> }) {
  const [lastSuccess, setLastSuccess] = useState(query.data?.refreshed_at)
  if (query.data?.refreshed_at && query.data.refreshed_at !== lastSuccess)
    setLastSuccess(query.data.refreshed_at)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {query.loading
          ? "Refreshing records…"
          : query.error
            ? "Refresh failed. Retry to load current records."
            : "Refreshes every 10 seconds while visible."}{" "}
        {lastSuccess && (
          <>
            Last successful refresh:{" "}
            <Timestamp label="refresh" value={lastSuccess} />
          </>
        )}
      </span>
      <IconAction
        label="Refresh"
        icon={RefreshCw}
        onClick={query.refetch}
        disabled={query.loading}
      />
    </div>
  )
}
export function Pager({
  page,
  onChange,
}: {
  page: Page
  onChange: (offset: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {page.total === 0
          ? "0 records"
          : `${page.offset + 1}–${page.offset + page.items.length} of ${page.total}`}
      </span>
      <div className="flex gap-2">
        <IconAction
          label="Previous"
          icon={ChevronLeft}
          disabled={page.offset === 0}
          onClick={() => onChange(Math.max(0, page.offset - page.limit))}
        />
        <IconAction
          label="Next"
          icon={ChevronRight}
          disabled={!page.has_more}
          onClick={() => onChange(page.offset + page.limit)}
        />
      </div>
    </div>
  )
}
export function Value({
  value,
  field = "value",
}: {
  value: unknown
  field?: string
}) {
  if (value === null || value === undefined || value === "")
    return <NoneCell label={field} />
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>
  if (typeof value === "number")
    return (
      <span className="font-mono text-xs">
        {value}
        {field === "duration_ms" ? " ms" : ""}
      </span>
    )
  if (typeof value === "string")
    return field.endsWith("_at") || field.startsWith("period_") ? (
      <Timestamp label={field} value={value} />
    ) : (
      <span className="break-words whitespace-pre-wrap">{value}</span>
    )
  if (Array.isArray(value)) {
    if (value.length === 0) return <NoneCell label={field} />
    if (value.every((v) => typeof v === "string"))
      return <TagList values={value as string[]} label={field} />
    return (
      <div className="grid gap-1.5">
        {value.map((v, i) => (
          <div key={i} className="rounded border bg-muted/20 px-2 py-1.5">
            <Value value={v} field={field} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <dl className="grid min-w-0 gap-1">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div
          key={k}
          className="grid min-w-0 grid-cols-[minmax(5rem,8rem)_minmax(0,1fr)] gap-3"
        >
          <dt className="text-xs text-muted-foreground">{label(k)}</dt>
          <dd className="min-w-0 text-xs">
            <Value value={v} field={k} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
