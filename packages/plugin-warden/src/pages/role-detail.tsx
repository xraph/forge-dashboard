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
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
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

/**
 * Mirrors the Go `PermissionsListResponse`: PageMeta embedded beside items.
 * Declared here beside `PermissionSummary` and imported by the permissions
 * page, so the one Go DTO has one TypeScript home.
 */
export interface PermissionsList {
  items: PermissionSummary[]
  total: number
  limit: number
  offset: number
}

/** Mirrors the Go `PermissionRef`: how `roles.setPermissions` names a grant. */
interface PermissionRef {
  name: string
  namespacePath: string
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
  const replace = useCommand<AckResponse>("roles.setPermissions")

  const [revoking, setRevoking] = useState<PermissionSummary | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [editing, setEditing] = useState(false)

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

  async function confirmReplace(permissions: PermissionRef[]) {
    // The key is roleId, not id, unlike roles.update. An id would leave
    // roleId empty and the server would have no role to write to.
    const result = await replace.execute({ roleId: id, permissions })
    if (result !== undefined) setReplacing(false)
  }

  return (
    <QueryBoundary title="Role" query={detail} skeletonRows={4}>
      {(role) => (
        <section className="flex flex-col gap-6">
          <PageHeader
            title={role.name}
            actions={
              // The contract refuses every one of these on a system role,
              // so none is offered there. While the form is open they
              // would be acting on a page the operator is mid-edit on.
              !role.isSystem &&
              !editing && (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Reset at open, not at close, so a refusal from an
                      // earlier attempt is not shown against this one.
                      replace.reset()
                      setReplacing(true)
                    }}
                  >
                    Replace all
                  </Button>
                  <Button onClick={() => setAttaching(true)}>Attach permission</Button>
                </>
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
                    term: "Created",
                    value: <Timestamp value={role.createdAt} label="created at" />,
                  },
                  {
                    term: "Updated",
                    value: <Timestamp value={role.updatedAt} label="updated at" />,
                  },
                ]}
              />
            }
            main={
              editing ? (
                <EditForm role={role} onDone={() => setEditing(false)} />
              ) : (
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
              )
            }
          />

          <ConfirmDialog
            open={revoking !== null}
            onOpenChange={(open) => !open && setRevoking(null)}
            title={`Revoke ${revoking?.name ?? ""}?`}
            description={`${role.name} stops granting this permission. Anyone holding the role loses it, and any role inheriting from ${role.slug} loses it too.`}
            confirmLabel="Revoke"
            pending={detach.loading}
            onConfirm={() => void confirmRevoke()}
          >
            <CommandAlert error={detach.error} title="Could not revoke" />
          </ConfirmDialog>

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

          {/* Mounted only while open for the same reason as the picker
              above: it reads the wide permissions page. */}
          {replacing && (
            <ReplaceDialog
              roleName={role.name}
              held={role.permissions ?? []}
              pending={replace.loading}
              error={replace.error}
              onSubmit={(permissions) => void confirmReplace(permissions)}
              onClose={() => setReplacing(false)}
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
      rowActions={(p) => (
        <>
          <PluginLink
            to={`/permissions/${p.id}`}
            className="text-sm underline underline-offset-4"
          >
            Details
          </PluginLink>
          {!role.isSystem && (
            <Button
              variant="destructive"
              size="sm"
              aria-label={`Revoke ${p.name}`}
              onClick={() => onRevoke(p)}
            >
              Revoke
            </Button>
          )}
        </>
      )}
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
    {
      id: "createdAt",
      header: "Created",
      cell: (r) => <Timestamp value={r.createdAt} label="created at" />,
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
  const loaded = list.data?.items ?? []
  const options = loaded.filter((p) => !heldKeys.has(joinRef(p.namespacePath, p.name)))
  // The read is one page of PICKER_LIMIT, so a tenant with more permissions
  // than that gets a picker that is missing some of them.
  const total = list.data?.total ?? 0
  const truncated = list.data !== undefined && total > loaded.length

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
      description="Anyone holding this role gains it immediately, as does any role that inherits from it."
      confirmLabel="Attach"
      pending={attach.loading}
      confirmDisabled={chosen === ""}
      onConfirm={() => void confirmAttach()}
    >
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
      {/* Four different reasons the picker can be empty, and only one of
          them is "everything is granted". A failed read must say so
          rather than read as an answer. */}
      <CommandAlert error={list.error} title="Could not load permissions" />
      {list.data !== undefined && total === 0 && (
        <span className="text-sm text-muted-foreground">
          No permissions exist yet. Create one on the Permissions page first.
        </span>
      )}
      {list.data !== undefined && total > 0 && options.length === 0 && !truncated && (
        <span className="text-sm text-muted-foreground">
          Every permission is already granted to this role.
        </span>
      )}
      {truncated && (
        <span className="text-sm text-muted-foreground">
          Showing the first {loaded.length} of {total} permissions, so this list is
          incomplete{options.length === 0 ? " and every one shown is already granted" : ""}.
        </span>
      )}
      <CommandAlert error={attach.error} title="Could not attach" />
    </ConfirmDialog>
  )
}

/**
 * Reads the member-cap field. Blank means unlimited, which warden stores as
 * 0, so blank is a real value and not a missing one. Anything that is not a
 * whole number of zero or more is `null`, and the form refuses to save it.
 */
function parseCap(text: string): number | null {
  const t = text.trim()
  if (t === "") return 0
  return /^\d+$/.test(t) ? Number(t) : null
}

/**
 * Edits the fields the aside shows.
 *
 * `roles.update` reads each optional field as a pointer: an absent key means
 * leave it alone, and a present zero value is an instruction (an empty
 * `parentSlug` clears the parent, `maxMembers: 0` removes the cap,
 * `isDefault: false` unsets the default). So the payload carries only what
 * the operator changed, and a change back to the zero value is sent as that
 * value rather than dropped.
 */
function EditForm({ role, onDone }: { role: RoleDetail; onDone: () => void }) {
  const update = useCommand<AckResponse>("roles.update")
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? "")
  const [parentSlug, setParentSlug] = useState(role.parentSlug ?? "")
  // A string, so the operator can clear it. Unlimited is shown as blank.
  const [cap, setCap] = useState(role.maxMembers ? String(role.maxMembers) : "")
  const [isDefault, setIsDefault] = useState(role.isDefault)

  const parsedCap = parseCap(cap)
  const changed: Record<string, unknown> = {}
  if (name.trim() !== role.name.trim()) changed.name = name.trim()
  if (description.trim() !== (role.description ?? "").trim()) {
    changed.description = description.trim()
  }
  if (parentSlug.trim() !== (role.parentSlug ?? "").trim()) {
    changed.parentSlug = parentSlug.trim()
  }
  if (parsedCap !== null && parsedCap !== (role.maxMembers ?? 0)) {
    changed.maxMembers = parsedCap
  }
  if (isDefault !== role.isDefault) changed.isDefault = isDefault
  const dirty = Object.keys(changed).length > 0

  const nameBlank = name.trim() === ""
  const capInvalid = parsedCap === null

  async function submit() {
    if (!dirty || nameBlank || capInvalid) return
    const result = await update.execute({ id: role.id, ...changed })
    // execute() resolves undefined only when the client throws, so this is
    // the success check. A refused save must leave the form open with what
    // the operator typed.
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <p className="text-sm text-muted-foreground">
        The slug and namespace cannot change. Only what you change is saved.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-edit-name">Name</Label>
        <Input
          id="role-edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-edit-description">Description</Label>
        <Input
          id="role-edit-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-edit-parent">Inherits from</Label>
        <Input
          id="role-edit-parent"
          className="font-mono text-xs"
          placeholder="reader"
          value={parentSlug}
          onChange={(e) => setParentSlug(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          The slug of another role in this namespace. Leave it empty for no parent.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-edit-cap">Member cap</Label>
        <Input
          id="role-edit-cap"
          inputMode="numeric"
          placeholder="Unlimited"
          aria-invalid={capInvalid || undefined}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Leave it empty for no limit. Clearing a cap you had removes it. The
          cap is checked when a subject is assigned here or through
          warden&apos;s REST API; warden&apos;s bootstrap admin assignment
          skips it. You can&apos;t set it below the number of subjects who
          hold the role now.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="role-edit-default"
          type="checkbox"
          className="size-4"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        <Label htmlFor="role-edit-default">Default role</Label>
      </div>

      {nameBlank && (
        <p className="text-sm text-muted-foreground">A role needs a name.</p>
      )}
      {capInvalid && (
        <p className="text-sm text-muted-foreground">
          The member cap is a whole number, or empty for no limit.
        </p>
      )}
      <CommandAlert error={update.error} title="Could not save the role" />

      <div className="flex gap-2">
        <Button
          onClick={() => void submit()}
          disabled={update.loading || !dirty || nameBlank || capInvalid}
        >
          {update.loading ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={update.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Replaces the role's whole grant set with the checked permissions.
 *
 * Starts from what the role holds. Anything held stays listed even when the
 * picker's page did not include it, because dropping it from the list would
 * drop it from the set on confirm, and nobody chose to. An empty selection is
 * a real instruction (revoke everything) and is confirmable once it says so.
 */
function ReplaceDialog({
  roleName,
  held,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  roleName: string
  held: PermissionSummary[]
  pending: boolean
  error: { code: string; message: string } | undefined
  onSubmit: (permissions: PermissionRef[]) => void
  onClose: () => void
}) {
  const list = useQuery<PermissionsList>("permissions.list", { limit: PICKER_LIMIT })
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(held.map((p) => joinRef(p.namespacePath, p.name)))
  )

  const heldKeys = new Set(held.map((p) => joinRef(p.namespacePath, p.name)))
  const loaded = list.data?.items ?? []
  const options = [
    ...held,
    ...loaded.filter((p) => !heldKeys.has(joinRef(p.namespacePath, p.name))),
  ]
  const total = list.data?.total ?? 0
  const truncated = list.data !== undefined && total > loaded.length

  const selected = options.filter((p) => chosen.has(joinRef(p.namespacePath, p.name)))
  const unchanged =
    selected.length === held.length && held.every((p) => chosen.has(joinRef(p.namespacePath, p.name)))

  function toggle(p: PermissionSummary) {
    const key = joinRef(p.namespacePath, p.name)
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      title={`Replace all permissions on ${roleName}`}
      description="The role will grant exactly the permissions checked here. Anything unchecked is revoked, from everyone holding the role and from any role inheriting from it."
      confirmLabel="Replace grants"
      pending={pending}
      confirmDisabled={unchanged}
      onConfirm={() =>
        onSubmit(
          selected.map((p) => ({ name: p.name, namespacePath: p.namespacePath }))
        )
      }
    >
      <div
        role="group"
        aria-label="Permissions to grant"
        className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border p-2"
      >
        {options.map((p) => {
          // Every option names its namespace, the root as "/" like every
          // other namespace cell, so a root permission and a same-named
          // one elsewhere never read alike.
          const label = `${p.name} (${p.namespacePath === "" ? "/" : p.namespacePath})`
          return (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                aria-label={label}
                checked={chosen.has(joinRef(p.namespacePath, p.name))}
                disabled={pending}
                onChange={() => toggle(p)}
              />
              <span className="font-mono text-xs">{label}</span>
            </label>
          )
        })}
      </div>
      <CommandAlert error={list.error} title="Could not load permissions" />
      {truncated && (
        <span className="text-sm text-muted-foreground">
          Showing the first {loaded.length} of {total} permissions, so a
          permission past that is not listed. Everything the role holds is
          listed, and stays granted while it is checked.
        </span>
      )}
      {selected.length === 0 && held.length > 0 && (
        <span className="text-sm text-destructive">
          Nothing is checked. This revokes all {held.length}{" "}
          {held.length === 1 ? "permission" : "permissions"} from the role.
        </span>
      )}
      <CommandAlert error={error} title="Could not replace the permissions" />
    </ConfirmDialog>
  )
}
