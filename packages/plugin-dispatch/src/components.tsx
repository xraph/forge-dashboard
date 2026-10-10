import type { ReactNode } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"

export function Frame({
  title,
  children,
  description = "Operator-wide view. Scope filters do not change access.",
  actions,
}: {
  title: string
  children: ReactNode
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </div>
  )
}
export function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}
export function ResourceLink({
  kind,
  id,
  children,
}: {
  kind: string
  id: string
  children?: ReactNode
}) {
  return (
    <PluginLink
      to={`/${kind}/${encodeURIComponent(id)}`}
      className="break-all text-primary underline-offset-4 hover:underline"
    >
      {children ?? <span className="font-mono text-xs">{id}</span>}
    </PluginLink>
  )
}
export function Stamp({
  value,
  label,
}: {
  value: string | null
  label: string
}) {
  return <Timestamp value={value ?? undefined} label={label} />
}
export function Text({
  value,
  label = "value",
}: {
  value: string | number | null | undefined
  label?: string
}) {
  return value === null || value === undefined || value === "" ? (
    <NoneCell label={label} />
  ) : (
    <>{value}</>
  )
}
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <DescriptionList
      className="grid-cols-[minmax(0,auto)_minmax(0,1fr)] [&_dd]:break-words"
      items={items.map(([term, value]) => ({ term, value }))}
    />
  )
}
export function Resources({ values }: { values: Record<string, number> }) {
  return Object.keys(values).length ? (
    <Facts
      items={Object.entries(values).map(([key, value]) => [
        key,
        value.toLocaleString(undefined, { maximumSignificantDigits: 21 }),
      ])}
    />
  ) : (
    <NoneCell label="resource declarations" />
  )
}
export function Off({ title, body }: { title: string; body: string }) {
  return (
    <ZeroState
      title={title}
      body={body}
      action={
        <PluginLink
          to="/config"
          className="text-sm text-primary hover:underline"
        >
          Inspect engine settings
        </PluginLink>
      }
    />
  )
}
export function Rows<T>({
  title,
  rows,
  columns,
  rowKey,
  refresh,
  emptyBody,
  emptyTitle,
  emptyAction,
}: {
  title: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  refresh: () => void
  emptyBody?: string
  emptyTitle?: string
  emptyAction?: ReactNode
}) {
  if (!rows.length)
    return (
      <ZeroState
        title={emptyTitle ?? "No " + title}
        body={emptyBody ?? "No records are available in this view."}
        action={
          emptyAction ?? (
            <Button size="sm" variant="outline" onClick={refresh}>
              Refresh
            </Button>
          )
        }
      />
    )
  return (
    <ResourceTable
      density="compact"
      caption={`${rows.length} ${title} shown`}
      rows={rows}
      columns={columns}
      rowKey={rowKey}
      emptyMessage={"No " + title}
    />
  )
}
export function settingLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .replaceAll("Ttl", "TTL")
    .replaceAll("Uid", "UID")
    .replaceAll("Gid", "GID")
}
export function SettingValue({
  value,
  rawKeys = false,
}: {
  value: unknown
  rawKeys?: boolean
}): ReactNode {
  if (value == null) return <NoneCell label="configured value" />
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number")
    return value.toLocaleString(undefined, { maximumSignificantDigits: 21 })
  if (typeof value === "string") return <Text value={value} />
  if (Array.isArray(value))
    return value.length ? (
      <ul className="flex min-w-0 flex-col gap-1">
        {value.map((item, index) => (
          <li key={index}>
            <SettingValue value={item} rawKeys={rawKeys} />
          </li>
        ))}
      </ul>
    ) : (
      <NoneCell label="entries" />
    )
  if (typeof value === "object") {
    if ("text" in value && "ms" in value && typeof value.text === "string")
      return value.text
    return Object.keys(value).length ? (
      <Facts
        items={Object.entries(value).map(([key, item]) => [
          rawKeys ? key : settingLabel(key),
          <SettingValue value={item} rawKeys={rawKeys} />,
        ])}
      />
    ) : (
      <NoneCell label="entries" />
    )
  }
  return <NoneCell label="value" />
}
