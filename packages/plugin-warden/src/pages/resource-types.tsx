import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
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
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  NamespaceCell,
  emptyListMessage,
  useNamespaceFilter,
} from "../components/namespace-filter"
import type { AckResponse } from "./roles"

/**
 * Mirrors the Go `ResourceTypeSummary`. Field names are its JSON tags.
 *
 * It carries counts, not definitions: `relationCount` and `permissionCount`.
 * The definitions themselves are on the detail page's `ResourceTypeDetail`.
 */
export interface ResourceTypeSummary {
  id: string
  namespacePath: string
  name: string
  description?: string
  relationCount: number
  permissionCount: number
  createdAt: string
  updatedAt: string
}

/** Mirrors the Go `ResourceTypesListResponse`: PageMeta embedded beside items. */
export interface ResourceTypesList {
  items: ResourceTypeSummary[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 25

export function WardenResourceTypesPage() {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  const namespace = useNamespaceFilter(() => setPage(1))
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [deleting, setDeleting] = useState<ResourceTypeSummary | null>(null)

  // Trimmed, and absent when empty: an absent field is the honest way to say
  // "no filter", and a search of spaces is not one.
  const trimmedSearch = search.trim()
  const list = useQuery<ResourceTypesList>("resourceTypes.list", {
    ...namespace.param,
    ...(trimmedSearch ? { search: trimmedSearch } : {}),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })
  const create = useCommand<AckResponse>("resourceTypes.create")
  const remove = useCommand<AckResponse>("resourceTypes.delete")

  const createNamespace = namespace.value === "all" ? "" : namespace.value
  const missingName = name.trim() === ""

  function openCreate() {
    // Reset at open, not at close: the operator is about to read whatever
    // this dialog shows, so a failure from an earlier attempt must not greet
    // them, and neither must what they typed then.
    create.reset()
    setName("")
    setDescription("")
    setCreating(true)
  }

  async function confirmCreate() {
    if (missingName) return
    // Relations and permissions are deliberately not collected here: they are
    // written on the type's own page, where the server's expression
    // diagnostics have a row to point at. The description is absent when
    // empty rather than sent as "".
    const trimmedDescription = description.trim()
    const result = await create.execute({
      name: name.trim(),
      namespacePath: createNamespace,
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
    })
    // execute resolves undefined only when the client throws, so this is the
    // success check. A refused create must leave the dialog open with what
    // the operator typed.
    if (result === undefined) return
    setCreating(false)
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result === undefined) return
    setDeleting(null)
    // Deleting the only row on the last page leaves that page past the end of
    // the set. Step back one so the operator lands on rows that exist.
    if (page > 1 && (list.data?.items?.length ?? 0) <= 1) setPage(page - 1)
  }

  const columns: Column<ResourceTypeSummary>[] = [
    { id: "name", header: "Name", cell: (r) => r.name, className: "font-medium" },
    {
      id: "namespace",
      header: "Namespace",
      cell: (r) => <NamespaceCell path={r.namespacePath} />,
    },
    {
      id: "relations",
      header: "Relations",
      cell: (r) => r.relationCount,
      className: "tabular-nums",
    },
    {
      id: "permissions",
      header: "Permissions",
      cell: (r) => r.permissionCount,
      className: "tabular-nums",
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
        title="Resource types"
        actions={<Button onClick={openCreate}>New resource type</Button>}
      />

      <p className="text-sm text-muted-foreground">
        A resource type declares the relations an object can have and the
        permissions derived from them. Tuples name a type by its name, so a type
        cannot be renamed once it exists.
      </p>

      <FilterBar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setPage(1)
          },
          placeholder: "Search by name",
          label: "Search resource types",
        }}
        filters={[namespace.filterConfig]}
      />

      <QueryBoundary title="Resource types" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          // The server's total, never rows.length: rows is one page.
          const caption = `${data.total} ${data.total === 1 ? "resource type" : "resource types"}`
          return (
            <ResourceTable<ResourceTypeSummary>
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              caption={caption}
              emptyMessage={emptyListMessage(
                "resource types",
                trimmedSearch,
                namespace.value
              )}
              pagination={{ page, pageSize: data.limit, total: data.total }}
              onPageChange={setPage}
              rowActions={(r) => (
                <>
                  <PluginLink
                    to={`/resource-types/${r.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </PluginLink>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Delete ${r.name}`}
                    onClick={() => {
                      // Reset at open, not at close: the operator is about
                      // to read whatever this dialog shows for THIS type.
                      remove.reset()
                      setDeleting(r)
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

      {/* Both errors live inside their dialog. Base UI marks everything
          outside an open dialog inert and aria-hidden, so an alert on the
          page body is unreachable while the dialog that can fail is open. */}
      <ConfirmDialog
        open={creating}
        onOpenChange={(open) => !open && setCreating(false)}
        title="New resource type"
        destructive={false}
        confirmLabel="Create resource type"
        pending={create.loading}
        confirmDisabled={missingName}
        onConfirm={() => void confirmCreate()}
        description={
          <span className="flex flex-col gap-3">
            <span>
              Creating in{" "}
              {createNamespace === "" ? "the tenant root" : createNamespace}. The
              name cannot be changed later. Add its relations and permissions on
              the type&apos;s page once it exists.
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="resource-type-name">Name</Label>
              <Input
                id="resource-type-name"
                className="font-mono text-xs"
                placeholder="document"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="resource-type-description">
                Description (optional)
              </Label>
              <Input
                id="resource-type-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </span>
            <CommandAlert
              error={create.error}
              title="Could not create the resource type"
            />
          </span>
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              Permissions derived through this type stop resolving. A type that
              relation tuples still name as their object type cannot be deleted:
              the server refuses and says how many, and those tuples have to go
              first. This cannot be undone.
            </span>
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
