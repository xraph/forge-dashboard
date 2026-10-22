import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { TetherBoundary } from "../components/boundary"
import { Counters } from "../components/counters"
import { SessionGate } from "../session"
import type { Stats } from "../types"
import { TenantDetail } from "./tenant-detail"

/** Counters move continuously; ten seconds keeps them live and cheap. */
const POLL_MS = 10_000

const DESCRIPTION = "What this node is carrying right now, across every tenant."

/**
 * The plugin's landing page. An operator gets the node's totals; a tenant
 * user, who has one tenant and no node to look at, gets that tenant's page.
 */
export const OverviewPage: ComponentType<PluginPageProps> = () => (
  <SessionGate title="Overview" description={DESCRIPTION}>
    {(session) =>
      session.operator ? (
        <NodeOverview />
      ) : (
        <TenantDetail tenantId={session.tenantId ?? ""} />
      )
    }
  </SessionGate>
)

/**
 * The node's totals. `overview.stats` without a `tenantId` is, for an
 * operator, the sum over every tenant on this node, never rows.
 */
function NodeOverview() {
  const query = useQuery<Stats>("overview.stats")
  usePoll(query.refetch, POLL_MS)

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader title="Overview" description={DESCRIPTION} />
      {/*
        keepPreviousData: the poll refetches on a timer, and a skeleton every
        ten seconds would make the page flicker instead of tick.
      */}
      <TetherBoundary
        title="Overview"
        query={query}
        skeletonRows={3}
        keepPreviousData
      >
        {(stats) => (
          <>
            <Counters stats={stats} />
            <p className="text-sm">
              <PluginLink
                to="/tenants"
                className="underline underline-offset-4"
              >
                Manage tenants
              </PluginLink>
            </p>
          </>
        )}
      </TetherBoundary>
    </section>
  )
}
