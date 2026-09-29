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
    <QueryBoundary title="Permission" query={detail} skeletonRows={4}>
      {(permission) => (
        <section className="flex flex-col gap-6">
          <PageHeader
            title={permission.name}
            actions={
              // No delete on a system permission: the contract refuses it, so
              // offering the button would promise a rejection.
              !permission.isSystem && (
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
              )
            }
          />

          {permission.isSystem && (
            <Alert>This is a system permission. It cannot be deleted.</Alert>
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
                  A check matches on resource and action, never on the name.
                </p>
              </div>
            }
            main={<GrantedByTable roles={permission.grantedBy ?? []} />}
          />

          {/* The error lives inside the dialog. Base UI marks everything
              outside an open dialog inert and aria-hidden, so an alert on the
              page body is unreachable while the dialog that can fail is open. */}
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title={`Delete ${permission.name}?`}
            description={
              <span className="flex flex-col gap-2">
                <span>
                  This is refused while any role still grants it. Detach it from
                  those roles first, and the error below will name them.
                </span>
                <CommandAlert error={remove.error} title="Could not delete" />
              </span>
            }
            confirmLabel="Delete"
            pending={remove.loading}
            onConfirm={() => void confirmDelete()}
          />
        </section>
      )}
    </QueryBoundary>
  )
}

/**
 * The question this page exists to answer: which roles grant this permission.
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
    <ResourceTable<RoleSummary>
      columns={columns}
      rows={roles}
      rowKey={(r) => r.id}
      caption={`${roles.length} ${roles.length === 1 ? "granting role" : "granting roles"}`}
      // A permission nothing grants is a real state, not an error: it is what
      // an operator is looking for before deleting one, and a generic empty
      // message would not say which kind of empty this is.
      emptyMessage="No role grants this permission."
      rowActions={(r) => (
        <PluginLink to={`/roles/${r.id}`} className={LINK_CLASS}>
          Details
        </PluginLink>
      )}
    />
  )
}
