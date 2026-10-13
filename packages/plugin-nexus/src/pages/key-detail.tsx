import {
  PluginLink,
  useQuery,
  type PluginPageProps,
} from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { KeyBadge } from "../badges"
import { KeyActions } from "../components/key-actions"
import { KeyScopes } from "../components/key-scopes"
import { Empty, Facts, Refresh } from "../components/read"
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
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title={query.data?.name ?? "API key"}
        description={params.id}
        meta={
          query.data ? (
            <>
              <KeyBadge status={query.data.status} />
              <code className="text-sm">{query.data.prefix}…</code>
            </>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-1">
            <Refresh onClick={query.refetch} />
            <KeyActions key={params.id} apiKey={query.data} />
          </div>
        }
      />
      <QueryBoundary title="API key" query={query}>
        {(data) => (
          <>
            <Section title="Details" inset>
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
                  {
                    label: "Scopes",
                    value: <KeyScopes scopes={data.scopes} />,
                  },
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
                    value: data.expiresAt ? (
                      <Timestamp value={data.expiresAt} label="expiry" />
                    ) : (
                      "Never"
                    ),
                  },
                  {
                    label: "Last used",
                    value: data.lastUsedAt ? (
                      <Timestamp value={data.lastUsedAt} label="last use" />
                    ) : (
                      "Never"
                    ),
                  },
                ]}
              />
            </Section>
            <Section
              title="Metadata"
              inset={Object.keys(data.metadata ?? {}).length > 0}
            >
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
