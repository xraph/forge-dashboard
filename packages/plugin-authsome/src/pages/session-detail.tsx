import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
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
                {
                  term: "Impersonated by",
                  value: session.impersonatedBy || <NoneCell label="impersonation" />,
                },
                { term: "IP", value: session.ipAddress || <NoneCell label="ip address" /> },
                { term: "Agent", value: session.userAgent || <NoneCell label="user agent" /> },
                { term: "App", value: session.appId || <NoneCell label="app" /> },
                { term: "Environment", value: session.envId || <NoneCell label="environment" /> },
                {
                  term: "Organisation",
                  value: session.orgId || <NoneCell label="organisation" />,
                },
                { term: "Device", value: session.deviceId || <NoneCell label="device" /> },
                {
                  term: "Principal kind",
                  value: session.principalKind || <NoneCell label="principal kind" />,
                },
                {
                  term: "Last activity",
                  value: <Timestamp value={session.lastActivityAt} label="last activity" />,
                },
                { term: "Expires", value: formatTimestamp(session.expiresAt) },
                {
                  term: "Refresh token expires",
                  value: (
                    <Timestamp
                      value={session.refreshTokenExpiresAt}
                      label="refresh token expiry"
                    />
                  ),
                },
                { term: "Created", value: formatTimestamp(session.createdAt) },
                {
                  term: "Updated",
                  value: <Timestamp value={session.updatedAt} label="last update" />,
                },
              ]}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
