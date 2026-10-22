import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { Section } from "@forge-go/dashboard-kit/components/section"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@forge-go/dashboard-kit/components/tabs"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { TetherBoundary } from "../components/boundary"
import { ClientsPanel } from "./clients"
import { DevicesPanel } from "./devices"
import { RolesPanel } from "./role-topics"
import { Counters } from "../components/counters"
import { formatCount, formatSeconds, tenantLabel } from "../format"
import { useSession } from "../session"
import type { Limits, Stats, Tenant } from "../types"

const POLL_MS = 10_000

/** The panels under the header, each a view of this tenant. */
const TABS: {
  value: string
  label: string
  Panel: ComponentType<{ tenantId: string }>
}[] = [
  { value: "devices", label: "Devices", Panel: DevicesPanel },
  { value: "roles", label: "Roles & topics", Panel: RolesPanel },
  { value: "clients", label: "Clients", Panel: ClientsPanel },
]

const ID = ({ children }: { children: string }) => (
  <span className="font-mono text-xs">{children}</span>
)

/** A limit of 0 is the broker's default, or unlimited. Say so. */
function limit(value: number, format: (n: number) => string): string {
  return value === 0 ? "Default" : format(value)
}

function details(tenant: Tenant, limits: Limits = tenant.limits) {
  return [
    { term: "Tenant ID", value: <ID>{tenant.id}</ID> },
    { term: "App ID", value: <ID>{tenant.appId}</ID> },
    { term: "External ID", value: <ID>{tenant.externalId}</ID> },
    {
      term: "State",
      value: (
        <Badge variant={tenant.enabled ? "outline" : "secondary"}>
          {tenant.enabled ? "enabled" : "disabled"}
        </Badge>
      ),
    },
    {
      term: "Max connections",
      value: limit(limits.maxConnections, formatCount),
    },
    {
      term: "Messages per second",
      value: limit(limits.messagesPerSecond, (n) => `${formatCount(n)} / s`),
    },
    { term: "Burst", value: limit(limits.burst, formatCount) },
    {
      term: "Max session expiry",
      value: limit(limits.maxSessionExpirySeconds, formatSeconds),
    },
    { term: "Max sessions", value: limit(limits.maxSessions, formatCount) },
    {
      term: "Created",
      value: <Timestamp value={tenant.createdAt} label="creation time" />,
    },
    {
      term: "Updated",
      value: <Timestamp value={tenant.updatedAt} label="update time" />,
    },
  ]
}

export const TenantDetailPage: ComponentType<PluginPageProps> = ({
  params,
}) => <TenantDetail tenantId={params.tenantId ?? ""} />

/**
 * One tenant: its record, live counters and tabs. It is also what a tenant
 * user gets at `/` and at `/tenants`, so the link back to the tenant list is
 * only drawn for an operator, the one caller who can read that list.
 */
export function TenantDetail({ tenantId }: { tenantId: string }) {
  const session = useSession()
  const tenant = useQuery<Tenant>("tenants.get", { tenantId })
  const stats = useQuery<Stats>("overview.stats", { tenantId })
  usePoll(stats.refetch, POLL_MS)

  return (
    <section className="flex min-w-0 flex-col gap-4">
      {session.data?.operator && (
        <p className="text-sm">
          <PluginLink to="/tenants" className="underline underline-offset-4">
            All tenants
          </PluginLink>
        </p>
      )}
      <PageHeader
        title={tenant.data ? tenantLabel(tenant.data) : "Tenant"}
        description="Limits and live counters for this tenant."
      />

      {/*
        Two reads, two boundaries: the broker being down fails the counters
        and must not take the tenant record with it.
      */}
      <Section title="Details" inset>
        <TetherBoundary title="Tenant" query={tenant} skeletonRows={4}>
          {(t) => <DescriptionList items={details(t)} />}
        </TetherBoundary>
      </Section>

      <Section title="Live counters">
        <TetherBoundary
          title="Counters"
          query={stats}
          skeletonRows={2}
          keepPreviousData
        >
          {(s) => <Counters stats={s} />}
        </TetherBoundary>
      </Section>

      <Tabs defaultValue="devices">
        <TabsList variant="line">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {/*
          Base UI mounts only the selected panel, so the roles and clients
          reads, and the clients poll, start when their tab is opened.
        */}
        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.Panel tenantId={tenantId} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  )
}
