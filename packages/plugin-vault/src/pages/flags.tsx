import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { FlagEnabledBadge, FlagTypeBadge, WrongTypeBadge } from "../badges"
import { FlagValue } from "../components/flag-value"
import { FLAG_TYPES, isFlagType } from "../flag-types"
import type { FlagType } from "../flag-types"
import { flagPath } from "../keys"

/**
 * Mirrors the Go `FlagSummary`. Field names are its JSON tags. Timestamps are
 * RFC3339 UTC strings.
 */
export interface FlagSummary {
  id: string
  key: string
  type: FlagType
  /** Whatever the flag stores. It is not guaranteed to match `type`. */
  defaultValue: unknown
  /** False when the stored default is not a value of `type`. */
  defaultMatchesType: boolean
  description: string
  tags: string[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** Mirrors the Go `flagsListResponse`. */
export interface FlagsList {
  flags: FlagSummary[]
  total: number
}

const PAGE_SIZE = 25

function NewFlagLink() {
  return (
    <PluginLink to="/new-flag" className={buttonVariants()}>
      New flag
    </PluginLink>
  )
}

const columns: Column<FlagSummary>[] = [
  {
    id: "key",
    header: "Key",
    className: "font-mono text-xs font-medium",
    cell: (f) => <PluginLink to={flagPath(f.key)}>{f.key}</PluginLink>,
  },
  {
    id: "type",
    header: "Type",
    cell: (f) => <FlagTypeBadge type={f.type} />,
  },
  {
    id: "status",
    header: "Status",
    cell: (f) => <FlagEnabledBadge enabled={f.enabled} />,
  },
  {
    id: "default",
    header: "Default",
    cell: (f) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <FlagValue value={f.defaultValue} type={f.type} />
        {f.defaultMatchesType ? null : <WrongTypeBadge />}
      </span>
    ),
  },
  {
    id: "tags",
    header: "Tags",
    cell: (f) => <TagList values={f.tags ?? []} label="tags" />,
  },
  {
    id: "updated",
    header: "Updated",
    cell: (f) => <Timestamp value={f.updatedAt} label="update" />,
  },
]

export const FlagsPage: ComponentType<PluginPageProps> = () => {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  // "" is All types. It is never sent: an unknown type is BAD_REQUEST, and the
  // server treats an absent one as all.
  const [type, setType] = useState<FlagType | "">("")

  const list = useQuery<FlagsList>("flags.list", {
    ...(type === "" ? {} : { type }),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Flags"
        description="Feature flags, each with a default and the rules that override it."
        actions={<NewFlagLink />}
      />

      {/* Outside the boundary, so choosing a type never takes the control away. */}
      <div className="flex items-center gap-1.5">
        <Label htmlFor="flag-type-filter" className="text-xs text-muted-foreground">
          Type
        </Label>
        <NativeSelect
          id="flag-type-filter"
          value={type}
          onChange={(e) => {
            const next = e.target.value
            setType(isFlagType(next) ? next : "")
            // Page three of "all" is not page three of "int".
            setPage(1)
          }}
        >
          <NativeSelectOption value="">All types</NativeSelectOption>
          {FLAG_TYPES.map((t) => (
            <NativeSelectOption key={t} value={t}>
              {t}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <QueryBoundary title="Flags" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.flags ?? []
          // The server's total, never the page length.
          const caption = `${data.total} ${data.total === 1 ? "flag" : "flags"}`
          return (
            <ResourceTable<FlagSummary>
              columns={columns}
              rows={rows}
              rowKey={(f) => f.id}
              caption={caption}
              emptyMessage={type === "" ? "No flags yet." : `No ${type} flags.`}
              emptyAction={<NewFlagLink />}
              pagination={{ page, pageSize: PAGE_SIZE, total: data.total }}
              onPageChange={setPage}
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
