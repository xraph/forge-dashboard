import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
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
import {
  NamespaceCell,
  emptyListMessage,
  useNamespaceFilter,
} from "../components/namespace-filter"

/** Mirrors the Go `RoleSummary`. Field names are its JSON tags. */
export interface RoleSummary {
  id: string
  namespacePath: string
  name: string
  slug: string
  description?: string
  parentSlug?: string
  isSystem: boolean
  isDefault: boolean
  maxMembers?: number
  createdAt: string
  updatedAt: string
}

/** Mirrors the Go `RolesListResponse`: PageMeta embedded beside items. */
export interface RolesList {
  items: RoleSummary[]
  total: number
  limit: number
  offset: number
}

/** Mirrors the Go `AckResponse`. */
export interface AckResponse {
  id?: string
}

const PAGE_SIZE = 25

function CreateRoleForm({
  namespacePath,
  onDone,
}: {
  namespacePath: string
  onDone: () => void
}) {
  const create = useCommand<AckResponse>("roles.create")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")

  async function submit() {
    // Trimmed on the way out, not only for the disabled check: a slug of
    // " auditor" is a different slug from "auditor", and nothing looking
    // for the second will ever find the first.
    const result = await create.execute({
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || undefined,
      namespacePath,
    })
    // execute resolves undefined only when the client throws, so this is
    // the success check. A failed create must not close the form and throw
    // away what the operator typed.
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <CommandAlert error={create.error} title="Could not create the role" />
      <p className="text-sm text-muted-foreground">
        Creating in {namespacePath === "" ? "the tenant root" : namespacePath}.
        Slugs are unique per namespace, so the same slug can exist in two of
        them.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-name">Name</Label>
        <Input
          id="role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role-slug">Slug</Label>
        <Input
          id="role-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
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

export function WardenRolesPage() {
  // One-based, matching ResourceTable's PaginationState, which documents
  // `page` as "matching what an operator reads".
  const [page, setPage] = useState(1)
  const namespace = useNamespaceFilter(() => setPage(1))
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<RoleSummary | null>(null)

  const list = useQuery<RolesList>("roles.list", {
    ...namespace.param,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })
  const remove = useCommand<AckResponse>("roles.delete")

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result === undefined) return
    setDeleting(null)
    // Deleting the only row on the last page leaves that page past the end
    // of the set: an empty table, and a caption still counting rows. Step
    // back one page so the operator lands on rows that exist.
    if (page > 1 && (list.data?.items?.length ?? 0) <= 1) setPage(page - 1)
  }

  const columns: Column<RoleSummary>[] = [
    {
      id: "name",
      header: "Name",
      cell: (r) => r.name,
      className: "font-medium",
    },
    {
      id: "slug",
      header: "Slug",
      cell: (r) => r.slug,
      className: "font-mono text-xs",
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (r) => <NamespaceCell path={r.namespacePath} />,
    },
    {
      id: "parent",
      header: "Inherits",
      cell: (r) =>
        r.parentSlug ? (
          <span className="font-mono text-xs">{r.parentSlug}</span>
        ) : (
          <NoneCell label="parent role" />
        ),
    },
    {
      id: "flags",
      header: "Flags",
      cell: (r) => (
        <span className="flex gap-1">
          {/* Most roles are neither, so both badges mark a minority. A
              system role is what somebody scanning for one is hunting. */}
          {r.isSystem && <Badge variant="destructive">system</Badge>}
          {r.isDefault && <Badge variant="secondary">default</Badge>}
          {!r.isSystem && !r.isDefault && <NoneCell label="flags" />}
        </span>
      ),
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (r) => <Timestamp value={r.createdAt} label="created at" />,
    },
    {
      id: "updatedAt",
      header: "Updated",
      cell: (r) => <Timestamp value={r.updatedAt} label="updated at" />,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Roles"
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>New role</Button>
          )
        }
      />

      <FilterBar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setPage(1)
          },
          placeholder: "Search by name",
          label: "Search roles",
        }}
        filters={[namespace.filterConfig]}
      />

      {creating && (
        <CreateRoleForm
          namespacePath={namespace.value === "all" ? "" : namespace.value}
          onDone={() => setCreating(false)}
        />
      )}

      <QueryBoundary title="Roles" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          const caption = `${data.total} ${data.total === 1 ? "role" : "roles"}`
          return (
            <ResourceTable<RoleSummary>
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              caption={caption}
              emptyMessage={emptyListMessage("roles", search, namespace.value)}
              pagination={{ page, pageSize: data.limit, total: data.total }}
              onPageChange={setPage}
              rowActions={(r) => (
                <>
                  <PluginLink
                    to={`/roles/${r.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </PluginLink>
                  {/* No delete on a system role: the contract refuses it,
                      so the button would promise a rejection. */}
                  {!r.isSystem && (
                    <IconButton
                      variant="destructive"
                      onClick={() => {
                        // Reset at open, not at close: the operator is
                        // about to read whatever this dialog shows for THIS
                        // role, so a failure from a previous row must not
                        // be attributed to one they have not touched.
                        remove.reset()
                        setDeleting(r)
                      }}
                      label={`Delete ${r.name}`}
                    />
                  )}
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      {/* The error lives inside the dialog. Base UI marks everything
          outside an open dialog inert and aria-hidden, so an alert on the
          page body is unreachable while the dialog that can fail is open. */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="Every assignment of this role is removed with it, and any role inheriting from it loses its parent. This cannot be undone."
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete" />
      </ConfirmDialog>
    </section>
  )
}
