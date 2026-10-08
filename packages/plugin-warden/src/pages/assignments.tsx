import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState, type FormEvent, type ReactNode } from "react"
import {
  PluginLink,
  useCommand,
  useQuery,
  type QueryState,
} from "@forge-go/dashboard-plugin"
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
import { SubjectLink } from "../components/subject-link"
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

/**
 * Mirrors the Go `ExpiringResponse`. Not paged: the server returns at most
 * the limit it was asked for and says nothing about what lies past it.
 */
export interface ExpiringAssignments {
  items: AssignmentSummary[]
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

/**
 * What the expiring view asks for: the contract's cap (maxPageLimit). The
 * feed sorts by expiry and includes rows that lapsed and are still stored,
 * so those come first, and a smaller limit could be filled by them alone.
 */
const EXPIRING_LIMIT = 200

/**
 * The windows the expiring view offers, in hours. Seven days is the default,
 * and the same horizon subject pages use for "expires soon".
 */
const EXPIRING_WINDOWS = [
  { hours: 24, label: "24 hours" },
  { hours: 7 * 24, label: "7 days" },
  { hours: 30 * 24, label: "30 days" },
] as const

const DEFAULT_WINDOW_HOURS = 7 * 24

type View = "all" | "expiring"

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

/**
 * A role option names its namespace, `/` for the tenant root, because slugs
 * are unique only within a namespace. Two `admin` roles in different
 * namespaces would otherwise be identical options on a write path.
 */
function roleOptionLabel(r: { slug: string; namespacePath: string }) {
  return `${r.slug} (${r.namespacePath === "" ? "/" : r.namespacePath})`
}

/**
 * The scope of a row as the engine reads it, not as the fields look.
 *
 * The engine treats the resource type and id as one key. An assignment with
 * no resource type is global whatever its id (ListRolesForSubject keeps every
 * row whose ResourceType is empty), and one with a type but no id matches
 * only checks on a resource whose id is the empty string. assignments.create
 * refuses both half shapes, but rows written through the REST API can
 * already have them, so they are rendered for what they do.
 */
function ScopeCell({ a }: { a: AssignmentSummary }) {
  const type = a.resourceType ?? ""
  const id = a.resourceId ?? ""
  if (type === "" && id === "") return <NoneCell label="scope" />
  if (type === "") {
    return (
      <span className="flex flex-col gap-0.5">
        <span>Global</span>
        <span className="text-xs text-destructive">
          Warden ignores the resource id <span className="font-mono">{id}</span>{" "}
          without a resource type, so this assignment is not limited to one
          resource.
        </span>
      </span>
    )
  }
  if (id === "") {
    return (
      <span className="flex flex-col gap-0.5">
        <span className="font-mono text-xs">{type}</span>
        <span className="text-xs text-destructive">
          No resource id, so this matches only checks on a {type} whose id is
          empty.
        </span>
      </span>
    )
  }
  return <span className="font-mono text-xs">{`${type}:${id}`}</span>
}

function RoleSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  // The same read as the page's role filter, so the two share one cache
  // entry. The page reads it on every visit for that filter.
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
            {roleOptionLabel(r)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {roles.error && (
        <span className="text-destructive">
          Could not load roles: {roles.error.message}
        </span>
      )}
      {!roles.loading && !roles.error && items.length === 0 && (
        <span>
          No roles exist yet, so there is nothing to assign. Create one first.
        </span>
      )}
    </span>
  )
}

/**
 * Why the role filter cannot offer every role, if it cannot. One roles.list
 * read is capped at ROLE_PICKER_LIMIT, so a tenant with more roles than that
 * gets a filter that is missing some, and the page says so rather than
 * letting the operator conclude a role they cannot find does not exist.
 */
function RoleFilterNote({ roles }: { roles: QueryState<RolesList> }) {
  if (roles.error) {
    return (
      <p className="text-sm text-destructive">
        The role filter could not load roles: {roles.error.message}
      </p>
    )
  }
  const shown = roles.data?.items?.length ?? 0
  const total = roles.data?.total ?? 0
  if (total > shown) {
    return (
      <p className="text-sm text-muted-foreground">
        The role filter offers {shown} of the {total} roles.
      </p>
    )
  }
  return null
}

/**
 * What assignments.expiring returned, and what it means.
 *
 * The feed reads the whole tenant: the store filters by tenant and by expiry
 * before the end of the window, nothing else. So it takes no namespace, kind,
 * role or subject, and the page offers none. Its only lower bound is "has an
 * expiry", which is why rows that already lapsed and are still stored are in
 * it, sorted ahead of the rest.
 *
 * It is not paged and does not say whether more rows exist. When it returns
 * exactly the limit asked for, there may be more, and the page says so.
 */
function ExpiringList({
  windowHours,
  columns,
  rowActions,
}: {
  windowHours: number
  columns: Column<AssignmentSummary>[]
  rowActions: (a: AssignmentSummary) => ReactNode
}) {
  // The window is always above zero, so the server uses it as sent and the
  // sentence below names the window it actually read.
  const feed = useQuery<ExpiringAssignments>("assignments.expiring", {
    withinHours: windowHours,
    limit: EXPIRING_LIMIT,
  })
  const window =
    EXPIRING_WINDOWS.find((w) => w.hours === windowHours)?.label ??
    `${windowHours} hours`

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Assignments that expire within the next {window}, in every namespace of
        this tenant, earliest expiry first. Assignments that have already
        expired but are still stored are listed too, ahead of the rest: they
        grant nothing, and they stay until they are deleted. Maintenance deletes
        them: warden&apos;s background maintenance loop, or Run maintenance on
        the Config page for this tenant.
      </p>
      <QueryBoundary title="Expiring assignments" query={feed} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          // The server returns at most the limit and never says whether it
          // stopped there, so a full page is the only sign it may have.
          const cut = rows.length >= EXPIRING_LIMIT
          return (
            <div className="flex flex-col gap-2">
              <ResourceTable<AssignmentSummary>
                columns={columns}
                rows={rows}
                rowKey={(a) => a.id}
                caption={`${rows.length} ${rows.length === 1 ? "assignment" : "assignments"}`}
                // Lapsed rows are in the feed, so an empty one also means no
                // expired row is waiting to be deleted.
                emptyMessage={`No assignment expires within the next ${window}, and no expired assignment is still stored.`}
                rowActions={rowActions}
              />
              {cut && (
                <p className="text-sm text-muted-foreground">
                  Warden stopped at {EXPIRING_LIMIT} assignments, the most this
                  list asks for, so there may be more. The list is sorted by
                  expiry, so a missing assignment expires no earlier than the
                  last one shown. Expired assignments that are still stored
                  count toward the {EXPIRING_LIMIT}.
                </p>
              )}
            </div>
          )
        }}
      </QueryBoundary>
    </div>
  )
}

export function WardenAssignmentsPage() {
  // Which list the page shows. The expiring feed is a different read with
  // its own window, not a filter on the full list.
  const [view, setView] = useState<View>("all")
  const [windowHours, setWindowHours] = useState(DEFAULT_WINDOW_HOURS)
  // One-based, matching ResourceTable's PaginationState. Every filter below
  // resets it, because a page number carried across filters lands on page N
  // of a shorter set.
  const [page, setPage] = useState(1)
  const namespace = useNamespaceFilter(() => setPage(1))
  const [subjectKind, setSubjectKind] = useState("")
  const [roleId, setRoleId] = useState("")
  // Typed and applied are kept apart: the store matches the subject id
  // exactly, so a query per keystroke would be an empty table for every
  // prefix on the way to the whole id.
  const [subjectIdDraft, setSubjectIdDraft] = useState("")
  const [subjectId, setSubjectId] = useState("")
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [deleting, setDeleting] = useState<AssignmentSummary | null>(null)

  const list = useQuery<AssignmentsList>(
    "assignments.list",
    {
      ...namespace.param,
      // Unset filters are ABSENT, not empty strings.
      ...(subjectKind !== "" && { subjectKind }),
      ...(subjectId !== "" && { subjectId }),
      ...(roleId !== "" && { roleId }),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    { enabled: view === "all" }
  )
  // Every namespace's roles, because an assignment's role can sit in a
  // namespace above the assignment's own. The same read as the create
  // dialog's picker, so the two share one cache entry. Only the full list's
  // role filter needs it, so the expiring view does not read it.
  const roles = useQuery<RolesList>(
    "roles.list",
    { limit: ROLE_PICKER_LIMIT },
    { enabled: view === "all" }
  )
  const filtered = subjectKind !== "" || subjectId !== "" || roleId !== ""

  function applySubjectId(event: FormEvent) {
    event.preventDefault()
    setSubjectId(subjectIdDraft.trim())
    setPage(1)
  }

  function clearSubjectId() {
    setSubjectIdDraft("")
    setSubjectId("")
    setPage(1)
  }
  const create = useCommand<AckResponse>("assignments.create")
  const remove = useCommand<AckResponse>("assignments.delete")

  const createNamespace = namespace.value === "all" ? "" : namespace.value
  const expiresAt = expiryInstant(form.expires)
  // Both resource fields or neither, the rule assignments.create enforces.
  // Half a resource looks scoped and is not, so it cannot be confirmed.
  const halfScoped =
    (form.resourceType.trim() === "") !== (form.resourceId.trim() === "")

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
    if (expiresAt === null || halfScoped) return
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
    // The expiring view is not paged, so there it has nothing to step back.
    if (view === "all" && page > 1 && (list.data?.items?.length ?? 0) <= 1) {
      setPage(page - 1)
    }
  }

  const columns: Column<AssignmentSummary>[] = [
    {
      id: "subject",
      header: "Subject",
      cell: (a) => (
        <SubjectLink
          kind={a.subjectKind}
          id={a.subjectId}
          className="font-medium"
        />
      ),
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
      cell: (a) => <ScopeCell a={a} />,
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
      id: "grantedBy",
      header: "Granted by",
      cell: (a) =>
        a.grantedBy ? (
          <span className="font-mono text-xs">{a.grantedBy}</span>
        ) : (
          <NoneCell label="granter" />
        ),
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (a) => <Timestamp value={a.createdAt} label="created at" />,
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

  function deleteAction(a: AssignmentSummary) {
    return (
      <IconButton
        variant="destructive"
        onClick={() => {
          remove.reset()
          setDeleting(a)
        }}
        label={`Delete ${subjectLabel(a)} from ${a.roleSlug || a.roleId}`}
      />
    )
  }

  const viewFilter = {
    id: "view",
    label: "Show",
    value: view,
    options: [
      { label: "All assignments", value: "all" },
      { label: "Expiring soon", value: "expiring" },
    ],
    onChange: (next: string) =>
      setView(next === "expiring" ? "expiring" : "all"),
  }

  // The feed is about when rows lapse, so who granted them and when they
  // were made are left out.
  const expiringColumns = columns.filter(
    (c) => c.id !== "grantedBy" && c.id !== "createdAt"
  )

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
        To renew an expired assignment, delete it first: the store refuses the
        same binding as a duplicate while the expired row exists.
      </p>

      {view === "expiring" ? (
        <>
          <FilterBar
            filters={[
              viewFilter,
              {
                id: "within",
                label: "Within",
                value: String(windowHours),
                options: EXPIRING_WINDOWS.map((w) => ({
                  label: w.label,
                  value: String(w.hours),
                })),
                onChange: (next) => setWindowHours(Number(next)),
              },
            ]}
          />
          <ExpiringList
            windowHours={windowHours}
            columns={expiringColumns}
            rowActions={deleteAction}
          />
        </>
      ) : (
        <>
          <FilterBar
            filters={[
              viewFilter,
              namespace.filterConfig,
              {
                id: "subjectKind",
                label: "Subject kind",
                value: subjectKind,
                options: [
                  { label: "Any kind", value: "" },
                  ...SUBJECT_KINDS.map((kind) => ({
                    label: kind,
                    value: kind,
                  })),
                ],
                onChange: (next) => {
                  setSubjectKind(next)
                  setPage(1)
                },
              },
              {
                id: "role",
                label: "Role",
                value: roleId,
                options: [
                  { label: "Any role", value: "" },
                  ...(roles.data?.items ?? []).map((r) => ({
                    label: roleOptionLabel(r),
                    value: r.id,
                  })),
                ],
                onChange: (next) => {
                  setRoleId(next)
                  setPage(1)
                },
              },
            ]}
          />
          <RoleFilterNote roles={roles} />

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={applySubjectId}
          >
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="assignments-filter-subject-id">
                Filter by subject id
              </Label>
              <Input
                id="assignments-filter-subject-id"
                className="font-mono text-xs"
                placeholder="exact match"
                value={subjectIdDraft}
                onChange={(e) => setSubjectIdDraft(e.target.value)}
              />
            </span>
            <Button type="submit">Apply</Button>
            <IconButton
              type="button"
              variant="outline"
              onClick={clearSubjectId}
              label="Clear"
            />
          </form>

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
                  emptyMessage={
                    // The shared message knows only the namespace. With another
                    // filter on, "No assignments yet" would say nothing exists
                    // when the filter is what hid it.
                    filtered
                      ? "No assignments match these filters."
                      : emptyListMessage("assignments", "", namespace.value)
                  }
                  pagination={{ page, pageSize: data.limit, total: data.total }}
                  onPageChange={setPage}
                  rowActions={deleteAction}
                />
              )
            }}
          </QueryBoundary>
        </>
      )}

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
          form.roleId === "" ||
          form.subjectId.trim() === "" ||
          expiresAt === null ||
          halfScoped
        }
        onConfirm={() => void confirmCreate()}
        description={`Binding a subject to a role in ${createNamespace === "" ? "the tenant root" : createNamespace}. The assignment applies there and in every namespace below it. A role with a member cap refuses a new subject once it is full.`}
      >
        <RoleSelect
          value={form.roleId}
          onChange={(roleId) => setForm((f) => ({ ...f, roleId }))}
        />
        <div className="flex flex-col gap-1.5">
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assignment-subject-id">Subject id</Label>
          <Input
            id="assignment-subject-id"
            className="font-mono text-xs"
            value={form.subjectId}
            onChange={(e) =>
              setForm((f) => ({ ...f, subjectId: e.target.value }))
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assignment-resource-type">
            Resource type (optional)
          </Label>
          <Input
            id="assignment-resource-type"
            className="font-mono text-xs"
            value={form.resourceType}
            onChange={(e) =>
              setForm((f) => ({ ...f, resourceType: e.target.value }))
            }
          />
        </div>
        {/* The hints below sit outside the description now, so they carry
            its text style themselves. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assignment-resource-id">Resource id (optional)</Label>
          <Input
            id="assignment-resource-id"
            className="font-mono text-xs"
            value={form.resourceId}
            onChange={(e) =>
              setForm((f) => ({ ...f, resourceId: e.target.value }))
            }
          />
          <span className="text-xs/relaxed text-muted-foreground">
            Fill in both to limit the assignment to one resource, or leave both
            empty.
          </span>
          {halfScoped && (
            <span className="text-xs/relaxed text-destructive">
              {form.resourceType.trim() === ""
                ? "A resource id needs a resource type. Without one, warden ignores the id and the assignment is not limited to one resource."
                : "A resource type needs a resource id. Without one, the assignment matches only checks on a resource whose id is empty."}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assignment-expires">Expires (optional)</Label>
          <Input
            id="assignment-expires"
            type="datetime-local"
            value={form.expires}
            onChange={(e) =>
              setForm((f) => ({ ...f, expires: e.target.value }))
            }
          />
          <span className="text-xs/relaxed text-muted-foreground">
            Leave empty for a permanent assignment.
          </span>
        </div>
        <CommandAlert
          error={create.error}
          title="Could not create the assignment"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={
          deleting
            ? `Delete ${subjectLabel(deleting)} from ${deleting.roleSlug || deleting.roleId}?`
            : "Delete assignment?"
        }
        description={
          deleting?.expired
            ? "This assignment has already expired and grants nothing, so deleting it only removes the row."
            : "This binding is removed. The subject keeps this role only where another of its assignments grants it."
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete" />
      </ConfirmDialog>
    </section>
  )
}
