import { useState } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
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
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { NamespaceCell } from "../components/namespace-filter"
import type { PermissionSummary } from "./role-detail"
import type { AckResponse, RoleSummary } from "./roles"

/**
 * Mirrors the Go `PermissionDetail`: `PermissionSummary` embedded, so the JSON
 * is flat, with `grantedBy` beside it.
 *
 * `grantedBy` is always present (the server sends `[]`, never null), but the
 * page still reads it through `?? []`, because a page that throws on a null
 * list is worse than one that shows an empty one.
 */
export interface PermissionDetail extends PermissionSummary {
  grantedBy: RoleSummary[]
}

const LINK_CLASS = "text-sm underline underline-offset-4"

export function WardenPermissionDetailPage({ params }: PluginPageProps) {
  const id = params.id as string
  const detail = useQuery<PermissionDetail>("permissions.detail", { id })
  const remove = useCommand<AckResponse>("permissions.delete")
  const navigate = useNavigateTo()

  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  // `permissions.delete` gives this page no intent to refetch that would say
  // the permission it is showing is gone, so once a delete succeeds the page
  // stops rendering the permission at once, rather than waiting on a
  // navigation that a slow browser or a test environment may not have
  // finished. A page whose subject was just deleted has nowhere to stay.
  const [deleted, setDeleted] = useState(false)

  async function confirmDelete() {
    const result = await remove.execute({ id })
    // execute() resolves undefined only when the client throws, so this is
    // the success check. A refused delete must leave the dialog open with
    // its error in it.
    if (result === undefined) return
    setDeleted(true)
    navigate("/permissions")
  }

  if (deleted) {
    return (
      <ZeroState
        title="This permission has been deleted."
        action={
          <PluginLink to="/permissions" className={LINK_CLASS}>
            Back to permissions
          </PluginLink>
        }
      />
    )
  }

  return (
    // keepPreviousData: a refetch (after the save, or when the tab comes
    // back) would otherwise swap in the skeleton and unmount the form with
    // whatever the operator was typing in it.
    <QueryBoundary title="Permission" query={detail} skeletonRows={4} keepPreviousData>
      {(permission) => (
        <section className="flex flex-col gap-6">
          <PageHeader
            title={permission.name}
            actions={
              // Neither on a system permission: the contract refuses both
              // the update and the delete, so offering them would promise a
              // rejection. Neither while the form is open, either: they
              // would act on a page the operator is mid-edit on.
              !permission.isSystem &&
              !editing && (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    Edit description
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      // Reset at open, not at close: the operator is about to
                      // read whatever this dialog shows for THIS permission, so
                      // a failure from an earlier attempt must not be
                      // attributed to it.
                      remove.reset()
                      setDeleting(true)
                    }}
                  >
                    Delete
                  </Button>
                </>
              )
            }
          />

          {permission.isSystem && (
            <Alert>This is a system permission. It cannot be changed or deleted.</Alert>
          )}

          <DetailLayout
            aside={
              <div className="flex flex-col gap-3">
                <DescriptionList
                  items={[
                    {
                      // The pair a check matches on. The name is only a label,
                      // so these two decide whether a check finds this
                      // permission at all.
                      term: "Resource",
                      value: (
                        <span className="font-mono text-xs">{permission.resource}</span>
                      ),
                    },
                    {
                      term: "Action",
                      value: <span className="font-mono text-xs">{permission.action}</span>,
                    },
                    {
                      term: "Namespace",
                      value: <NamespaceCell path={permission.namespacePath} />,
                    },
                    {
                      term: "Description",
                      value: permission.description || <NoneCell label="description" />,
                    },
                    {
                      term: "Flags",
                      value: permission.isSystem ? (
                        <Badge variant="destructive">system</Badge>
                      ) : (
                        <NoneCell label="flags" />
                      ),
                    },
                    {
                      term: "Created",
                      value: <Timestamp value={permission.createdAt} label="creation time" />,
                    },
                    {
                      term: "Updated",
                      value: <Timestamp value={permission.updatedAt} label="updated at" />,
                    },
                  ]}
                />
                <p className="text-xs text-muted-foreground">
                  A check matches on resource and action, never on the permission&apos;s name or
                  namespace.
                </p>
              </div>
            }
            main={
              editing ? (
                <DescriptionForm permission={permission} onDone={() => setEditing(false)} />
              ) : (
                <GrantedByTable roles={permission.grantedBy ?? []} />
              )
            }
          />

          {/* The error lives inside the dialog. Base UI marks everything
              outside an open dialog inert and aria-hidden, so an alert on the
              page body is unreachable while the dialog that can fail is open. */}
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title={`Delete ${permission.name}?`}
            description="This is refused while any role attaches it directly. Detach it from those roles first, and the error below will name them."
            confirmLabel="Delete"
            pending={remove.loading}
            onConfirm={() => void confirmDelete()}
          >
            <CommandAlert error={remove.error} title="Could not delete" />
          </ConfirmDialog>
        </section>
      )}
    </QueryBoundary>
  )
}

/**
 * Edits the one field `permissions.update` accepts.
 *
 * The contract takes `{id, description}` and nothing else: resource and
 * action are left out on purpose, because changing either would change what
 * the permission means while every role kept granting it. `description` is a
 * pointer there, so an empty string is an instruction (clear it), not an
 * absent field, and the form sends it as one.
 *
 * On success the server names permissions.detail in the command's
 * invalidates, so this page reads again and shows what was saved.
 */
function DescriptionForm({
  permission,
  onDone,
}: {
  permission: PermissionDetail
  onDone: () => void
}) {
  const update = useCommand<AckResponse>("permissions.update")
  const [description, setDescription] = useState(permission.description ?? "")
  const next = description.trim()
  const dirty = next !== (permission.description ?? "").trim()

  async function submit() {
    if (!dirty) return
    const result = await update.execute({ id: permission.id, description: next })
    // execute() resolves undefined only when the client throws, so this is
    // the success check. A refused save must leave the form open with what
    // the operator typed.
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <p className="text-sm text-muted-foreground">
        Only the description can change. Resource and action decide what this
        permission means, so to change either, delete it and create another.
        Checks never read the description, so saving it changes no one&apos;s
        access.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="permission-edit-description">Description</Label>
        <Input
          id="permission-edit-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Leave it empty to remove the description.
        </p>
      </div>
      <CommandAlert error={update.error} title="Could not save the description" />
      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={update.loading || !dirty}>
          {update.loading ? "Saving…" : "Save description"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={update.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Which roles attach this permission DIRECTLY.
 *
 * That is all `grantedBy` holds: the server matches role grants by exact name
 * and namespace. The engine does not. It compares each of a role's
 * permissions as `resource:action` with the check's (engine.go evaluateRBAC,
 * matcher.go matchPermission) and never reads a permission's name or
 * namespace. So a role grants this permission's check without attaching it
 * when it inherits it from a parent role (resolveInheritedRoleObjects), holds
 * a wildcard such as `document:*`, or attaches another permission with the
 * same resource and action under another name or in another namespace. The
 * comparison is of the joined string, not the pair, and no write refuses a
 * colon in a resource or an action, so (warden, role:manage) grants the same
 * check as (warden:role, manage). None of those shows here, so nothing on this table may claim to be every role
 * that grants the check, and an empty table does not mean no role grants it.
 *
 * The count is what the server returned, never a page's worth of it:
 * `grantedBy` is not paged, because the delete guard that shares its scan
 * cannot be bounded by a page size.
 */
function GrantedByTable({ roles }: { roles: RoleSummary[] }) {
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
      cell: (r) =>
        r.isSystem ? <Badge variant="destructive">system</Badge> : <NoneCell label="flags" />,
    },
  ]
  return (
    <div className="flex flex-col gap-2">
      <ResourceTable<RoleSummary>
        columns={columns}
        rows={roles}
        rowKey={(r) => r.id}
        caption={`${roles.length} ${roles.length === 1 ? "role attaches" : "roles attach"} it directly`}
        // A permission no role attaches is a real state, not an error: it is
        // what an operator is looking for before deleting one. It is not "no
        // role grants it", which an inherited or wildcard grant can make false.
        emptyMessage="No role attaches this permission directly."
        rowActions={(r) => (
          <PluginLink to={`/roles/${r.id}`} className={LINK_CLASS}>
            Details
          </PluginLink>
        )}
      />
      <p className="text-xs text-muted-foreground">
        A role can also grant this permission&apos;s check without attaching it:
        through a parent role, a wildcard permission such as document:*, or
        another permission with the same resource and action under another name
        or in another namespace. This list does not show those roles.
      </p>
    </div>
  )
}
