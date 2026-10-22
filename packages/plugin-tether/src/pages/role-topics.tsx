import { useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { TetherBoundary } from "../components/boundary"
import {
  CreateRoleDialog,
  DeleteRoleDialog,
  TopicsDialog,
} from "../components/role-dialogs"
import type { Role, RolesList } from "../types"

type Action = { kind: "topics" | "delete"; role: Role }

/**
 * The Roles & topics tab of a tenant. Tether owns the role lifecycle for its
 * tenants: roles are listed with their topic grants, created, deleted, and
 * their publish and subscribe filters edited.
 */
export function RolesPanel({ tenantId }: { tenantId: string }) {
  const query = useQuery<RolesList>("roles.list", { tenantId })
  const [creating, setCreating] = useState(false)
  const [action, setAction] = useState<Action | null>(null)

  const close = () => setAction(null)
  const forRole = (kind: Action["kind"]) =>
    action?.kind === kind ? action.role : null

  const columns: Column<Role>[] = [
    {
      id: "slug",
      header: "Slug",
      className: "font-medium",
      cell: (r) => <span className="font-mono text-xs">{r.slug}</span>,
    },
    { id: "name", header: "Name", cell: (r) => r.name },
    {
      id: "parent",
      header: "Parent",
      cell: (r) =>
        r.parentSlug ? (
          <span className="font-mono text-xs">{r.parentSlug}</span>
        ) : (
          <NoneCell label="parent" />
        ),
    },
    {
      id: "publish",
      header: "Publish",
      cell: (r) => <TagList values={r.publish ?? []} label="publish filters" />,
    },
    {
      id: "subscribe",
      header: "Subscribe",
      cell: (r) => (
        <TagList values={r.subscribe ?? []} label="subscribe filters" />
      ),
    },
  ]

  return (
    <>
      <Section
        aria-label="Role list"
        actions={<Button onClick={() => setCreating(true)}>New role</Button>}
      >
        <TetherBoundary title="Roles" query={query} skeletonRows={3}>
          {(data) => {
            const roles = data.items ?? []
            return (
              <ResourceTable<Role>
                columns={columns}
                rows={roles}
                rowKey={(r) => r.slug}
                caption={`${roles.length} ${roles.length === 1 ? "role" : "roles"}`}
                emptyMessage="No roles yet."
                rowActions={(r) => (
                  <>
                    <IconButton
                      label={`Edit topics of ${r.slug}`}
                      onClick={() => setAction({ kind: "topics", role: r })}
                    />
                    <IconButton
                      variant="destructive"
                      label={`Delete role ${r.slug}`}
                      onClick={() => setAction({ kind: "delete", role: r })}
                    />
                  </>
                )}
              />
            )
          }}
        </TetherBoundary>
      </Section>

      <CreateRoleDialog
        tenantId={tenantId}
        open={creating}
        roles={query.data?.items ?? []}
        onClose={() => setCreating(false)}
      />
      <TopicsDialog
        tenantId={tenantId}
        role={forRole("topics")}
        onClose={close}
      />
      <DeleteRoleDialog
        tenantId={tenantId}
        role={forRole("delete")}
        onClose={close}
      />
    </>
  )
}
