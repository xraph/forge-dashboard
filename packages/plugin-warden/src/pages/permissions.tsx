import { useState, type FormEvent } from "react"
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
import type { AckResponse } from "./roles"
import type { PermissionSummary, PermissionsList } from "./role-detail"

// Both are imported rather than redeclared, so the two pages that mirror the
// same Go DTOs cannot drift apart. Re-exported here for the barrel.
export type { PermissionSummary, PermissionsList }

const PAGE_SIZE = 25

/** The two fields the store matches exactly, held as typed text. */
interface ExactFields {
  resource: string
  action: string
}

const NO_EXACT: ExactFields = { resource: "", action: "" }

/** Only the fields somebody filled in, trimmed. Blank ones are absent. */
function exactParams(fields: ExactFields): Partial<ExactFields> {
  const out: Partial<ExactFields> = {}
  const resource = fields.resource.trim()
  const action = fields.action.trim()
  if (resource !== "") out.resource = resource
  if (action !== "") out.action = action
  return out
}

function CreatePermissionForm({
  namespacePath,
  onDone,
}: {
  namespacePath: string
  onDone: () => void
}) {
  const create = useCommand<AckResponse>("permissions.create")
  const [resource, setResource] = useState("")
  const [action, setAction] = useState("")
  const [description, setDescription] = useState("")

  // The name the evaluator will actually match on. Showing it as the
  // operator types removes the chance to disagree with it, which the
  // contract refuses anyway.
  const derived =
    resource.trim() && action.trim() ? `${resource.trim()}:${action.trim()}` : ""

  async function submit() {
    // No name field is sent at all: the contract derives it, so there is one
    // source of truth rather than two that can drift.
    //
    // Trimmed on the way out, not only for the disabled check: a resource of
    // " document" derives a name that no check will ever match.
    const result = await create.execute({
      resource: resource.trim(),
      action: action.trim(),
      description: description.trim() || undefined,
      namespacePath,
    })
    // execute() resolves undefined only when the client throws, so this is
    // the success check. A failed create must not close the form and throw
    // away what the operator typed.
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <CommandAlert error={create.error} title="Could not create the permission" />
      <p className="text-sm text-muted-foreground">
        A check matches on resource and action, not on the name, so the name
        below is derived from them rather than asked for.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="perm-resource">Resource</Label>
        <Input
          id="perm-resource"
          value={resource}
          onChange={(e) => setResource(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="perm-action">Action</Label>
        <Input id="perm-action" value={action} onChange={(e) => setAction(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="perm-description">Description</Label>
        <Input
          id="perm-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <p className="text-sm">
        Name:{" "}
        {derived ? (
          <span className="font-mono text-xs">{derived}</span>
        ) : (
          <span className="text-muted-foreground">fill in a resource and an action</span>
        )}
      </p>
      <div className="flex gap-2">
        <Button
          onClick={() => void submit()}
          disabled={create.loading || resource.trim() === "" || action.trim() === ""}
        >
          {create.loading ? "Creating…" : "Create permission"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={create.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function WardenPermissionsPage() {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  const namespace = useNamespaceFilter(() => setPage(1))
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<PermissionSummary | null>(null)
  // Typed and applied are kept apart: the store matches resource and action
  // exactly, so a query per keystroke would show an empty table for every
  // prefix on the way to the whole word.
  const [draft, setDraft] = useState<ExactFields>(NO_EXACT)
  const [applied, setApplied] = useState<ExactFields>(NO_EXACT)
  const appliedParams = exactParams(applied)

  const list = useQuery<PermissionsList>("permissions.list", {
    ...namespace.param,
    search: search || undefined,
    ...appliedParams,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  // Each one changes the result set, so each one goes back to page one, the
  // way the namespace filter and the search do.
  function apply(event: FormEvent) {
    event.preventDefault()
    setApplied(draft)
    setPage(1)
  }

  function clear() {
    setDraft(NO_EXACT)
    setApplied(NO_EXACT)
    setPage(1)
  }

  function emptyMessage(): string {
    // The shared message knows only search and namespace. With an exact
    // filter on, "No permissions yet" would say nothing exists when the
    // filter is what hid it.
    if (Object.keys(appliedParams).length > 0) return "No permissions match these filters."
    return emptyListMessage("permissions", search, namespace.value)
  }
  const remove = useCommand<AckResponse>("permissions.delete")

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

  const columns: Column<PermissionSummary>[] = [
    { id: "name", header: "Name", cell: (p) => p.name, className: "font-medium" },
    { id: "resource", header: "Resource", cell: (p) => p.resource },
    { id: "action", header: "Action", cell: (p) => p.action },
    {
      id: "namespace",
      header: "Namespace",
      cell: (p) => <NamespaceCell path={p.namespacePath} />,
    },
    {
      id: "flags",
      header: "Flags",
      cell: (p) =>
        // Most permissions are not system ones, so system is the minority
        // and the state somebody scanning for it is hunting.
        p.isSystem ? <Badge variant="destructive">system</Badge> : <NoneCell label="flags" />,
    },
    {
      id: "description",
      header: "Description",
      cell: (p) => p.description || <NoneCell label="description" />,
    },
    {
      id: "updatedAt",
      header: "Updated",
      cell: (p) => <Timestamp value={p.updatedAt} label="updated at" />,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Permissions"
        actions={
          !creating && <Button onClick={() => setCreating(true)}>New permission</Button>
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
          label: "Search permissions",
        }}
        filters={[namespace.filterConfig]}
      />

      <form className="flex flex-wrap items-end gap-3" onSubmit={apply}>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="permissions-filter-resource">Filter by resource</Label>
          <Input
            id="permissions-filter-resource"
            className="font-mono text-xs"
            placeholder="exact match"
            value={draft.resource}
            onChange={(e) => setDraft((d) => ({ ...d, resource: e.target.value }))}
          />
        </span>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="permissions-filter-action">Filter by action</Label>
          <Input
            id="permissions-filter-action"
            className="font-mono text-xs"
            placeholder="exact match"
            value={draft.action}
            onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
          />
        </span>
        <Button type="submit">Apply</Button>
        <Button type="button" variant="outline" onClick={clear}>
          Clear
        </Button>
      </form>

      {creating && (
        <CreatePermissionForm
          namespacePath={namespace.value === "all" ? "" : namespace.value}
          onDone={() => setCreating(false)}
        />
      )}

      <QueryBoundary title="Permissions" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          // Counts data.total, never rows.length: rows.length would say
          // "25 permissions" on page one of sixty.
          const caption = `${data.total} ${data.total === 1 ? "permission" : "permissions"}`
          return (
            <ResourceTable<PermissionSummary>
              columns={columns}
              rows={rows}
              rowKey={(p) => p.id}
              caption={caption}
              emptyMessage={emptyMessage()}
              pagination={{ page, pageSize: data.limit, total: data.total }}
              onPageChange={setPage}
              rowActions={(p) => (
                <>
                  <PluginLink
                    to={`/permissions/${p.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </PluginLink>
                  {/* No delete on a system permission: the contract refuses
                      it, so offering the button would promise a rejection. */}
                  {!p.isSystem && (
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => {
                        // Reset at open, not at close: the operator is about
                        // to read whatever this dialog shows for THIS
                        // permission, so a failure from a previous row must
                        // not be attributed to one they have not touched.
                        remove.reset()
                        setDeleting(p)
                      }}
                    >
                      Delete
                    </Button>
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
        description="This is refused while any role still grants it. Detach it from those roles first, and the error below will name them."
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete" />
      </ConfirmDialog>
    </section>
  )
}
