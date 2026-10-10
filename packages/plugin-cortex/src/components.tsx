import { lazy, Suspense, type ComponentProps } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import {
  Button,
  buttonVariants,
} from "@forge-go/dashboard-kit/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@forge-go/dashboard-kit/components/tooltip"
import {
  ArrowLeft,
  RefreshCw,
  type LucideIcon,
} from "@forge-go/dashboard-kit/icons"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import type { Runtime, Scope } from "./types"
export function IconAction({
  label,
  icon: Icon,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "children"> & {
  label: string
  icon: LucideIcon
}) {
  return (
    <TooltipProvider delay={250}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={label}
              {...props}
            />
          }
        >
          <Icon aria-hidden="true" className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
export function IconLink({
  label,
  to,
  icon: Icon,
}: {
  label: string
  to: string
  icon: LucideIcon
}) {
  return (
    <TooltipProvider delay={250}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PluginLink
              to={to}
              aria-label={label}
              className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
            >
              <Icon aria-hidden="true" className="size-4" />
            </PluginLink>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
export const CodeEditor = lazy(() => import("./editor"))
export function Code({
  text,
  label,
  json = false,
  onChange,
}: {
  text: string
  label: string
  json?: boolean
  onChange?: (text: string) => void
}) {
  return (
    <Suspense
      fallback={
        <pre
          className="max-h-48 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap"
          aria-label={label}
        >
          {text}
        </pre>
      }
    >
      <CodeEditor
        text={text}
        label={label}
        language={json ? "json" : "text"}
        onChange={onChange}
      />
    </Suspense>
  )
}
export function State({ value }: { value: string }) {
  return (
    <Badge
      variant={
        ["failed", "blocked", "rejected"].includes(value)
          ? "destructive"
          : value === "running"
            ? "default"
            : ["paused", "created", "disabled", "pending"].includes(value)
              ? "secondary"
              : "outline"
      }
    >
      {value}
    </Badge>
  )
}
export function ScopeLine({ scope }: { scope: Scope }) {
  return (
    <span className="text-xs break-all text-muted-foreground">
      {scope.levels.map((l) => `${l.key}: ${l.value}`).join(" / ")}
    </span>
  )
}
export function Value({ value, label }: { value: unknown; label: string }) {
  if (value === undefined || value === null || value === "")
    return <NoneCell label={label} />
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>
  if (typeof value !== "object")
    return (
      <span className="break-words whitespace-pre-wrap">{String(value)}</span>
    )
  if (Array.isArray(value)) {
    if (!value.length) return <NoneCell label={label} />
    return (
      <ul className="grid min-w-0 gap-2">
        {value.map((item, i) => (
          <li key={i} className="min-w-0 rounded-md border p-2">
            <Value value={item} label={label} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <dl className="grid min-w-0 gap-2">
      {Object.entries(value).map(([key, item]) => (
        <div
          key={key}
          className="grid min-w-0 gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
        >
          <dt className="text-xs text-muted-foreground">
            {key.replaceAll("_", " ")}
          </dt>
          <dd className="min-w-0 text-sm">
            <Value value={item} label={key} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
export function AuditDates({
  created,
  updated,
}: {
  created: string
  updated?: string
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        Created <Timestamp value={created} label="created" />
      </span>
      {updated && (
        <span>
          Updated <Timestamp value={updated} label="updated" />
        </span>
      )}
    </div>
  )
}
export function Back({ to, label }: { to: string; label: string }) {
  return <IconLink to={to} label={`Back to ${label}`} icon={ArrowLeft} />
}
export function Reload({ onClick }: { onClick: () => void }) {
  return <IconAction label="Refresh" icon={RefreshCw} onClick={onClick} />
}
export function useAccess(permission: string) {
  const q = useQuery<Runtime & { permissions: Record<string, boolean> }>(
    "runtime.detail"
  )
  return q.data?.permissions?.[permission] ?? false
}
