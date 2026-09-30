import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { KeyStateBadge } from "../badges"
import { ENVIRONMENTS, keyPath, maskedKey, STATES } from "../format"
import type { KeysList, KeySummary } from "../types"

const PAGE_SIZE = 25

const ALL = { value: "", label: "All" }

const columns: Column<KeySummary>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-medium",
    cell: (k) => <PluginLink to={keyPath(k.id)}>{k.name}</PluginLink>,
  },
  {
    id: "key",
    header: "Key",
    className: "font-mono text-xs",
    cell: (k) => maskedKey(k),
  },
  {
    id: "environment",
    header: "Environment",
    cell: (k) => k.environment,
  },
  {
    id: "state",
    header: "State",
    cell: (k) => <KeyStateBadge summary={k} />,
  },
  {
    id: "policy",
    header: "Policy",
    // The id until slice 4 brings the policy name with it.
    className: "font-mono text-xs",
    cell: (k) => k.policyId || <NoneCell label="policy" />,
  },
  {
    id: "scopes",
    header: "Scopes",
    cell: (k) => <TagList values={k.scopes} label="scopes" />,
  },
  {
    id: "lastUsed",
    header: "Last used",
    cell: (k) => <Timestamp value={k.lastUsedAt} label="recorded use" />,
  },
  {
    id: "expires",
    header: "Expires",
    cell: (k) => <Timestamp value={k.expiresAt} label="expiry" />,
  },
]

export const KeysPage: ComponentType<PluginPageProps> = () => {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  const [environment, setEnvironment] = useState("")
  const [state, setState] = useState("")

  // An empty filter is left out of the params rather than sent as "".
  const list = useQuery<KeysList>("keys.list", {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    ...(environment !== "" && { environment }),
    ...(state !== "" && { state }),
  })

  // A new filter means a new result set, and page 3 of it may not exist.
  function changeEnvironment(value: string) {
    setEnvironment(value)
    setPage(1)
  }
  function changeState(value: string) {
    setState(value)
    setPage(1)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="API keys"
        description="Keys are shown by prefix and last four characters. The full value is only ever shown once, when a key is created or rotated."
      />

      <div className="flex flex-col gap-1.5">
        <FilterBar
          filters={[
            {
              id: "environment",
              label: "Environment",
              value: environment,
              options: [ALL, ...ENVIRONMENTS],
              onChange: changeEnvironment,
            },
            {
              id: "state",
              label: "State",
              value: state,
              options: [ALL, ...STATES],
              onChange: changeState,
            },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          State filters match the recorded state. A key past its expiry is
          marked expired the next time it is used.
        </p>
      </div>

      <QueryBoundary title="API keys" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.keys ?? []
          // The server's total, never the page length.
          const caption = `${data.total} ${data.total === 1 ? "key" : "keys"}`
          return (
            <ResourceTable<KeySummary>
              columns={columns}
              rows={rows}
              rowKey={(k) => k.id}
              caption={caption}
              emptyMessage="No API keys yet."
              pagination={{ page, pageSize: PAGE_SIZE, total: data.total }}
              onPageChange={setPage}
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
