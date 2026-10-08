import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { NativeSelect } from "@forge-go/dashboard-kit/components/native-select"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { UsersIcon } from "@forge-go/dashboard-kit/icons"
import { TenantBadge } from "../badges"
import { CursorPager, useCursorStack } from "../components/cursor-pager"
import { Money } from "../components/money"
import { Empty, limit } from "../components/read"
import { tenantPath } from "../format"
import { compareMoney } from "../money"
import type { Page, Tenant } from "../types"

function TenantRows({
  search,
  status,
  clear,
}: {
  search: string
  status: string
  clear: () => void
}) {
  const pager = useCursorStack()
  const query = useQuery<Page<Tenant>>("tenants.list", {
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(pager.cursor ? { cursor: pager.cursor } : {}),
    limit: 25,
  })
  return (
    <QueryBoundary title="Tenants" query={query}>
      {(data) => (
        <>
          {data.items.length ? (
            <ResourceTable
              density="compact"
              rows={data.items}
              rowKey={(t) => t.id}
              emptyMessage="No tenants"
              columns={[
                {
                  id: "name",
                  header: "Tenant",
                  cell: (t) => (
                    <div>
                      <PluginLink to={tenantPath(t.id)}>{t.name}</PluginLink>
                      <p className="text-xs text-muted-foreground">{t.slug}</p>
                    </div>
                  ),
                },
                {
                  id: "status",
                  header: "Status",
                  cell: (t) => <TenantBadge status={t.status} />,
                },
                {
                  id: "budget",
                  header: "Monthly budget",
                  align: "end",
                  cell: (t) =>
                    compareMoney(t.quota.monthlyBudgetUsd, "0") === 0 ? (
                      "Unlimited"
                    ) : (
                      <Money value={t.quota.monthlyBudgetUsd} />
                    ),
                },
                {
                  id: "spend",
                  header: "Month spend",
                  align: "end",
                  cell: (t) => <Money value={t.monthSpendUsd} />,
                },
                {
                  id: "rpm",
                  header: "RPM",
                  align: "end",
                  cell: (t) => limit(t.quota.rpm),
                },
                {
                  id: "created",
                  header: "Created",
                  cell: (t) => (
                    <Timestamp
                      value={t.createdAt ?? undefined}
                      label="creation time"
                    />
                  ),
                },
              ]}
            />
          ) : (
            <Empty
              title={search || status ? "No matching tenants" : "No tenants"}
              body={
                search || status
                  ? "Try another name, slug or status."
                  : "Create a tenant to set request limits, track spend and issue API keys."
              }
              illustration={<UsersIcon className="size-6" />}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={search || status ? clear : query.refetch}
                >
                  {search || status ? "Clear filters" : "Refresh tenants"}
                </Button>
              }
            />
          )}
          <CursorPager
            shown={data.items.length}
            nextCursor={data.nextCursor}
            onNext={pager.next}
            onPrevious={pager.previous}
            canGoBack={pager.canGoBack}
            busy={query.loading}
          />
        </>
      )}
    </QueryBoundary>
  )
}
export function TenantsPage() {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("")
  const clear = () => {
    setSearch("")
    setStatus("")
  }
  return (
    <div className="space-y-3">
      <PageHeader
        title="Tenants"
        description="Customer limits and exact monthly spend."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          aria-label="Search tenants"
          placeholder="Search name or slug"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <NativeSelect
          aria-label="Tenant status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="suspended">Suspended</option>
        </NativeSelect>
      </div>
      <TenantRows
        key={`${search}:${status}`}
        search={search}
        status={status}
        clear={clear}
      />
    </div>
  )
}
