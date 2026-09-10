import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
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

/**
 * `AuthRoleDetailPage` is defined in `role-detail.tsx` but re-exported here so
 * a single `roles.test.tsx` can import both the list and the detail page from
 * this one module. `role-detail.tsx` only imports *types* back from this
 * file, and a type-only import is erased at compile time, so this does not
 * create a runtime import cycle between the two modules.
 */
export { AuthRoleDetailPage } from "./role-detail"

export interface RoleSummary {
  id: string
  name: string
  slug: string
  description?: string
  createdAt: string
}

export interface PermissionRecord {
  id: string
  action: string
  resource: string
}

/** `roles.detail`. RoleDetail embeds RoleSummary in Go, so the JSON is flat. */
export interface RoleDetail extends RoleSummary {
  appId?: string
  envId?: string
  parentId?: string
  permissions?: PermissionRecord[]
  updatedAt: string
}

export interface RolesList {
  roles: RoleSummary[]
}

/**
 * A cell whose value is legitimately absent renders a dash an assistive
 * reader can still announce, rather than nothing at all.
 */
function NoneCell() {
  return <span aria-label="None">–</span>
}

function CreateRoleForm({ onDone }: { onDone: () => void }) {
  const create = useCommand<AckResponse>("roles.create")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")

  async function submit() {
    const result = await create.execute({
      name,
      slug,
      description: description || undefined,
    })
    // `execute` resolves with undefined on failure and never rejects, so this
    // is the success check. A failed create must not close the form and throw
    // away what the operator typed.
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <CommandAlert error={create.error} title="Could not create the role" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-name">Name</Label>
        <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-slug">Slug</Label>
        <Input id="role-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-description">Description</Label>
        <Input
          id="role-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => void submit()}
          disabled={create.loading || name.trim() === "" || slug.trim() === ""}
        >
          {create.loading ? "Creating…" : "Create role"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={create.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Roles, unpaged, with create and delete.
 *
 * `roles.list` takes no cursor and no limit and answers its whole collection,
 * so unlike `/users` this page has no pager - forcing a page-number control
 * onto a server behaviour that does not exist would just be furniture that
 * never activates.
 */
export function AuthRolesPage() {
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<RoleSummary | null>(null)

  const list = useQuery<RolesList>("roles.list")
  const remove = useCommand<AckResponse>("roles.delete")

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result !== undefined) setDeleting(null)
  }

  const columns: Column<RoleSummary>[] = [
    { id: "name", header: "Name", cell: (r) => r.name, className: "font-medium" },
    { id: "slug", header: "Slug", cell: (r) => r.slug, className: "font-mono text-xs" },
    {
      id: "description",
      header: "Description",
      cell: (r) => r.description || <NoneCell />,
    },
    { id: "createdAt", header: "Created", cell: (r) => formatTimestamp(r.createdAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Roles"
        actions={!creating && <Button onClick={() => setCreating(true)}>New role</Button>}
      />

      {creating && <CreateRoleForm onDone={() => setCreating(false)} />}

      <QueryBoundary title="Roles" query={list} skeletonRows={5}>
        {(data) => {
          const roles = data.roles ?? []
          // `roles.list` has no total field to report against, but the
          // caption still carries the live count, the same as every other
          // table in this package.
          const caption = `${roles.length} ${roles.length === 1 ? "role" : "roles"}`

          return (
            <ResourceTable<RoleSummary>
              columns={columns}
              rows={roles}
              rowKey={(r) => r.id}
              caption={caption}
              emptyMessage="No roles yet."
              rowActions={(role) => (
                <>
                  <PluginLink
                    to={`/@auth/roles/${role.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </PluginLink>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Delete ${role.name}`}
                    onClick={() => {
                      // Reset at open, not at close: the operator is about to
                      // read whatever this dialog shows for THIS role, so a
                      // failure left over from a previous row's delete must
                      // not be attributed to one they have not touched.
                      remove.reset()
                      setDeleting(role)
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      {/*
        The error lives inside the dialog's description, not above the table.
        Base UI marks everything outside an open AlertDialog `inert` and
        `aria-hidden`, so an alert rendered up here is unreachable for as long
        as the dialog that can actually fail is open.
      */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>Anyone assigned this role loses it. This cannot be undone.</span>
            <CommandAlert error={remove.error} title="Could not delete" />
          </span>
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
