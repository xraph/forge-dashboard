import type { ComponentType, ReactNode } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  ApplicationGroupLine,
  ENFORCEMENT_GROUPS,
  KEYSMITH_GROUP_LINE,
  rateLimiterLine,
} from "../enforcement"
import type { EnforcementGroupId } from "../enforcement"
import { formatDuration } from "../format"
import type { EnforcementRow, Settings, TenantSource } from "../types"

const TENANT_CONFIG_KEY = "extensions.keysmith.dashboard.tenant_id"

/** A heading and what sits under it, as a labelled region. */
function Section({
  id,
  title,
  level = 2,
  mono = false,
  children,
}: {
  id: string
  title: string
  level?: 2 | 3
  /** The title is an identifier, such as a group this page does not know. */
  mono?: boolean
  children: ReactNode
}) {
  const headingId = `keysmith-settings-${id}`
  const Heading = level === 2 ? "h2" : "h3"
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <Heading
        id={headingId}
        className={cn("text-sm font-medium", mono && "font-mono text-xs")}
      >
        {title}
      </Heading>
      {children}
    </section>
  )
}

function Line({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

/**
 * Where the tenant came from, one sentence per source. The order is
 * tenantFrom's: a claim wins, then the session's org, then the config key.
 * Anything else gets the config sentence.
 */
function TenantSourceLine({ source }: { source: TenantSource }) {
  switch (source) {
    case "claim":
      return "Taken from the tenant claim your session carries."
    case "scope":
      return "Taken from your session's organization."
    // A source a newer server added reads as config, the fallback it was
    // before "scope" existed.
    case "config":
    default:
      return (
        <>
          Taken from{" "}
          <span className="font-mono text-xs text-foreground">
            {TENANT_CONFIG_KEY}
          </span>{" "}
          in the server's configuration.
        </>
      )
  }
}

/** "when a key is created" as a table cell reads it: "When a key is created". */
function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const columns: Column<EnforcementRow>[] = [
  { id: "field", header: "Field", className: "font-medium", cell: (r) => r.label },
  { id: "enforced", header: "Enforced", cell: (r) => (r.enforced ? "Yes" : "No") },
  {
    id: "when",
    header: "When",
    // Nothing checks a field that is not enforced, so there is no when.
    cell: (r) =>
      r.enforced && r.when !== "" ? (
        sentenceCase(r.when)
      ) : (
        <NoneCell label="check here" />
      ),
  },
]

/** The group's line, worded as the policy editor words it. */
function groupLine(id: EnforcementGroupId, limiter: boolean): ReactNode {
  switch (id) {
    case "keysmith":
      return KEYSMITH_GROUP_LINE
    case "rateLimiter":
      return rateLimiterLine(limiter)
    case "application":
      return <ApplicationGroupLine />
  }
}

function enforcedCaption(rows: EnforcementRow[]): string {
  const n = rows.filter((r) => r.enforced).length
  return `${n} of ${rows.length} ${rows.length === 1 ? "field" : "fields"} enforced here`
}

/**
 * The enforcement table, split under the policy editor's three headings in
 * its order. The rows are the server's, in its order: this page only sorts
 * them into groups. A row in a group this page does not know is shown under
 * that group's own name after the three, never dropped.
 */
function Enforcement({ data }: { data: Settings }) {
  const rows = data.enforcement ?? []
  const known = new Set<string>(ENFORCEMENT_GROUPS.map((g) => g.id))
  const unknown = [
    ...new Set(rows.map((r) => r.group).filter((g) => !known.has(g))),
  ]
  const table = (groupRows: EnforcementRow[]) => (
    <ResourceTable<EnforcementRow>
      columns={columns}
      rows={groupRows}
      rowKey={(r) => r.field}
      caption={enforcedCaption(groupRows)}
      emptyMessage="No fields in this group."
    />
  )

  return (
    <Section id="enforcement" title="Policy enforcement">
      <Line>
        {`This deployment enforces ${data.enforcedFields} of ${rows.length} policy fields.`}
      </Line>
      <div className="flex flex-col gap-6">
        {ENFORCEMENT_GROUPS.map((g) => (
          <Section key={g.id} id={`group-${g.id}`} title={g.heading} level={3}>
            <Line>{groupLine(g.id, data.rateLimiterConfigured)}</Line>
            {table(rows.filter((r) => r.group === g.id))}
          </Section>
        ))}
        {unknown.map((group, i) => (
          <Section
            key={group}
            id={`group-other-${i}`}
            title={group}
            level={3}
            mono
          >
            {table(rows.filter((r) => r.group === group))}
          </Section>
        ))}
      </div>
    </Section>
  )
}

function SettingsView({ data }: { data: Settings }) {
  const plugins = data.plugins ?? []
  return (
    <>
      <div className="grid gap-6 @3xl/main:grid-cols-2">
        <Section id="store" title="Store">
          <div>
            {data.storeHealthy ? (
              <Badge variant="outline">Healthy</Badge>
            ) : (
              <Badge variant="destructive">Not answering</Badge>
            )}
          </div>
          <Line>{data.storeMessage}</Line>
        </Section>

        <Section id="rate-limiter" title="Rate limiter">
          <div>
            {data.rateLimiterConfigured ? (
              <Badge variant="outline">Configured</Badge>
            ) : (
              <Badge variant="secondary">Not configured</Badge>
            )}
          </div>
          <Line>
            {data.rateLimiterConfigured
              ? "Keysmith enforces a policy's Rate limit and Window when a key is validated."
              : "A policy's Rate limit and Window are stored, but not enforced here."}
          </Line>
        </Section>

        <Section id="tenant" title="Tenant">
          <span className="font-mono text-xs">{data.tenant}</span>
          <Line>
            <TenantSourceLine source={data.tenantSource} />
          </Line>
        </Section>

        <Section id="default-grace" title="Default grace">
          {/* Capped at hours: the editor and the policy page say "24 hours". */}
          <span className="text-sm">
            {formatDuration(data.defaultGraceSeconds, "hour")}
          </span>
          <Line>
            What a rotation gets when neither it nor the key's policy names a
            grace.
          </Line>
        </Section>

        <Section id="plugins" title="Plugins">
          {plugins.length === 0 ? (
            <Line>No hook plugins registered.</Line>
          ) : (
            <TagList values={plugins} label="plugins" />
          )}
        </Section>
      </div>

      <Enforcement data={data} />
    </>
  )
}

/**
 * What this deployment runs with, read-only: whether the store answers,
 * whether a rate limiter is configured, where the tenant comes from, the
 * default grace, the hook plugins, and which policy fields are enforced.
 * Nothing here can be changed from the dashboard; it all comes from the
 * server's configuration.
 */
export const SettingsPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<Settings>("settings")

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="What this deployment runs with. These come from the server's configuration and cannot be changed here."
      />

      <QueryBoundary title="Settings" query={query} skeletonRows={5}>
        {(data) => <SettingsView data={data} />}
      </QueryBoundary>
    </section>
  )
}
