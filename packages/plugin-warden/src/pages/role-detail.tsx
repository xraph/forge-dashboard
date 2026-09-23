import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert } from "@forge-go/dashboard-kit/components/alert"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NativeSelect } from "@forge-go/dashboard-kit/components/native-select"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { NamespaceCell } from "../components/namespace-filter"
import type { AckResponse, RoleSummary } from "./roles"

/** Mirrors the Go `PermissionSummary`. */
export interface PermissionSummary {
  id: string
  namespacePath: string
  name: string
  resource: string
  action: string
  description?: string
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

/** Mirrors the Go `RoleDetail`: RoleSummary embedded, so the JSON is flat. */
export interface RoleDetail extends RoleSummary {
  permissions: PermissionSummary[]
  children: RoleSummary[]
  createdBy?: string
  updatedBy?: string
}

interface PermissionsList {
  items: PermissionSummary[]
  total: number
  limit: number
  offset: number
}

/** The picker reads a wide page because it is a chooser, not a browser. */
const PICKER_LIMIT = 200

/**
 * Encodes a natural key into one select value, and back.
 *
 * The junction is keyed by (namespacePath, name), never by id: sending an id
 * would detach nothing and warden's handler would refuse it. A NUL byte
 * separates the two halves because a namespace path cannot contain one
 * (namespaceSegmentRegex allows only lowercase letters, digits and hyphens)
 * and neither can a permission name. Any printable separator, a colon, a
 * slash, could appear in a real value and would split the key in the wrong
 * place.
 */
function joinRef(namespacePath: string, name: string) {
  return `${namespacePath}\u0000${name}`
}
function splitRef(value: string): [string, string] {
  const i = value.indexOf("\u0000")
  return [value.slice(0, i), value.slice(i + 1)]
}

export function WardenRoleDetailPage({ params }: PluginPageProps) {
  const id = params.id as string
  const detail = useQuery<RoleDetail>("roles.detail", { id })
  const detach = useCommand<AckResponse>("roles.detachPermission")

  const [revoking, setRevoking] = useState<PermissionSummary | null>(null)
  const [attaching, setAttaching] = useState(false)

  async function confirmRevoke() {
    if (!revoking) return
    // The junction is keyed by (namespacePath, name), never by id. Sending
    // an id would detach nothing and the server would refuse it.
    const result = await detach.execute({
      roleId: id,
      permissionName: revoking.name,
      permissionNamespacePath: revoking.namespacePath,
    })
    // execute() resolves undefined only when the client throws, so this is
    // the success check.
    if (result !== undefined) setRevoking(null)
  }

  return (
    <QueryBoundary title="Role" query={detail} skeletonRows={4}>
      {(role) => (
        <section className="flex flex-col gap-6">
          <PageHeader
            title={role.name}
            actions={
              !role.isSystem && (
                <Button onClick={() => setAttaching(true)}>Attach permission</Button>
              )
            }
          />

          {role.isSystem && (
            <Alert>
              This is a system role. It cannot be edited, deleted, or have its
              grants changed.
            </Alert>
          )}

          <DetailLayout
            aside={
              <DescriptionList
                items={[
                  {
                    term: "Slug",
                    value: <span className="font-mono text-xs">{role.slug}</span>,
                  },
                  { term: "Namespace", value: <NamespaceCell path={role.namespacePath} /> },
                  {
                    term: "Description",
                    value: role.description || <NoneCell label="description" />,
                  },
                  {
                    term: "Inherits from",
                    value: role.parentSlug ? (
                      <span className="font-mono text-xs">{role.parentSlug}</span>
                    ) : (
                      <NoneCell label="parent role" />
                    ),
                  },
                  {
                    term: "Member cap",
                    value: role.maxMembers ? String(role.maxMembers) : "Unlimited",
                  },
                  { term: "Default role", value: role.isDefault ? "Yes" : "No" },
                  {
                    term: "Created by",
                    value: role.createdBy ? (
                      <span className="font-mono text-xs">{role.createdBy}</span>
                    ) : (
                      <NoneCell label="creator" />
                    ),
                  },
                  {
                    term: "Updated",
                    value: <Timestamp value={role.updatedAt} label="updated at" />,
                  },
                ]}
              />
            }
            main={
              <div className="flex flex-col gap-6">
                <GrantsTable
                  role={role}
                  onRevoke={(p) => {
                    // Reset at open, not at close: the operator is about to
                    // read whatever this dialog shows for THIS grant, so a
                    // failure from a previous one must not be attributed to
                    // it.
                    detach.reset()
                    setRevoking(p)
                  }}
                />
                <ChildrenTable role={role} />
              </div>
            }
          />

          <ConfirmDialog
            open={revoking !== null}
            onOpenChange={(open) => !open && setRevoking(null)}
            title={`Revoke ${revoking?.name ?? ""}?`}
            description={
              <span className="flex flex-col gap-2">
                <span>
                  {role.name} stops granting this permission. Anyone holding the
                  role loses it, and any role inheriting from {role.slug} loses it
                  too.
                </span>
                <CommandAlert error={detach.error} title="Could not revoke" />
              </span>
            }
            confirmLabel="Revoke"
            pending={detach.loading}
            onConfirm={() => void confirmRevoke()}
          />

          {/*
            Mounted only while open, not just made invisible: useQuery fires
            its read the moment a component using it mounts, whatever params
            it is given, so the only way to keep the picker's wide read from
            firing on every detail-page load is to keep this subtree out of
            the tree until the operator actually asks for it.
          */}
          {attaching && (
            <AttachDialog
              roleId={id}
              roleName={role.name}
              held={role.permissions}
              onClose={() => setAttaching(false)}
            />
          )}
        </section>
      )}
    </QueryBoundary>
  )
}

function GrantsTable({
  role,
  onRevoke,
}: {
  role: RoleDetail
  onRevoke: (p: PermissionSummary) => void
}) {
  const grants = role.permissions ?? []
  const columns: Column<PermissionSummary>[] = [
    { id: "name", header: "Permission", cell: (p) => p.name, className: "font-medium" },
    { id: "resource", header: "Resource", cell: (p) => p.resource },
    { id: "action", header: "Action", cell: (p) => p.action },
    {
      id: "namespace",
      header: "Namespace",
      cell: (p) => <NamespaceCell path={p.namespacePath} />,
    },
  ]
  return (
    <ResourceTable<PermissionSummary>
      columns={columns}
      rows={grants}
      rowKey={(p) => p.id}
      caption={`${grants.length} ${grants.length === 1 ? "permission" : "permissions"}`}
      emptyMessage="This role grants nothing."
      // No Details link here: `/permissions/:id` has no route yet. The
      // intent behind it (`permissions.detail`, with the `grantedBy` list a
      // detail page would show) is real and waiting, but the page itself is
      // a later plan's scope.
      rowActions={(p) =>
        !role.isSystem && (
          <Button
            variant="destructive"
            size="sm"
            aria-label={`Revoke ${p.name}`}
            onClick={() => onRevoke(p)}
          >
            Revoke
          </Button>
        )
      }
    />
  )
}

function ChildrenTable({ role }: { role: RoleDetail }) {
  const children = role.children ?? []
  const columns: Column<RoleSummary>[] = [
    { id: "name", header: "Role", cell: (r) => r.name, className: "font-medium" },
    { id: "slug", header: "Slug", cell: (r) => r.slug, className: "font-mono text-xs" },
    {
      id: "namespace",
      header: "Namespace",
      cell: (r) => <NamespaceCell path={r.namespacePath} />,
    },
    {
      id: "flags",
      header: "Flags",
      // Most children are not system roles, so system is the minority and
      // the thing somebody scanning this column is hunting.
      cell: (r) =>
        r.isSystem ? <Badge variant="destructive">system</Badge> : <NoneCell label="flags" />,
    },
  ]
  return (
    <ResourceTable<RoleSummary>
      columns={columns}
      rows={children}
      rowKey={(r) => r.id}
      caption={`${children.length} ${children.length === 1 ? "child role" : "child roles"}`}
      emptyMessage="Nothing inherits from this role."
      rowActions={(r) => (
        <PluginLink to={`/roles/${r.id}`} className="text-sm underline underline-offset-4">
          Details
        </PluginLink>
      )}
    />
  )
}

/**
 * Only ever mounted while its dialog is open (see the call site), which is
 * what keeps its `useQuery` from firing a wide picker read on every role
 * detail page load whether or not an operator ever attaches anything.
 */
function AttachDialog({
  roleId,
  roleName,
  held,
  onClose,
}: {
  roleId: string
  roleName: string
  held: PermissionSummary[]
  onClose: () => void
}) {
  const attach = useCommand<AckResponse>("roles.attachPermission")
  const list = useQuery<PermissionsList>("permissions.list", { limit: PICKER_LIMIT })
  const [chosen, setChosen] = useState("")

  const heldKeys = new Set(held.map((p) => joinRef(p.namespacePath, p.name)))
  const options = (list.data?.items ?? []).filter(
    (p) => !heldKeys.has(joinRef(p.namespacePath, p.name))
  )

  async function confirmAttach() {
    if (chosen === "") return
    const [namespacePath, name] = splitRef(chosen)
    const result = await attach.execute({
      roleId,
      permissionName: name,
      permissionNamespacePath: namespacePath,
    })
    if (result !== undefined) onClose()
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Attach a permission to ${roleName}`}
      description={
        <span className="flex flex-col gap-2">
          <span>
            Anyone holding this role gains it immediately, as does any role that
            inherits from it.
          </span>
          <NativeSelect
            aria-label="Permission to attach"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value="">Choose a permission</option>
            {options.map((p) => (
              <option key={p.id} value={joinRef(p.namespacePath, p.name)}>
                {p.name}
                {p.namespacePath === "" ? " (/)" : ` (${p.namespacePath})`}
              </option>
            ))}
          </NativeSelect>
          {options.length === 0 && !list.loading && (
            <span className="text-sm text-muted-foreground">
              Every permission is already granted to this role.
            </span>
          )}
          <CommandAlert error={attach.error} title="Could not attach" />
        </span>
      }
      confirmLabel="Attach"
      pending={attach.loading}
      confirmDisabled={chosen === ""}
      onConfirm={() => void confirmAttach()}
    />
  )
}
