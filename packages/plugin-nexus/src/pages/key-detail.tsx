import {
  PluginLink,
  useQuery,
  type PluginPageProps,
} from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { KeyBadge } from "../badges"
import { Empty, Facts, Refresh, Section } from "../components/read"
import { tenantPath, validID } from "../format"
import type { APIKey } from "../types"

export function KeyDetailPage({ params }: PluginPageProps) {
  const valid = validID(params.id, "key")
  const query = useQuery<APIKey>(
    "keys.get",
    { id: params.id },
    { enabled: valid }
  )
  if (!valid)
    return (
      <Empty
        title="Invalid key address"
        body="Choose an API key from the key list."
        action={<PluginLink to="/keys">View keys</PluginLink>}
      />
    )
  if (query.error?.code === "NOT_FOUND")
    return (
      <Empty
        title="Key not found"
        body="This key is no longer available. Choose another key."
        action={<PluginLink to="/keys">View keys</PluginLink>}
      />
    )
  return (
    <div className="space-y-3">
      <PageHeader
        title={query.data?.name ?? "API key"}
        description={params.id}
        actions={<Refresh onClick={query.refetch} />}
      />
      <QueryBoundary title="API key" query={query}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <KeyBadge status={data.status} />
              <code className="text-sm">{data.prefix}…</code>
            </div>
            <Facts
              items={[
                {
                  label: "Tenant",
                  value: (
                    <PluginLink to={tenantPath(data.tenantId)}>
                      {data.tenantName}
                    </PluginLink>
                  ),
                },
                { label: "Scopes", value: data.scopes.join(", ") },
                {
                  label: "Created",
                  value: (
                    <Timestamp
                      value={data.createdAt ?? undefined}
                      label="creation time"
                    />
                  ),
                },
                {
                  label: "Expires",
                  value: (
                    <Timestamp
                      value={data.expiresAt ?? undefined}
                      label="expiry"
                    />
                  ),
                },
                {
                  label: "Last used",
                  value: (
                    <Timestamp
                      value={data.lastUsedAt ?? undefined}
                      label="last use"
                    />
                  ),
                },
              ]}
            />
            <Section title="Metadata">
              {Object.keys(data.metadata ?? {}).length ? (
                <Facts
                  items={Object.entries(data.metadata!).map(
                    ([label, value]) => ({ label, value })
                  )}
                />
              ) : (
                <Empty
                  title="No key metadata"
                  body="This key has no attached metadata."
                  action={<Refresh onClick={query.refetch} />}
                />
              )}
            </Section>
            <PluginLink
              to={`/@nexus/usage/records?tenantId=${encodeURIComponent(data.tenantId)}&keyId=${encodeURIComponent(data.id)}`}
            >
              View request history
            </PluginLink>
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
