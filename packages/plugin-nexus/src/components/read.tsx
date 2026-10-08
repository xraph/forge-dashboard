import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import type { ReactNode } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@forge-go/dashboard-kit/components/card"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { NetworkIcon } from "@forge-go/dashboard-kit/icons"
import { OutcomeBadge } from "../badges"
import type { Outcome, Posture } from "../types"

export const count = (value: number | null) =>
  value === null ? "Unavailable" : value.toLocaleString("en-US")
export const limit = (value: number) =>
  value === 0 ? "Unlimited" : count(value)
export const yesNo = (value: boolean) => (value ? "Enabled" : "Disabled")
export const rate = (value: number | null) =>
  value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`
export function Refresh({ onClick }: { onClick: () => void }) {
  return (
    <IconButton variant="outline" onClick={onClick} label="Refresh" />
  )
}
export function Empty({
  title,
  body,
  action,
  illustration,
}: {
  title: string
  body: string
  action?: ReactNode
  illustration?: ReactNode
}) {
  return (
    <ZeroState
      title={title}
      body={body}
      illustration={illustration ?? <NetworkIcon className="size-6" />}
      action={action}
    />
  )
}
export function Section({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
export function Facts({
  items,
}: {
  items: { label: string; value: ReactNode }[]
}) {
  return (
    <dl className="grid gap-x-5 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b py-2 text-sm"
        >
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-right break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
export function Metrics({
  items,
}: {
  items: { label: string; value: ReactNode; hint?: string }[]
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} size="sm" className="min-w-0">
          <CardHeader>
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="overflow-x-auto font-mono text-xl tabular-nums">
              {item.value}
            </CardTitle>
            {item.hint && (
              <CardDescription className="text-xs">{item.hint}</CardDescription>
            )}
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      {children}
    </p>
  )
}
export function PostureStrip({ value }: { value: Posture }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-xs">
      <Badge variant={value.requireApiKey ? "outline" : "destructive"}>
        {value.requireApiKey ? "Keys required" : "Open HTTP access"}
      </Badge>
      <span>{value.authenticationScope}</span>
      <span>Limiter: {value.limiterKind}</span>
      <span>Usage: {value.usageEnabled ? "collecting" : "off"}</span>
      <span>{value.guardCount} guards</span>
      <span>Cache: {value.cacheKind}</span>
    </div>
  )
}
export function UsageOff() {
  return (
    <Empty
      title="Usage collection is disabled"
      body="Monthly budgets are not enforced. Daily request limits still apply. Enable usage collection in your gateway configuration to see spend and request history."
      action={<PluginLink to="/settings">View configuration</PluginLink>}
    />
  )
}
export function OutcomeTable({ value }: { value: Record<Outcome, number> }) {
  const rows = (Object.entries(value) as [Outcome, number][]).map(
    ([outcome, requests]) => ({ outcome, requests })
  )
  return (
    <ResourceTable
      density="compact"
      rows={rows}
      rowKey={(r) => r.outcome}
      emptyMessage="No outcomes"
      columns={[
        {
          id: "outcome",
          header: "Outcome",
          cell: (r) => <OutcomeBadge outcome={r.outcome} />,
        },
        {
          id: "requests",
          header: "Requests",
          align: "end",
          cell: (r) => count(r.requests),
        },
      ]}
    />
  )
}
