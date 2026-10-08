import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { Id, IdLink } from "../components/id"
import { TenantFilter } from "../components/tenant-filter"
import { formatCount, plural } from "../format"
import { collectionPath } from "../links"
import { PAGE_SIZE, offsetFor, pageOf } from "../paging"
import { withTenant } from "../tenant"
import type { Collection, ListOutput } from "../types"
import { useDebounced } from "../use-debounced"

const columns: Column<Collection>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-medium",
    cell: (c) => (
      <div className="flex flex-col">
        <PluginLink to={collectionPath(c.id)} className="font-medium underline-offset-4 hover:underline">
          {c.name}
        </PluginLink>
        {c.description ? <span className="text-xs text-muted-foreground">{c.description}</span> : null}
      </div>
    ),
  },
  { id: "id", header: "ID", cell: (c) => <IdLink to={collectionPath(c.id)} value={c.id} label={`Open collection ${c.id}`} /> },
  { id: "tenant", header: "Tenant", cell: (c) => (c.tenant_id !== "" ? <Id value={c.tenant_id} /> : <NoneCell label="tenant" />) },
  { id: "documents", header: "Documents", align: "end", cell: (c) => <span className="tabular-nums">{formatCount(c.document_count)}</span> },
  { id: "chunks", header: "Chunks", align: "end", cell: (c) => <span className="tabular-nums">{formatCount(c.chunk_count)}</span> },
  {
    id: "chunking",
    header: "Size / overlap",
    cell: (c) => (
      <span className="font-mono text-xs tabular-nums" title="Chunk size and overlap, in tokens">
        {c.chunk_size} / {c.chunk_overlap}
      </span>
    ),
  },
  { id: "created", header: "Created", cell: (c) => <Timestamp value={c.created_at} label="creation date" /> },
]

export const CollectionsPage: ComponentType<PluginPageProps> = () => {
  const [search, setSearch] = useState("")
  const [tenant, setTenant] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const term = useDebounced(search.trim(), 300)

  const params = withTenant({ limit: PAGE_SIZE, offset, ...(term !== "" ? { search: term } : {}) }, tenant)
  const list = useQuery<ListOutput<Collection>>("collections.list", params)
  const filtered = term !== "" || tenant !== null

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Collections"
        description="Each collection chunks and embeds its documents with the size and overlap it was created with. Counts are live."
        actions={
          <PluginLink to="/collections/new" className={buttonVariants()}>
            New collection
          </PluginLink>
        }
      />
      <FilterBar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setOffset(0)
          },
          placeholder: "Search by name",
          label: "Search collections",
        }}
        actions={
          <TenantFilter
            value={tenant}
            onChange={(t) => {
              setTenant(t)
              setOffset(0)
            }}
          />
        }
      />
      <QueryBoundary title="Collections" query={list} keepPreviousData>
        {(data) => (
          <ResourceTable<Collection>
            columns={columns}
            rows={data.items}
            rowKey={(c) => c.id}
            caption={plural(data.total, "collection", "collections")}
            emptyMessage={filtered ? "No collections match these filters." : "No collections yet. Create one to start ingesting."}
            pagination={pageOf(data)}
            onPageChange={(page) => setOffset(offsetFor(page, data.limit))}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
