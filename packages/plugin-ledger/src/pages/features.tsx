import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import {
  FEATURE_STATUS_OPTIONS,
  FeatureStatusBadge,
  SharedBadge,
} from "../badges"
import { ImportFromProviderAction } from "../components/import-from-provider"
import { BackToFirstPage, OffsetPager } from "../components/offset-pager"
import { limitText, periodLabel, TYPE_LABEL } from "../lib/features"
import { listEmptyMessage, pageCaption, pageParams } from "../lib/paging"
import { featurePath } from "../lib/paths"
import type { CatalogFeature, Page } from "../types"

const columns: Column<CatalogFeature>[] = [
  {
    id: "name",
    header: "Feature",
    className: "font-medium",
    cell: (f) => (
      <span className="flex items-center gap-2">
        <PluginLink to={featurePath(f.id)}>{f.name}</PluginLink>
        {f.app_id === "" && <SharedBadge />}
      </span>
    ),
  },
  {
    id: "key",
    header: "Key",
    className: "font-mono text-xs",
    cell: (f) => f.key,
  },
  { id: "type", header: "Type", cell: (f) => TYPE_LABEL[f.type] ?? f.type },
  {
    id: "limit",
    header: "Default limit",
    align: "end",
    className: "tabular-nums",
    cell: (f) => limitText(f.type, f.default_limit),
  },
  {
    id: "period",
    header: "Resets",
    cell: (f) => periodLabel(f.period) ?? <NoneCell label="reset period" />,
  },
  {
    id: "status",
    header: "Status",
    cell: (f) => <FeatureStatusBadge status={f.status} />,
  },
]

function NewFeatureLink() {
  return (
    <PluginLink to="/features/new" className={buttonVariants()}>
      New feature
    </PluginLink>
  )
}

/**
 * The reusable feature catalog. "This app" and "Shared" are two different
 * lists on the server (features.list with and without global), not a filter
 * over one, so switching reads again from the first page.
 */
export function LedgerFeaturesPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("")
  const [catalog, setCatalog] = useState<"app" | "shared">("app")
  const list = useQuery<Page<CatalogFeature>>("features.list", {
    ...pageParams(page),
    status: status || undefined,
    global: catalog === "shared" ? true : undefined,
  })
  const filtered =
    [status, catalog === "shared" ? "shared" : ""].filter(Boolean).join(" ") ||
    undefined

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Features"
        description="The catalog plans draw their features from."
        actions={
          <>
            <ImportFromProviderAction<CatalogFeature>
              intent="features.importFromProvider"
              noun="feature"
              description="Copies one feature from the payment provider into this app's catalog, or into the shared catalog when no app is selected. A key the catalog already uses is refused."
              pathOf={(f) => featurePath(f.id)}
            />
            <NewFeatureLink />
          </>
        }
      />
      <FilterBar
        filters={[
          {
            id: "catalog",
            label: "Catalog",
            value: catalog,
            options: [
              { label: "This app", value: "app" },
              { label: "Shared", value: "shared" },
            ],
            onChange: (next) => {
              setCatalog(next as "app" | "shared")
              setPage(1)
            },
          },
          {
            id: "status",
            label: "Status",
            value: status,
            options: [{ label: "All", value: "" }, ...FEATURE_STATUS_OPTIONS],
            onChange: (next) => {
              setStatus(next)
              setPage(1)
            },
          },
        ]}
      />
      <QueryBoundary title="Features" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<CatalogFeature>
                columns={columns}
                rows={rows}
                rowKey={(f) => f.id}
                caption={pageCaption({
                  page,
                  shown: rows.length,
                  hasMore: data.has_more,
                  singular: "feature",
                  plural: "features",
                })}
                emptyMessage={listEmptyMessage("features", page, filtered)}
                emptyAction={
                  page > 1 ? (
                    <BackToFirstPage onClick={() => setPage(1)} />
                  ) : filtered === undefined ? (
                    <NewFeatureLink />
                  ) : undefined
                }
              />
              <OffsetPager
                page={page}
                hasMore={data.has_more}
                onPageChange={setPage}
              />
            </div>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
