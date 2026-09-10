import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { SessionSummary } from "./sessions"

/** `sessions.detail`. SessionDetail embeds SessionSummary in Go, so the JSON is flat. */
export interface SessionDetail extends SessionSummary {
  appId?: string
  envId?: string
  orgId?: string
  deviceId?: string
  impersonatedBy?: string
  refreshTokenExpiresAt?: string
  principalKind?: string
  updatedAt?: string
}

export function AuthSessionDetailPage({ params }: PluginPageProps) {
  const sessionId = params.id
  if (!sessionId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No session selected.
      </p>
    )
  }
  return <SessionDetailBody sessionId={sessionId} />
}

function SessionDetailBody({ sessionId }: { sessionId: string }) {
  const query = useQuery<SessionDetail>("sessions.detail", { id: sessionId })

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Session" query={query} skeletonRows={3}>
        {(session) => (
          <>
            <PageHeader title="Session" description={session.id} />
            <DescriptionList
              items={[
                { term: "User", value: session.userId },
                // Impersonated-by is the thing an operator is looking for
                // when they open this page: a session somebody else is
                // driving. It sits high, not buried among timestamps.
                { term: "Impersonated by", value: session.impersonatedBy || "–" },
                { term: "IP", value: session.ipAddress || "–" },
                { term: "Agent", value: session.userAgent || "–" },
                { term: "App", value: session.appId || "–" },
                { term: "Environment", value: session.envId || "–" },
                { term: "Organisation", value: session.orgId || "–" },
                { term: "Device", value: session.deviceId || "–" },
                { term: "Principal kind", value: session.principalKind || "–" },
                { term: "Last activity", value: formatTimestamp(session.lastActivityAt) },
                { term: "Expires", value: formatTimestamp(session.expiresAt) },
                {
                  term: "Refresh token expires",
                  value: formatTimestamp(session.refreshTokenExpiresAt),
                },
                { term: "Created", value: formatTimestamp(session.createdAt) },
                { term: "Updated", value: formatTimestamp(session.updatedAt) },
              ]}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
