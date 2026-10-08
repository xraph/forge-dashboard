import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { KeyRoundIcon } from "@forge-go/dashboard-kit/icons"
import { KeyBadge } from "../badges"
import { keyPath, tenantPath } from "../format"
import type { APIKey, Page } from "../types"
import { CursorPager, useCursorStack } from "./cursor-pager"
import { Empty, Refresh } from "./read"
import { tenantParams } from "./tenant-filter"
import { KeyScopes } from "./key-scopes"

export const keyColumns: Column<APIKey>[] = [
  {
    id: "name",
    header: "Name / prefix",
    cell: (k) => (
      <div>
        <PluginLink to={keyPath(k.id)}>{k.name}</PluginLink>
        <p className="font-mono text-xs text-muted-foreground">{k.prefix}…</p>
      </div>
    ),
  },
  {
    id: "tenant",
    header: "Tenant",
    cell: (k) => (
      <PluginLink to={tenantPath(k.tenantId)}>{k.tenantName}</PluginLink>
    ),
  },
  {
    id: "scopes",
    header: "Scopes",
    cell: (k) => <KeyScopes scopes={k.scopes} />,
  },
  {
    id: "status",
    header: "Status",
    cell: (k) => <KeyBadge status={k.status} />,
  },
  {
    id: "expiry",
    header: "Expires",
    cell: (k) =>
      k.expiresAt ? <Timestamp value={k.expiresAt} label="expiry" /> : "Never",
  },
  {
    id: "used",
    header: "Last used",
    cell: (k) =>
      k.lastUsedAt ? (
        <Timestamp value={k.lastUsedAt} label="last use" />
      ) : (
        "Never"
      ),
  },
]

export function KeyList({
  tenantId,
  status = "",
  onClear,
}: {
  tenantId?: string
  status?: string
  onClear?: () => void
}) {
  const pager = useCursorStack()
  const query = useQuery<Page<APIKey>>("keys.list", {
    ...tenantParams(tenantId),
    ...(status ? { status } : {}),
    ...(pager.cursor ? { cursor: pager.cursor } : {}),
    limit: 25,
  })
  return (
    <QueryBoundary title="API keys" query={query}>
      {(data) => (
        <>
          {data.items.length ? (
            <ResourceTable
              density="compact"
              rows={data.items}
              rowKey={(k) => k.id}
              columns={keyColumns}
              emptyMessage="No API keys"
            />
          ) : (
            <Empty
              title={
                status || tenantId ? "No matching API keys" : "No API keys"
              }
              body={
                status || tenantId
                  ? "No keys match this tenant and status. Adjust your filters or refresh."
                  : "Create an API key for a tenant to give an application access to the gateway."
              }
              illustration={<KeyRoundIcon className="size-6" />}
              action={
                onClear ? (
                  <IconButton
                    variant="outline"
                    onClick={onClear}
                    label="Clear filters"
                  />
                ) : (
                  <Refresh onClick={query.refetch} />
                )
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
