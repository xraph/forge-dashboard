import { useEffect, useRef, useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  ConfigTypeBadge,
  UnsupportedTypeBadge,
  WrongTypeBadge,
} from "../badges"
import { ConfigValue } from "../components/config-value"
import type { ConfigEntrySummary, ConfigList } from "../config-types"
import { configPath } from "../keys"

const PAGE_SIZE = 25

/** How long the filter waits for the next keystroke before it asks. */
const DEBOUNCE_MS = 300

function NewConfigLink() {
  return (
    <PluginLink to="/new-config" className={buttonVariants()}>
      New config
    </PluginLink>
  )
}

const columns: Column<ConfigEntrySummary>[] = [
  {
    id: "key",
    header: "Key",
    className: "font-mono text-xs font-medium",
    cell: (e) => <PluginLink to={configPath(e.key)}>{e.key}</PluginLink>,
  },
  {
    id: "type",
    header: "Type",
    cell: (e) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <ConfigTypeBadge type={e.valueType} />
        {e.knownType ? null : <UnsupportedTypeBadge />}
      </span>
    ),
  },
  {
    id: "value",
    header: "Value",
    cell: (e) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <ConfigValue value={e.value} valueType={e.valueType} />
        {e.valueMatchesType ? null : <WrongTypeBadge />}
      </span>
    ),
  },
  {
    id: "version",
    header: "Version",
    className: "font-mono text-xs tabular-nums",
    cell: (e) => `v${e.version}`,
  },
  {
    id: "updated",
    header: "Updated",
    cell: (e) => <Timestamp value={e.updatedAt} label="update" />,
  },
]

/**
 * The config list. One read, `config.list`, paged 25 at a time and narrowed by
 * a key prefix.
 *
 * The prefix box shows what you type at once and asks the server 300ms after
 * you stop, trimmed. Asking on every keystroke would send a request per letter
 * and flash the table between them. A new prefix starts at page one: page
 * three of everything is not page three of "http/".
 */
export const ConfigPage: ComponentType<PluginPageProps> = () => {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  // What is in the box, and what the server was last asked for.
  const [text, setText] = useState("")
  const [prefix, setPrefix] = useState("")
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function typeFilter(next: string) {
    setText(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setPrefix(next.trim())
      setPage(1)
    }, DEBOUNCE_MS)
  }

  const list = useQuery<ConfigList>("config.list", {
    // Absent, not empty, when there is no prefix.
    ...(prefix === "" ? {} : { keyPrefix: prefix }),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Config"
        description="Typed application settings, each with a version and a value per tenant when you override it."
        actions={<NewConfigLink />}
      />

      {/* Outside the boundary, so typing never takes the control away. */}
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label
          htmlFor="config-prefix-filter"
          className="text-xs text-muted-foreground"
        >
          Key starts with
        </Label>
        <Input
          id="config-prefix-filter"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => typeFilter(e.target.value)}
        />
      </div>

      <QueryBoundary title="Config" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.entries ?? []
          // The server's total, never the page length.
          const caption = `${data.total} ${data.total === 1 ? "entry" : "entries"}`
          return (
            <ResourceTable<ConfigEntrySummary>
              columns={columns}
              rows={rows}
              rowKey={(e) => e.id}
              caption={caption}
              emptyMessage={
                prefix === ""
                  ? "No config yet."
                  : `No keys start with ${prefix}.`
              }
              emptyAction={<NewConfigLink />}
              pagination={{ page, pageSize: PAGE_SIZE, total: data.total }}
              onPageChange={setPage}
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
