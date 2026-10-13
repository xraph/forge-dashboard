import type { ReactNode } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  ResourceTable as KitTable,
  type ResourceTableProps,
} from "@forge-go/dashboard-kit/components/resource-table"
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
 * Every table in this package is the content of a kit Section, so it is
 * `flush`: the section is the frame and the table draws none of its own. The
 * old `boxed` default and the `quiet` variant had no caller left once the sub
 * pages joined the shared layout, so they and the `appearance` prop are gone.
 */
export function ResourceTable<Row>(props: ResourceTableProps<Row>) {
  return (
    <KitTable
      {...props}
      className={cn(
        "min-w-0 [&_td_a]:no-underline [&_td_a]:hover:underline",
        props.className
      )}
    />
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
