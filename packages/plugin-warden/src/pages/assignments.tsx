import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
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
import type { AckResponse, RolesList } from "./roles"

/**
 * Mirrors the Go `AssignmentSummary`. Field names are its JSON tags.
 *
 * `expired` is computed by the server against the same test the engine
 * applies when it resolves roles. The listing does not filter expired rows
 * but the engine does, so an expired row is shown and grants nothing.
 */
export interface AssignmentSummary {
  id: string
  namespacePath: string
  roleId: string
  roleSlug: string
  roleName: string
  subjectKind: string
  subjectId: string
  resourceType?: string
  resourceId?: string
  expiresAt?: string
  expired: boolean
  grantedBy?: string
  createdAt: string
}

/** Mirrors the Go `AssignmentsListResponse`: PageMeta embedded beside items. */
export interface AssignmentsList {
  items: AssignmentSummary[]
  total: number
  limit: number
  offset: number
}

/**
 * The closed set of subject kinds the server accepts. The engine compares the
 * kind verbatim, so a free-text "User" would store an assignment that no
 * check ever matches, and nothing would say so.
 */
const SUBJECT_KINDS = ["user", "api_key", "service", "service_acct"] as const

/** The most a single roles.list request may ask for (the server's cap). */
const ROLE_PICKER_LIMIT = 200

const PAGE_SIZE = 25

interface Form {
  roleId: string
  subjectKind: string
  subjectId: string
  resourceType: string
  resourceId: string
  /** A datetime-local value: local wall-clock time, no zone. */
  expires: string
}

const EMPTY_FORM: Form = {
  roleId: "",
  subjectKind: SUBJECT_KINDS[0],
  subjectId: "",
  resourceType: "",
  resourceId: "",
  expires: "",
}

/**
 * Turns a datetime-local value into the RFC3339 instant the contract parses.
 *
 * Returns undefined for an empty value (no expiry) and null for one that does
 * not parse. The two are different on purpose: dropping a malformed expiry
 * would quietly create a permanent grant, which is the opposite of what
 * somebody typing an expiry meant.
 */
function expiryInstant(local: string): string | undefined | null {
  if (local === "") return undefined
  const when = new Date(local)
  if (Number.isNaN(when.getTime())) return null
  return when.toISOString().replace(/\.\d{3}Z$/, "Z")
}

function subjectLabel(a: Pick<AssignmentSummary, "subjectKind" | "subjectId">) {
  return `${a.subjectKind}:${a.subjectId}`
}

function RoleSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  // Mounted only while the dialog is open, so the list is fetched when an
  // operator asks to create, not on every visit to the page.
  const roles = useQuery<RolesList>("roles.list", { limit: ROLE_PICKER_LIMIT })
  const items = roles.data?.items ?? []

  return (
    <span className="flex flex-col gap-1.5">
      <Label htmlFor="assignment-role">Role</Label>
      <NativeSelect
        id="assignment-role"
        className="w-full"
        value={value}
        disabled={roles.loading}
        onChange={(e) => onChange(e.target.value)}
      >
        <NativeSelectOption value="">
          {roles.loading ? "Loading roles…" : "Choose a role"}
        </NativeSelectOption>
        {items.map((r) => (
          <NativeSelectOption key={r.id} value={r.id}>
            {r.slug}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {roles.error && (
        <span className="text-destructive">
          Could not load roles: {roles.error.message}
        </span>
      )}
      {!roles.loading && !roles.error && items.length === 0 && (
        <span>No roles exist yet, so there is nothing to assign. Create one first.</span>
      )}
    </span>
  )
}

export function WardenAssignmentsPage() {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  const namespace = useNamespaceFilter(() => setPage(1))
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [deleting, setDeleting] = useState<AssignmentSummary | null>(null)

  const list = useQuery<AssignmentsList>("assignments.list", {
    ...namespace.param,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })
  const create = useCommand<AckResponse>("assignments.create")
  const remove = useCommand<AckResponse>("assignments.delete")

  const createNamespace = namespace.value === "all" ? "" : namespace.value
  const expiresAt = expiryInstant(form.expires)

  function openCreate() {
    // Reset at open, not at close: the operator is about to read whatever
    // this dialog shows, so a failure from an earlier attempt must not greet
    // them, and a half-typed form from then must not either.
    create.reset()
    setForm(EMPTY_FORM)
    setCreating(true)
  }

  async function confirmCreate() {
    // expiresAt null means the value did not parse. The button is disabled
    // then, but the guard stays: sending without it would create a permanent
    // grant out of a mistyped expiry.
    if (expiresAt === null) return
    const resourceType = form.resourceType.trim()
    const resourceId = form.resourceId.trim()
    // Optional fields are ABSENT when unset, not empty strings. The server
    // parses expiresAt, and "" is a different value from no value.
    const result = await create.execute({
      roleId: form.roleId,
      subjectKind: form.subjectKind,
      subjectId: form.subjectId.trim(),
      namespacePath: createNamespace,
      ...(resourceType !== "" && { resourceType }),
      ...(resourceId !== "" && { resourceId }),
      ...(expiresAt !== undefined && { expiresAt }),
    })
    // execute resolves undefined only when the client throws, so this is the
    // success check. A refused create, the member cap above all, must leave
    // the dialog open with what the operator typed.
    if (result === undefined) return
    setCreating(false)
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result === undefined) return
    setDeleting(null)
    // Deleting the only row on the last page leaves that page past the end
    // of the set. Step back one so the operator lands on rows that exist.
    if (page > 1 && (list.data?.items?.length ?? 0) <= 1) setPage(page - 1)
  }

  const columns: Column<AssignmentSummary>[] = [
    {
      id: "subject",
      header: "Subject",
      cell: (a) => subjectLabel(a),
      className: "font-medium",
    },
    {
      id: "role",
      header: "Role",
      cell: (a) => (
        <PluginLink
          to={`/roles/${a.roleId}`}
          className="underline underline-offset-4"
        >
          {/* The slug is what an operator reads. The id only shows when the
              server could not resolve the role, which is worth seeing. */}
          {a.roleSlug || a.roleId}
        </PluginLink>
      ),
      className: "font-mono text-xs",
    },
    {
      id: "scope",
      header: "Scope",
      cell: (a) => {
        const scope = [a.resourceType, a.resourceId].filter(Boolean).join(":")
        return scope === "" ? (
          <NoneCell label="scope" />
        ) : (
          <span className="font-mono text-xs">{scope}</span>
        )
      },
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (a) => <NamespaceCell path={a.namespacePath} />,
    },
    {
      id: "expires",
      header: "Expires",
      cell: (a) =>
        a.expiresAt ? (
          <Timestamp value={a.expiresAt} label="expiry" />
        ) : (
          // Never a blank cell: blank reads as loading or broken, and is
          // silent to a screen reader.
          <span>Never</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (a) =>
        a.expired ? (
          // Proportion, not meaning. Most assignments are live, so live
          // takes no badge and the exception is the one that shouts. An
          // operator asking why somebody still appears to have access is
          // looking for exactly this row.
          <Badge
            variant="destructive"
            title="The engine skips expired assignments, so this grants nothing"
          >
            Expired
          </Badge>
        ) : (
          <span className="sr-only">Active</span>
        ),
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Assignments"
        actions={<Button onClick={openCreate}>New assignment</Button>}
      />

      <p className="text-sm text-muted-foreground">
        Assignments cannot be edited, only created and deleted, because the
        store has no update. To change one, delete it and create another. An
        expired assignment grants nothing but stays listed until it is deleted.
      </p>

      <FilterBar filters={[namespace.filterConfig]} />

      <QueryBoundary title="Assignments" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          // The server's total, never rows.length: rows is one page.
          const caption = `${data.total} ${data.total === 1 ? "assignment" : "assignments"}`
          return (
            <ResourceTable<AssignmentSummary>
              columns={columns}
              rows={rows}
              rowKey={(a) => a.id}
              caption={caption}
              emptyMessage={emptyListMessage("assignments", "", namespace.value)}
              pagination={{ page, pageSize: data.limit, total: data.total }}
              onPageChange={setPage}
              rowActions={(a) => (
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={`Delete ${subjectLabel(a)} from ${a.roleSlug || a.roleId}`}
                  onClick={() => {
                    remove.reset()
                    setDeleting(a)
                  }}
                >
                  Delete
                </Button>
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
        title="New assignment"
        destructive={false}
        confirmLabel="Create assignment"
        pending={create.loading}
        confirmDisabled={
          form.roleId === "" || form.subjectId.trim() === "" || expiresAt === null
        }
        onConfirm={() => void confirmCreate()}
        description={
          <span className="flex flex-col gap-3">
            <span>
              Binding a subject to a role in{" "}
              {createNamespace === "" ? "the tenant root" : createNamespace}. A
              role with a member cap refuses a new subject once it is full.
            </span>
            <RoleSelect
              value={form.roleId}
              onChange={(roleId) => setForm((f) => ({ ...f, roleId }))}
            />
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="assignment-subject-kind">Subject kind</Label>
              <NativeSelect
                id="assignment-subject-kind"
                className="w-full"
                value={form.subjectKind}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subjectKind: e.target.value }))
                }
              >
                {SUBJECT_KINDS.map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {kind}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="assignment-subject-id">Subject id</Label>
              <Input
                id="assignment-subject-id"
                className="font-mono text-xs"
                value={form.subjectId}
                onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}
              />
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="assignment-resource-type">Resource type (optional)</Label>
              <Input
                id="assignment-resource-type"
                className="font-mono text-xs"
                value={form.resourceType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, resourceType: e.target.value }))
                }
              />
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="assignment-resource-id">Resource id (optional)</Label>
              <Input
                id="assignment-resource-id"
                className="font-mono text-xs"
                value={form.resourceId}
                onChange={(e) => setForm((f) => ({ ...f, resourceId: e.target.value }))}
              />
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="assignment-expires">Expires (optional)</Label>
              <Input
                id="assignment-expires"
                type="datetime-local"
                value={form.expires}
                onChange={(e) => setForm((f) => ({ ...f, expires: e.target.value }))}
              />
              <span>Leave empty for a permanent assignment.</span>
            </span>
            <CommandAlert error={create.error} title="Could not create the assignment" />
          </span>
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={
          deleting
            ? `Delete ${subjectLabel(deleting)} from ${deleting.roleSlug || deleting.roleId}?`
            : "Delete assignment?"
        }
        description={
          <span className="flex flex-col gap-2">
            <span>
              {deleting?.expired
                ? "This assignment has already expired and grants nothing, so deleting it only removes the row."
                : "The subject stops holding this role. Creating the assignment again restores it."}
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
