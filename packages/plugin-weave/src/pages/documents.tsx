import { useState } from "react"
import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { useCollectionOptions } from "../collection-options"
import { documentColumns } from "../components/document-columns"
import { TenantFilter } from "../components/tenant-filter"
import { plural } from "../format"
import { useSearchParam, useSetSearchParams } from "../links"
import { PAGE_SIZE, offsetFor, pageOf } from "../paging"
import { withTenant } from "../tenant"
import type { DocumentRow, ListOutput } from "../types"
import { useDebounced } from "../use-debounced"

const columns = documentColumns({ withCollection: true })

const STATES = [
  { label: "Any state", value: "" },
  { label: "Ready", value: "ready" },
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Failed", value: "failed" },
]

/**
 * Collection and state live in the address, so a link from an ingest
 * conflict or a collection page lands filtered. Search, tenant and paging are
 * the page's own.
 */
export const DocumentsPage: ComponentType<PluginPageProps> = () => {
  const collectionId = useSearchParam("collection_id")
  const state = useSearchParam("state")
  const setParams = useSetSearchParams("/documents")
  const [search, setSearch] = useState("")
  const [tenant, setTenant] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  // Bumped by "Clear filters" so the tenant picker forgets its own mode.
  const [clears, setClears] = useState(0)
  const term = useDebounced(search.trim(), 300)

  const collections = useCollectionOptions(collectionId, "All collections")
  const params = withTenant(
    {
      limit: PAGE_SIZE,
      offset,
      ...(collectionId !== "" ? { collection_id: collectionId } : {}),
      ...(state !== "" ? { state } : {}),
      ...(term !== "" ? { search: term } : {}),
    },
    tenant
  )
  const list = useQuery<ListOutput<DocumentRow>>("documents.list", params)
  const filtered =
    collectionId !== "" || state !== "" || term !== "" || tenant !== null

  function clear() {
    setSearch("")
    setTenant(null)
    setClears((n) => n + 1)
    setOffset(0)
    setParams({ collection_id: "", state: "" })
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Documents"
        description="Newest first. A document's state is where its ingest got to."
      />
      <FilterBar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setOffset(0)
          },
          placeholder: "Search titles",
          label: "Search documents",
        }}
        filters={[
          {
            id: "collection",
            label: "Collection",
            value: collectionId,
            options: collections.options,
            onChange: (v) => {
              setOffset(0)
              setParams({ collection_id: v })
            },
          },
          {
            id: "state",
            label: "State",
            value: state,
            options: STATES,
            onChange: (v) => {
              setOffset(0)
              setParams({ state: v })
            },
          },
        ]}
        actions={
          <TenantFilter
            key={clears}
            value={tenant}
            onChange={(t) => {
              setTenant(t)
              setOffset(0)
            }}
          />
        }
      />
      {collections.note !== null &&
        (collections.error ? (
          <p className="text-xs text-destructive" role="alert">
            {collections.note}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground" role="status">
            {collections.note}
          </p>
        ))}
      <QueryBoundary title="Documents" query={list} keepPreviousData>
        {(data) => (
          <ResourceTable<DocumentRow>
            columns={columns}
            rows={data.items}
            rowKey={(d) => d.id}
            caption={plural(data.total, "document", "documents")}
            emptyMessage={
              filtered
                ? "No documents match these filters."
                : "No documents yet. Open a collection and ingest one."
            }
            emptyAction={
              filtered ? (
                <Button variant="outline" onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined
            }
            pagination={pageOf(data)}
            onPageChange={(page) => setOffset(offsetFor(page, data.limit))}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
