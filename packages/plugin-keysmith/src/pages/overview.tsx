import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import type { StatItem } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { KeyStateBadge, RotationReasonBadge } from "../badges"
import { KeyCell, WindowCell } from "../components/rotation-cells"
import { formatCount, keyPath, maskedKey } from "../format"
import type { KeySummary, Overview, RotationItem } from "../types"

// Nothing here may import the usage chart: this page is eager, and the chart
// would bring Recharts into the shell's entry chunk with it.

const NOT_RECORDED_HINT =
  "Usage appears once your application calls RecordUsage."

function stats(data: Overview): StatItem[] {
  const { counts } = data
  return [
    {
      label: "Active keys",
      value: formatCount(counts.active),
      hint: `${formatCount(counts.suspended)} suspended, ${formatCount(counts.revoked)} revoked, ${formatCount(counts.expired)} expired`,
    },
    { label: "Open grace windows", value: formatCount(data.openGraceWindows) },
    {
      label: "Expiring within 7 days",
      value: formatCount(data.expiringWithin7Days),
      // Colour is not the only cue: the card also says where to find them.
      ...(data.expiringWithin7Days > 0 && {
        tone: "danger",
        hint: "Shown as Expires soon on Keys.",
      }),
    },
    // null is a tenant that has never recorded usage. Showing 0 would read as
    // a quiet day, so it says so instead.
    data.requestsLast24h === null
      ? {
          label: "Requests in the last 24h",
          value: "Not recorded",
          hint: NOT_RECORDED_HINT,
        }
      : {
          label: "Requests in the last 24h",
          value: formatCount(data.requestsLast24h),
        },
  ]
}

const keyColumns: Column<KeySummary>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-medium",
    cell: (k) => <PluginLink to={keyPath(k.id)}>{k.name}</PluginLink>,
  },
  {
    id: "key",
    header: "Key",
    className: "font-mono text-xs",
    cell: (k) => maskedKey(k),
  },
  {
    id: "state",
    header: "State",
    cell: (k) => <KeyStateBadge summary={k} />,
  },
  {
    id: "created",
    header: "Created",
    cell: (k) => <Timestamp value={k.createdAt} label="creation time" />,
  },
]

const rotationColumns: Column<RotationItem>[] = [
  {
    id: "key",
    header: "Key",
    className: "font-medium",
    cell: (r) => <KeyCell item={r} />,
  },
  {
    id: "reason",
    header: "Reason",
    cell: (r) => <RotationReasonBadge reason={r.reason} />,
  },
  {
    id: "window",
    header: "Window",
    cell: (r) => <WindowCell item={r} />,
  },
  {
    id: "when",
    header: "When",
    cell: (r) => <Timestamp value={r.rotatedAt} label="rotation time" />,
  },
]

/** The "View all" link beside a section's title, to the full list. */
function ViewAll({ to, label }: { to: string; label: string }) {
  return (
    <PluginLink
      to={to}
      aria-label={label}
      className="text-sm underline underline-offset-4"
    >
      View all
    </PluginLink>
  )
}

function newest(n: number, noun: string): string | undefined {
  if (n === 0) return undefined
  return n === 1 ? `The newest ${noun}` : `The ${n} newest ${noun}s`
}

export const OverviewPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<Overview>("overview")

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Overview"
        description="Your keys, their rotation windows and the traffic they carry."
      />

      <QueryBoundary title="Overview" query={query} skeletonRows={4}>
        {(data) => {
          const keys = data.recentKeys ?? []
          const rotations = data.recentRotations ?? []
          return (
            <>
              <StatGrid items={stats(data)} />

              <Section
                title="Recent keys"
                actions={<ViewAll to="/keys" label="View all keys" />}
              >
                <ResourceTable<KeySummary>
                  columns={keyColumns}
                  rows={keys}
                  rowKey={(k) => k.id}
                  caption={newest(keys.length, "key")}
                  emptyMessage="No keys yet."
                />
              </Section>

              <Section
                title="Recent rotations"
                actions={<ViewAll to="/rotations" label="View all rotations" />}
              >
                <ResourceTable<RotationItem>
                  columns={rotationColumns}
                  rows={rotations}
                  rowKey={(r) => r.id}
                  caption={newest(rotations.length, "rotation")}
                  emptyMessage="No rotations yet."
                />
              </Section>

              <p className="text-sm">
                <PluginLink
                  to="/settings"
                  className="underline underline-offset-4"
                >
                  {`This deployment enforces ${data.enforcedFields} of ${data.policyFields} policy fields.`}
                </PluginLink>
              </p>
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
