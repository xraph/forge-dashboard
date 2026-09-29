import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PolicyStatusBadge, RotatorBadge } from "../badges"
import { formatInterval } from "../interval"
import { rotationPath } from "../keys"

/** Mirrors the Go `RotationPolicySummary`. Field names are its JSON tags. */
export interface RotationPolicy {
  id: string
  secretKey: string
  intervalSeconds: number
  enabled: boolean
  /** Whether an application registered a rotator for this key. */
  rotatable: boolean
  lastRotatedAt?: string
  /** The server omits it when the policy is disabled. */
  nextRotationAt?: string
  createdAt: string
  updatedAt: string
}

/** Mirrors the Go `rotationPoliciesResponse`. */
interface PoliciesList {
  policies: RotationPolicy[] | null
  total: number
}

const PAGE_SIZE = 25

const columns: Column<RotationPolicy>[] = [
  {
    id: "secret",
    header: "Secret",
    className: "font-mono text-xs font-medium",
    cell: (p) => <PluginLink to={rotationPath(p.secretKey)}>{p.secretKey}</PluginLink>,
  },
  {
    id: "interval",
    header: "Interval",
    cell: (p) => `every ${formatInterval(p.intervalSeconds)}`,
  },
  {
    id: "status",
    header: "Status",
    cell: (p) => <PolicyStatusBadge enabled={p.enabled} />,
  },
  {
    id: "rotator",
    header: "Rotator",
    cell: (p) => <RotatorBadge rotatable={p.rotatable} />,
  },
  {
    id: "next",
    header: "Next rotation",
    // A disabled policy never rotates, so no time is shown for it whatever
    // the payload carries. Not trusting the server to omit it is the point.
    cell: (p) => (
      <Timestamp value={p.enabled ? p.nextRotationAt : undefined} label="next rotation" />
    ),
  },
  {
    id: "last",
    header: "Last rotated",
    cell: (p) => <Timestamp value={p.lastRotatedAt} label="last rotation" />,
  },
]

export const RotationPage: ComponentType<PluginPageProps> = () => {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)

  const list = useQuery<PoliciesList>("rotation.policies", {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Rotation"
        description="Due policies are checked once a minute in each vault process. A policy only rotates a secret whose application registered a rotator."
      />

      <QueryBoundary title="Rotation policies" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.policies ?? []
          // The server's total, never the page length.
          const caption = `${data.total} ${data.total === 1 ? "policy" : "policies"}`
          return (
            <ResourceTable<RotationPolicy>
              columns={columns}
              rows={rows}
              rowKey={(p) => p.id}
              caption={caption}
              emptyMessage="No rotation policies. Set one up from a secret's page."
              pagination={{ page, pageSize: PAGE_SIZE, total: data.total }}
              onPageChange={setPage}
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
