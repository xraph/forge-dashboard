import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState, useSyncExternalStore } from "react"
import {
  PluginLink,
  queryStore,
  usePluginClient,
  useQuery,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { NativeSelect } from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { OutcomeBadge } from "../badges"
import { KeyFilter } from "../components/key-filter"
import { Money } from "../components/money"
import { count, Empty, Refresh, UsageOff } from "../components/read"
import { TenantFilter, tenantParams } from "../components/tenant-filter"
import { keyPath, tenantPath, validID } from "../format"
import type { UsageRecords } from "../types"

type Filters = {
  tenantId?: string
  keyId?: string
  provider?: string
  model?: string
  outcome?: string
  from?: string
  to?: string
}
const subscribe = (change: () => void) => {
  window.addEventListener("popstate", change)
  return () => window.removeEventListener("popstate", change)
}
const readSearch = () => window.location.search

function RecordRows({
  filters,
  clear,
}: {
  filters: Filters
  clear: () => void
}) {
  const client = usePluginClient()
  const [cursor, setCursor] = useState<string>()
  const paramsFor = (pageCursor?: string) => ({
    ...filters,
    ...(pageCursor ? { cursor: pageCursor } : {}),
    limit: 25,
  })
  const query = useQuery<UsageRecords>("usage.records", paramsFor(cursor))
  const [pages, setPages] = useState<Record<string, UsageRecords>>({})
  const pageKey = cursor ?? "first"
  // An invalidation drops unwatched pages. Restart at the first page instead
  // of combining their detached rows with a refreshed later page.
  const forgotten = Object.entries(pages).some(([key, page]) => {
    const storeKey = queryStore.keyOf(
      client.extension,
      "usage.records",
      paramsFor(key === "first" ? undefined : key)
    )
    const cached = queryStore.snapshot<UsageRecords>(storeKey).data
    return key === pageKey ? cached === undefined : cached !== page
  })
  if (forgotten) {
    setCursor(undefined)
    setPages({})
  } else if (
    query.data &&
    !query.loading &&
    !query.error &&
    pages[pageKey] !== query.data
  )
    setPages({ ...pages, [pageKey]: query.data })
  const items = [
    ...new Map(
      Object.values(pages)
        .flatMap((page) => page.items)
        .map((row) => [row.id, row])
    ).values(),
  ]
  const data = query.data ?? pages[pageKey] ?? Object.values(pages).at(-1)
  return (
    <QueryBoundary
      title="Request log"
      query={{ ...query, data }}
      keepPreviousData
    >
      {(value) =>
        !value.usageEnabled ? (
          <UsageOff />
        ) : (
          <>
            {items.length ? (
              <ResourceTable
                density="compact"
                rows={items}
                rowKey={(r) => r.id}
                emptyMessage="No requests"
                columns={[
                  {
                    id: "time",
                    header: "Time / request",
                    cell: (r) => (
                      <div>
                        <Timestamp
                          value={r.createdAt ?? undefined}
                          label="request time"
                        />
                        <p className="font-mono text-xs text-muted-foreground">
                          {r.requestId ?? "Request ID unavailable"}
                        </p>
                      </div>
                    ),
                  },
                  {
                    id: "tenant",
                    header: "Tenant / key",
                    cell: (r) => (
                      <div>
                        {r.tenantId ? (
                          <PluginLink to={tenantPath(r.tenantId)}>
                            {r.tenantName ?? r.tenantId}
                          </PluginLink>
                        ) : (
                          "Unattributed"
                        )}
                        {r.keyId && (
                          <p className="font-mono text-xs">
                            <PluginLink to={keyPath(r.keyId)}>
                              {r.keyPrefix ? `${r.keyPrefix}…` : r.keyId}
                            </PluginLink>
                          </p>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: "model",
                    header: "Provider / model",
                    cell: (r) => (
                      <div>
                        {r.provider || "None"}
                        <p className="text-xs text-muted-foreground">
                          {r.model || "None"}
                        </p>
                      </div>
                    ),
                  },
                  {
                    id: "tokens",
                    header: "Tokens",
                    align: "end",
                    cell: (r) => (
                      <span
                        title={`${r.promptTokens} prompt, ${r.completionTokens} completion`}
                      >
                        {count(r.totalTokens)}
                      </span>
                    ),
                  },
                  {
                    id: "cost",
                    header: "Cost",
                    align: "end",
                    cell: (r) => (
                      <div>
                        <Money value={r.costUsd} unavailable="Unknown cost" />
                        {r.costUsd === null && (
                          <p className="text-xs text-muted-foreground">
                            {r.pricingStatus.replaceAll("_", " ")}
                          </p>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: "latency",
                    header: "Latency",
                    align: "end",
                    cell: (r) => `${count(r.latencyMs)} ms`,
                  },
                  {
                    id: "outcome",
                    header: "Outcome",
                    cell: (r) => (
                      <div>
                        <OutcomeBadge outcome={r.outcome} />
                        <p className="text-xs text-muted-foreground">
                          {r.blockedBy ||
                            r.refusalCode ||
                            (r.statusCode >= 400 ? `HTTP ${r.statusCode}` : "")}
                        </p>
                      </div>
                    ),
                  },
                ]}
              />
            ) : (
              <Empty
                title={
                  Object.keys(filters).length
                    ? "No matching requests"
                    : "No requests recorded"
                }
                body={
                  Object.keys(filters).length
                    ? "Adjust the tenant, key, outcome or time range."
                    : "Send a request through the gateway to see its cost and outcome here."
                }
                action={
                  <IconButton
                    variant="outline"
                    onClick={
                      Object.keys(filters).length ? clear : query.refetch
                    }
                    label={
                      Object.keys(filters).length
                        ? "Clear filters"
                        : "Refresh requests"
                    }
                  />
                }
              />
            )}
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{items.length} requests shown</span>
              {value.nextCursor && (
                <IconButton
                  variant="outline"
                  disabled={query.loading}
                  onClick={() => setCursor(value.nextCursor)}
                  label="Load more requests"
                />
              )}
            </div>
          </>
        )
      }
    </QueryBoundary>
  )
}

function RecordsFilterPage({ search }: { search: string }) {
  const incoming = new URLSearchParams(search)
  const [tenantId, setTenantId] = useState<string | undefined>(
    () => incoming.get("tenantId") ?? undefined
  )
  const [keyId, setKeyId] = useState<string | undefined>(
    () => incoming.get("keyId") ?? undefined
  )
  const [outcome, setOutcome] = useState("")
  const [draft, setDraft] = useState({
    provider: "",
    model: "",
    from: "",
    to: "",
  })
  const [applied, setApplied] = useState<Filters>({})
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const filters = {
    ...tenantParams(tenantId),
    ...(keyId !== undefined ? { keyId } : {}),
    ...(outcome ? { outcome } : {}),
    ...applied,
  }
  const invalid =
    (tenantId !== undefined && !validID(tenantId, "tenant")) ||
    (keyId !== undefined && !validID(keyId, "key"))
  const clear = () => {
    setTenantId(undefined)
    setKeyId(undefined)
    setOutcome("")
    setDraft({ provider: "", model: "", from: "", to: "" })
    setApplied({})
    setError("")
  }
  if (invalid)
    return (
      <Empty
        title="Invalid request-log scope"
        body="The address includes an invalid tenant or key. Clear the filters to choose a valid scope."
        action={
          <IconButton variant="outline" onClick={clear} label="Clear filters" />
        }
      />
    )
  const apply = () => {
    const from = draft.from ? new Date(draft.from) : undefined,
      to = draft.to ? new Date(draft.to) : undefined
    if (
      (from && !Number.isFinite(from.getTime())) ||
      (to && !Number.isFinite(to.getTime())) ||
      (from && to && to <= from)
    ) {
      setError("Choose valid times with To after From.")
      return
    }
    setError("")
    setApplied({
      ...(draft.provider.trim() ? { provider: draft.provider.trim() } : {}),
      ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
      ...(from ? { from: from.toISOString() } : {}),
      ...(to ? { to: to.toISOString() } : {}),
    })
  }
  return (
    <div className="space-y-3">
      <PageHeader
        title="Request log"
        description="Priced and unpriced requests, refusal reasons and provider outcomes."
        actions={<Refresh onClick={() => setRevision((n) => n + 1)} />}
      />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <TenantFilter
          value={tenantId}
          onChange={(id) => {
            setTenantId(id)
            setKeyId(undefined)
          }}
        />
        <KeyFilter value={keyId} tenantId={tenantId} onChange={setKeyId} />
        <NativeSelect
          aria-label="Outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
        >
          <option value="">All outcomes</option>
          {["ok", "cached", "blocked", "refused", "error"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
        <Input
          className="w-36"
          aria-label="Provider"
          placeholder="Provider"
          value={draft.provider}
          onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
        />
        <Input
          className="w-36"
          aria-label="Model"
          placeholder="Model"
          value={draft.model}
          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
        />
        <label className="space-y-1 text-xs text-muted-foreground">
          From (local time)
          <Input
            type="datetime-local"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          To (local time)
          <Input
            type="datetime-local"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Apply filters
        </Button>
        {Object.keys(filters).length > 0 && (
          <IconButton
            type="button"
            variant="ghost"
            onClick={clear}
            label="Clear filters"
          />
        )}
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <RecordRows
        key={`${JSON.stringify(filters)}:${revision}`}
        filters={filters}
        clear={clear}
      />
    </div>
  )
}
export function RecordsPage() {
  const search = useSyncExternalStore(subscribe, readSearch, () => "")
  return <RecordsFilterPage key={search} search={search} />
}
