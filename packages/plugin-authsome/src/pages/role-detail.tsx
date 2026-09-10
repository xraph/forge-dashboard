import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { AckResponse } from "./users"
// Type-only: erased at compile time, so this does not create a runtime
// import cycle with `roles.tsx`, which re-exports `AuthRoleDetailPage` from
// this file.
import type { PermissionRecord, RoleDetail } from "./roles"

/**
 * An identifier-shaped value gets the same monospace treatment the tables
 * use. `label` names what there is none of - "parent role", "app" - so an
 * absent Parent and an absent Environment announce differently to a screen
 * reader instead of both reading back the same bare "None".
 */
function IdCell({ value, label }: { value?: string; label: string }) {
  return value ? <span className="font-mono text-xs">{value}</span> : <NoneCell label={label} />
}

const permissionColumns: Column<PermissionRecord>[] = [
  { id: "action", header: "Action", cell: (p) => p.action },
  { id: "resource", header: "Resource", cell: (p) => p.resource },
]

function EditRole({ role }: { role: RoleDetail }) {
  const update = useCommand<AckResponse>("roles.update")
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? "")

  // `roles.update` takes pointers precisely so "leave unchanged" is
  // distinguishable from "set to empty". A field the operator did not touch
  // must be absent from the payload, not sent as "" - that is why an
  // untouched description never appears in `changed` below, and it is what
  // the pointer-semantics test in roles.test.tsx pins.
  const changed: Record<string, unknown> = { id: role.id }
  if (name !== role.name) changed.name = name
  if (description !== (role.description ?? "")) changed.description = description
  const dirty = Object.keys(changed).length > 1

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Edit</h2>
      <CommandAlert error={update.error} title="Could not save" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-edit-name">Name</Label>
        <Input id="role-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-edit-description">Description</Label>
        <Input
          id="role-edit-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <Button onClick={() => void update.execute(changed)} disabled={update.loading || !dirty}>
        {update.loading ? "Saving…" : "Save changes"}
      </Button>
    </div>
  )
}

/**
 * Attaches a role to a principal.
 *
 * `AssignRoleInput`, from `authsome/extension/contract/handlers_roles.go`:
 * `{ userId: string, roleId: string }` (JSON tags `userId`/`roleId`). Sending
 * anything else is a command that answers ok and changes nothing.
 */
function AssignRole({ roleId }: { roleId: string }) {
  const assign = useCommand<AckResponse>("roles.assign")
  const [userId, setUserId] = useState("")

  async function submit() {
    const result = await assign.execute({ userId, roleId })
    if (result === undefined) return
    setUserId("")
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Assign to a user</h2>
      <CommandAlert error={assign.error} title="Could not assign" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-assign-user">User ID</Label>
        <Input
          id="role-assign-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
      </div>
      <Button onClick={() => void submit()} disabled={assign.loading || userId.trim() === ""}>
        {assign.loading ? "Assigning…" : "Assign"}
      </Button>
    </div>
  )
}

/**
 * Detaches a role from a principal.
 *
 * `UnassignRoleInput`, from the same file: also `{ userId: string, roleId:
 * string }`. It happens to share `AssignRoleInput`'s shape, but it is a
 * distinct Go type and read separately in Step 1 rather than assumed.
 */
function UnassignRole({ roleId }: { roleId: string }) {
  const unassign = useCommand<AckResponse>("roles.unassign")
  const [userId, setUserId] = useState("")

  async function submit() {
    const result = await unassign.execute({ userId, roleId })
    if (result === undefined) return
    setUserId("")
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Remove from a user</h2>
      <CommandAlert error={unassign.error} title="Could not remove" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-unassign-user">User ID</Label>
        <Input
          id="role-unassign-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
      </div>
      <Button
        variant="destructive"
        onClick={() => void submit()}
        disabled={unassign.loading || userId.trim() === ""}
      >
        {unassign.loading ? "Removing…" : "Remove"}
      </Button>
    </div>
  )
}

export function AuthRoleDetailPage({ params }: PluginPageProps) {
  const roleId = params.id
  if (!roleId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No role selected.
      </p>
    )
  }
  return <RoleDetailBody roleId={roleId} />
}

function RoleDetailBody({ roleId }: { roleId: string }) {
  const query = useQuery<RoleDetail>("roles.detail", { id: roleId })

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Role" query={query} skeletonRows={3}>
        {(role) => {
          const permissions = role.permissions ?? []
          return (
            <>
              <PageHeader title={role.name} description={role.slug} />
              <DetailLayout
                main={
                  <>
                    <DescriptionList
                      items={[
                        { term: "Slug", value: <span className="font-mono text-xs">{role.slug}</span> },
                        {
                          term: "Description",
                          value: role.description || <NoneCell label="description" />,
                        },
                        {
                          term: "Parent",
                          value: <IdCell value={role.parentId} label="parent role" />,
                        },
                        { term: "App", value: <IdCell value={role.appId} label="app" /> },
                        {
                          term: "Environment",
                          value: <IdCell value={role.envId} label="environment" />,
                        },
                        { term: "Created", value: formatTimestamp(role.createdAt) },
                        { term: "Updated", value: formatTimestamp(role.updatedAt) },
                      ]}
                    />
                    <ResourceTable<PermissionRecord>
                      columns={permissionColumns}
                      rows={permissions}
                      rowKey={(p) => p.id}
                      caption={`${permissions.length} ${
                        permissions.length === 1 ? "permission" : "permissions"
                      }`}
                      emptyMessage="This role grants no permissions."
                    />
                  </>
                }
                aside={
                  <>
                    <EditRole role={role} />
                    <AssignRole roleId={role.id} />
                    <UnassignRole roleId={role.id} />
                  </>
                }
              />
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
