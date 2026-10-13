import type { ReactNode } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  ResourceTable as KitTable,
  type ResourceTableProps,
} from "@forge-go/dashboard-kit/components/resource-table"
import type { DescriptionListProps } from "@forge-go/dashboard-kit/components/detail-layout"
import {
  SettingsForm as KitSettingsForm,
  type SettingsFormProps,
} from "@forge-go/dashboard-kit/components/settings-form"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export type { Column } from "@forge-go/dashboard-kit/components/resource-table"
export { DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"

export function PageLink({
  to,
  children,
  primary = false,
}: {
  to: string
  children: ReactNode
  primary?: boolean
}) {
  return (
    <Button
      nativeButton={false}
      role="link"
      variant={primary ? "default" : "outline"}
      size="sm"
      render={<PluginLink to={to}>{children}</PluginLink>}
    >
      {children}
    </Button>
  )
}

/**
 * `flush` is for a table that is the content of a kit Section: the section is
 * the frame, so the table draws none of its own. `boxed` (the default) and
 * `quiet` are for a table that sits on its own or inside padded content.
 */
export function ResourceTable<Row>({
  appearance = "boxed",
  ...props
}: ResourceTableProps<Row> & { appearance?: "boxed" | "quiet" | "flush" }) {
  return (
    <KitTable
      {...props}
      className={cn(
        appearance === "flush"
          ? "min-w-0 [&_td_a]:no-underline [&_td_a]:hover:underline"
          : appearance === "quiet"
            ? "min-w-0 [&_caption]:sr-only [&_tbody_tr]:border-0 [&_tbody_tr:nth-child(odd)]:bg-muted/25 [&_td]:px-3 [&_td]:py-2 [&_td_a]:no-underline [&_td_a]:hover:underline [&_th]:h-8 [&_th]:px-3 [&_thead_tr]:border-0"
            : "min-w-0 overflow-hidden rounded-md border bg-card [&_caption]:m-0 [&_caption]:border-t [&_caption]:px-4 [&_caption]:py-3 [&_caption]:text-left [&_caption]:text-xs [&_td_a]:no-underline [&_td_a]:hover:underline",
        props.className
      )}
    />
  )
}

export function DescriptionList({ items, className }: DescriptionListProps) {
  return (
    <dl
      className={cn(
        "min-w-0 divide-y rounded-md border bg-card text-sm",
        className
      )}
    >
      {items.map(({ term, value }) => (
        <div
          key={term}
          className="grid min-w-0 gap-2 px-4 py-3 @lg/main:grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)]"
        >
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere] break-words">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function SettingsForm(props: SettingsFormProps) {
  return <KitSettingsForm {...props} layout="rows" />
}

export function Identity({
  name,
  email,
  to,
}: {
  name: string
  email: string
  to: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted font-mono text-xs text-muted-foreground"
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
      <div className="min-w-0 py-0.5">
        <PluginLink to={to} className="font-medium hover:underline">
          {name}
        </PluginLink>
        {name !== email && (
          <div className="mt-0.5 text-xs text-muted-foreground">{email}</div>
        )}
      </div>
    </div>
  )
}
