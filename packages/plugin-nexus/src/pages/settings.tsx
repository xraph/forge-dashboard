import { useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { count, Facts, limit, Refresh, yesNo } from "../components/read"
import type { Settings } from "../types"

export function SettingsPage() {
  const query = useQuery<Settings>("settings.get")
  return (
    <div className="space-y-3">
      <PageHeader
        title="Settings"
        description="Effective configuration. Change these values in your gateway deployment."
        actions={<Refresh onClick={query.refetch} />}
      />
      <QueryBoundary title="Settings" query={query}>
        {(data) => (
          <Facts
            items={[
              { label: "Base path", value: data.basePath },
              {
                label: "Default timeout",
                value: `${count(data.defaultTimeoutMs)} ms`,
              },
              {
                label: "Default retries",
                value: count(data.defaultMaxRetries),
              },
              {
                label: "Global rate limit",
                value: limit(data.globalRateLimit),
              },
              { label: "Usage collection", value: yesNo(data.usageEnabled) },
              { label: "Cache", value: yesNo(data.cacheEnabled) },
              {
                label: "API key required",
                value: data.requireApiKey ? "Yes" : "No",
              },
              {
                label: "Authentication scope",
                value: data.authenticationScope,
              },
              { label: "Log level", value: data.logLevel },
            ]}
          />
        )}
      </QueryBoundary>
    </div>
  )
}
