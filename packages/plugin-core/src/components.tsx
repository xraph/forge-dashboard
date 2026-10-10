import type { ReactNode } from "react"
import { useState } from "react"
import {
  DownloadIcon,
  RefreshCwIcon,
  SearchIcon,
} from "@forge-go/dashboard-kit/icons"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@forge-go/dashboard-kit/components/card"
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@forge-go/dashboard-kit/components/table"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Unknown"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes}m`
      : minutes
        ? `${minutes}m ${Math.floor(seconds % 60)}s`
        : `${Math.floor(seconds)}s`
}
export function valueText(value: unknown): string {
  if (value === undefined || value === null) return "Not reported"
  return typeof value === "object" ? JSON.stringify(value) : String(value)
}
export function Status({ value }: { value?: string }) {
  const status = value?.toLowerCase() ?? "unknown"
  const tone = ["healthy", "ok", "active", "success", "running"].includes(
    status
  )
    ? "border-success/20 bg-success/10 text-success-foreground"
    : ["error", "unhealthy", "failed", "failure"].includes(status)
      ? "border-destructive/20 bg-destructive/10 text-destructive"
      : ["degraded", "warning"].includes(status)
        ? "border-warning/20 bg-warning/10 text-warning-foreground"
        : ""
  return (
    <Badge variant="outline" className={`gap-1.5 font-normal ${tone}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {value || "Unknown"}
    </Badge>
  )
}
export function Page({
  title,
  description,
  refresh,
  busy,
  data,
  children,
}: {
  title: string
  description: string
  refresh?: () => void
  busy?: boolean
  data?: unknown
  children: ReactNode
}) {
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `forge-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {data !== undefined && (
              <Button variant="outline" onClick={download}>
                <DownloadIcon />
                Export
              </Button>
            )}
            {refresh && (
              <Button variant="outline" onClick={refresh} disabled={busy}>
                <RefreshCwIcon className={busy ? "animate-spin" : ""} />
                Refresh
              </Button>
            )}
          </>
        }
      />
      {children}
    </div>
  )
}
export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="min-w-0 gap-0 overflow-hidden py-0">
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b px-4 py-3">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  )
}
export interface Column<T> {
  label: string
  render: (row: T) => ReactNode
}
export function Records<T>({
  rows,
  columns,
  rowKey,
  searchText,
  noun,
  toolbar,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T, index: number) => string
  searchText?: (row: T) => string
  noun: string
  toolbar?: ReactNode
}) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const filtered = searchText
    ? rows.filter((row) =>
        searchText(row).toLowerCase().includes(search.toLowerCase())
      )
    : rows
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 25) - 1)
  )
  const visible = filtered.slice(currentPage * 25, (currentPage + 1) * 25)
  return (
    <>
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          {searchText && (
            <div className="relative w-full max-w-sm">
              <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                aria-label={`Search ${noun}`}
                placeholder={`Search ${noun}...`}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(0)
                }}
              />
            </div>
          )}
          {toolbar}
        </div>
      )}
      {filtered.length === 0 ? (
        <EmptyState
          className="border-0"
          title={search ? "No matching results" : `No ${noun} yet`}
          description={
            search
              ? "Try another search."
              : "Records will appear here when the server reports them."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.label}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row, index) => (
              <TableRow key={rowKey(row, index)}>
                {columns.map((column) => (
                  <TableCell key={column.label}>{column.render(row)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
        <span>
          {filtered.length} {noun}
          {search && ` of ${rows.length}`}
        </span>
        {filtered.length > 25 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </Button>
            <span>
              {currentPage + 1} / {Math.ceil(filtered.length / 25)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={(currentPage + 1) * 25 >= filtered.length}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
export function Properties({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="divide-y">
      {Object.entries(values).map(([label, value]) => (
        <div
          key={label}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 px-4 py-3 text-sm"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-mono text-xs break-words">{valueText(value)}</dd>
        </div>
      ))}
    </dl>
  )
}
