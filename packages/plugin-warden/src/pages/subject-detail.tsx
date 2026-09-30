import { Fragment, useId, useState, type FormEvent } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { checkColumns, type CheckLogList, type CheckSummary } from "../components/check-log"
import { NamespaceCell, type NamespacesResponse } from "../components/namespace-filter"
import type { ConfigDetail } from "./config"

/** Mirrors the Go `SubjectPermission`: one grant of a role. */
export interface SubjectPermission {
  name: string
  resource: string
  action: string
}

/**
 * Mirrors the Go `SubjectRole`. `via` is "assigned" or "inherited".
 * `inheritedBy` lists the slugs of the resolved roles whose parent is this
 * one: the roles the subject reached this role through.
 */
export interface SubjectRole {
  id: string
  slug: string
  name: string
  namespacePath: string
  via: string
  inheritedBy: string[]
  permissions: SubjectPermission[]
}

/**
 * Mirrors the Go `SubjectAssignment`. The resource fields and `expiresAt` are
 * absent, not empty, when the assignment has none.
 */
export interface SubjectAssignment {
  id: string
  namespacePath: string
  roleId: string
  roleSlug: string
  resourceType?: string
  resourceId?: string
  expiresAt?: string
  expired: boolean
  expiringSoon: boolean
}

/**
 * Mirrors the Go `SubjectRelation`. `subjectRelation` is absent unless the
 * tuple grants a userset (group:eng#member) rather than the subject itself.
 */
export interface SubjectRelation {
  id: string
  namespacePath: string
  objectType: string
  objectId: string
  relation: string
  subjectRelation?: string
}

/**
 * Mirrors the Go `SubjectPolicy`. `selectedBy` is "everyone", "kind", "id" or
 * "role:<slug>".
 */
export interface SubjectPolicy {
  id: string
  name: string
  effect: string
  priority: number
  namespacePath: string
  selectedBy: string
}

/** A section the server leaves empty when the viewer lacks its read grant. */
export type WithheldSection = "roles" | "relations" | "policies"

/**
 * Mirrors the Go `SubjectDetailResponse`. The server checks read on roles,
 * relations and policies separately from the assignment grant the intent
 * needs, and names each section it left empty in `withheld`. Recent checks
 * are not here: they need read_audit, so the page reads them through
 * checkLogs.list.
 */
export interface SubjectDetail {
  roles: SubjectRole[]
  assignments: SubjectAssignment[]
  assignmentsTruncated: boolean
  relations: SubjectRelation[]
  relationsTruncated: boolean
  policies: SubjectPolicy[]
  withheld: WithheldSection[]
}

/**
 * How many assignments and relations the server returns at most. The
 * truncation sentences name this number, and it is the server's
 * `subjectListCap`, so a change there is a change here.
 */
const SUBJECT_LIST_CAP = 200

/** How many recent checks the page asks checkLogs.list for, and shows at most. */
const RECENT_CHECKS = 10

const NOTE = "text-sm text-muted-foreground"
const LINK = "underline underline-offset-4"
const SLUG = "font-mono text-xs"

/** The root is shown, and typed, as "/". It is sent as "". */
function shown(path: string): string {
  return path === "" ? "/" : path
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** What a withheld section shows in place of its content. */
function withheldSentence(section: WithheldSection): string {
  return `You need read access to ${section} to see this section.`
}

/**
 * The route arrives URI-decoded, and kind and id are sent exactly as given.
 * Keyed on the subject so that moving to another subject starts again at the
 * root, rather than carrying the last subject's namespace over.
 */
export function WardenSubjectDetailPage({ params }: PluginPageProps) {
  const kind = params.kind as string
  const id = params.id as string
  return <SubjectAccess key={`${kind}\u0000${id}`} kind={kind} id={id} />
}

function SubjectAccess({ kind, id }: { kind: string; id: string }) {
  const inputId = useId()
  const listId = useId()
  // `namespace` is what was asked for and is "" at the root. `draft` is what
  // the input holds, which may be half a path.
  const [namespace, setNamespace] = useState("")
  const [draft, setDraft] = useState("/")

  const namespaces = useQuery<NamespacesResponse>("namespaces.list")
  // The list is a convenience. When it fails the input still takes any path,
  // and the root, which always exists, is still offered.
  const suggestions = (namespaces.data?.namespaces ?? [""]).map(shown)

  const detail = useQuery<SubjectDetail>("subjects.detail", {
    subjectKind: kind,
    subjectId: id,
    namespacePath: namespace,
  })
  // Only an explicit false turns a model off. A config that failed to load
  // says nothing, and the page must not claim a model is off on the strength
  // of an error.
  const config = useQuery<ConfigDetail>("config.detail")
  const abacOff = config.data?.abacEnabled === false
  const rebacOff = config.data?.rebacEnabled === false

  function apply(value: string) {
    const path = value.trim()
    setNamespace(path === "/" ? "" : path)
    setDraft(shown(path === "/" ? "" : path))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    apply(draft)
  }

  const at = shown(namespace)

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-mono text-lg font-medium">{`${kind}:${id}`}</h1>
        <div className="flex flex-wrap items-end gap-3">
          <form onSubmit={submit} className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>Namespace</Label>
            <Input
              id={inputId}
              className="font-mono text-xs"
              list={listId}
              placeholder="/"
              value={draft}
              onChange={(e) => {
                const next = e.target.value
                setDraft(next)
                // Picking a suggestion applies it at once. Typing does not:
                // "acme/en" on the way to "acme/eng" is not a namespace, and
                // asking about it would show the server's refusal.
                if (suggestions.includes(next)) apply(next)
              }}
              onBlur={() => apply(draft)}
            />
            <datalist id={listId}>
              {suggestions.map((ns) => (
                <option key={ns} value={ns} />
              ))}
            </datalist>
          </form>
          <PluginLink to="/playground" className={`text-sm ${LINK}`}>
            Open the playground
          </PluginLink>
        </div>
      </div>

      <QueryBoundary title="Subject access" query={detail} skeletonRows={4}>
        {(data) => {
          const withheld = new Set(data.withheld ?? [])
          return (
            <>
              {/* Inside the boundary: while a new namespace loads, or when the
                  read is refused, nothing is being shown at any namespace. Says
                  what depends on the namespace rather than what is shown, so
                  it stays true when roles or policies are withheld. */}
              <p className={NOTE}>
                {`Namespace ${at}: roles and policies depend on it. Assignments, relations and recent checks cover every namespace.`}
              </p>
              <RolesSection
                roles={data.roles ?? []}
                at={at}
                assignmentsTruncated={data.assignmentsTruncated}
                withheld={withheld.has("roles")}
              />
              <AssignmentsSection
                rows={data.assignments ?? []}
                truncated={data.assignmentsTruncated}
              />
              <RelationsSection
                rows={data.relations ?? []}
                truncated={data.relationsTruncated}
                subject={`${kind}:${id}`}
                rebacOff={rebacOff}
                withheld={withheld.has("relations")}
              />
              <PoliciesSection
                rows={data.policies ?? []}
                at={at}
                abacOff={abacOff}
                withheld={withheld.has("policies")}
              />
            </>
          )
        }}
      </QueryBoundary>
      {/* Its own read, outside the subject boundary: the check log needs
          read_audit, and a viewer without it still sees everything above. */}
      <RecentChecksSection kind={kind} id={id} />
    </section>
  )
}

/** A section heading with the withheld sentence in place of its content. */
function WithheldNotice({ heading, section }: { heading: string; section: WithheldSection }) {
  return (
    <section className="flex flex-col gap-3">
      <Heading>{heading}</Heading>
      <p className={NOTE}>{withheldSentence(section)}</p>
    </section>
  )
}

function Heading({ children }: { children: string }) {
  return <h2 className="text-sm font-medium">{children}</h2>
}

/** Mono chips, as the role and permission pages draw a permission name. */
function PermissionChips({ permissions }: { permissions: SubjectPermission[] }) {
  if (permissions.length === 0) return <NoneCell label="permissions" />
  return (
    <span className="flex flex-wrap gap-1">
      {permissions.map((p) => (
        <Badge key={p.name} variant="outline" className="font-mono">
          {p.name}
        </Badge>
      ))}
    </span>
  )
}

/** Role slugs in mono, joined by ", ". */
function Slugs({ slugs }: { slugs: string[] }) {
  return (
    <>
      {slugs.map((slug, i) => (
        <Fragment key={slug}>
          {i > 0 && ", "}
          <span className={SLUG}>{slug}</span>
        </Fragment>
      ))}
    </>
  )
}

function RolesSection({
  roles,
  at,
  assignmentsTruncated,
  withheld,
}: {
  roles: SubjectRole[]
  at: string
  assignmentsTruncated: boolean
  withheld: boolean
}) {
  if (withheld) return <WithheldNotice heading={`Roles at ${at}`} section="roles" />
  const columns: Column<SubjectRole>[] = [
    {
      id: "role",
      header: "Role",
      cell: (r) => (
        <PluginLink to={`/roles/${r.id}`} className={`${LINK} ${SLUG}`}>
          {r.slug}
        </PluginLink>
      ),
      className: "font-medium",
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (r) => <NamespaceCell path={r.namespacePath} />,
    },
    {
      id: "via",
      header: "How it was reached",
      cell: (r) => {
        const by = r.inheritedBy ?? []
        if (r.via === "assigned") {
          if (by.length === 0) return "assigned"
          return (
            <>
              assigned, also held through <Slugs slugs={by} />
            </>
          )
        }
        if (by.length === 0) return "inherited"
        return (
          <>
            held through <Slugs slugs={by} />
          </>
        )
      },
    },
    {
      id: "permissions",
      header: "Permissions",
      cell: (r) => <PermissionChips permissions={r.permissions ?? []} />,
    },
  ]
  return (
    <section className="flex flex-col gap-3">
      <Heading>{`Roles at ${at}`}</Heading>
      <ResourceTable<SubjectRole>
        columns={columns}
        rows={roles}
        rowKey={(r) => r.id}
        caption={roles.length > 0 ? count(roles.length, "role", "roles") : undefined}
        emptyMessage={`No role reaches this subject at ${at}. Assignments for a single resource, in another namespace, or already expired are listed below.`}
      />
      <p className={NOTE}>
        {`Roles assigned for one resource only ${
          assignmentsTruncated ? "are among the assignments" : "are listed under assignments"
        }. They grant only for checks on that resource.`}
      </p>
    </section>
  )
}

function AssignmentsSection({
  rows,
  truncated,
}: {
  rows: SubjectAssignment[]
  truncated: boolean
}) {
  const columns: Column<SubjectAssignment>[] = [
    {
      id: "role",
      header: "Role",
      cell: (a) =>
        a.roleSlug ? (
          <PluginLink to={`/roles/${a.roleId}`} className={`${LINK} ${SLUG}`}>
            {a.roleSlug}
          </PluginLink>
        ) : (
          <span className="font-mono text-xs">{a.roleId}</span>
        ),
      className: "font-medium",
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (a) => <NamespaceCell path={a.namespacePath} />,
    },
    {
      id: "resource",
      header: "Resource",
      // The engine reads an assignment as resource-scoped by its type alone,
      // so a row with no type is for every resource whatever its id says.
      cell: (a) =>
        a.resourceType ? (
          <span className="font-mono text-xs">{`${a.resourceType}:${a.resourceId ?? ""}`}</span>
        ) : (
          "every resource"
        ),
    },
    {
      id: "expires",
      header: "Expires",
      cell: (a) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Timestamp value={a.expiresAt} label="expiry" />
          {a.expiringSoon && <Badge variant="secondary">expires soon</Badge>}
          {a.expired && <Badge variant="destructive">expired</Badge>}
        </span>
      ),
    },
  ]
  return (
    <section className="flex flex-col gap-3">
      <Heading>Assignments</Heading>
      <ResourceTable<SubjectAssignment>
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        caption={rows.length > 0 ? count(rows.length, "assignment", "assignments") : undefined}
        emptyMessage="This subject has no assignments in any namespace."
      />
      {rows.some((a) => a.expired) && (
        <p className={NOTE}>
          An expired assignment grants nothing. It stays listed until maintenance removes
          it.
        </p>
      )}
      {truncated && (
        <p className={NOTE}>{`Showing the first ${SUBJECT_LIST_CAP} assignments.`}</p>
      )}
    </section>
  )
}

function RelationsSection({
  rows,
  truncated,
  subject,
  rebacOff,
  withheld,
}: {
  rows: SubjectRelation[]
  truncated: boolean
  subject: string
  rebacOff: boolean
  withheld: boolean
}) {
  if (withheld) return <WithheldNotice heading="Relations" section="relations" />
  const columns: Column<SubjectRelation>[] = [
    {
      id: "object",
      header: "Object",
      cell: (t) => (
        <span className="font-mono text-xs">{`${t.objectType}:${t.objectId}`}</span>
      ),
    },
    { id: "relation", header: "Relation", cell: (t) => t.relation, className: SLUG },
    {
      id: "subject",
      header: "Subject",
      // A userset tuple (group:eng#member) grants the members of the subject,
      // not the subject itself, so its subject relation follows the subject.
      cell: (t) => (
        <span className="font-mono text-xs">
          {subject}
          {t.subjectRelation && <span className="font-mono text-xs">{`#${t.subjectRelation}`}</span>}
        </span>
      ),
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (t) => <NamespaceCell path={t.namespacePath} />,
    },
  ]
  return (
    <section className="flex flex-col gap-3">
      <Heading>Relations</Heading>
      <ResourceTable<SubjectRelation>
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        caption={rows.length > 0 ? count(rows.length, "relation", "relations") : undefined}
        emptyMessage="No relation tuple has this subject as its subject."
      />
      {rebacOff ? (
        <p className={NOTE}>Relation checks are off, so no relation grants anything.</p>
      ) : (
        <p className={NOTE}>
          Direct relation tuples only. A relation reached through a group, a parent object or
          a resource type's permission expression is found by the check itself; try it in the
          playground.
        </p>
      )}
      {truncated && (
        <p className={NOTE}>{`Showing the first ${SUBJECT_LIST_CAP} relations.`}</p>
      )}
    </section>
  )
}

/** How a policy's subject matchers select this subject, as the server says it. */
function selectedBy(how: string): string {
  if (how === "everyone") return "every subject"
  if (how === "kind") return "subjects of this kind"
  if (how === "id") return "this subject"
  if (how.startsWith("role:")) return `holders of ${how.slice("role:".length)}`
  return how
}

function PoliciesSection({
  rows,
  at,
  abacOff,
  withheld,
}: {
  rows: SubjectPolicy[]
  at: string
  abacOff: boolean
  withheld: boolean
}) {
  const heading = `Policies that select this subject at ${at}`
  if (withheld) return <WithheldNotice heading={heading} section="policies" />
  const columns: Column<SubjectPolicy>[] = [
    {
      id: "name",
      header: "Policy",
      cell: (p) => (
        <PluginLink to={`/policies/${p.id}`} className={LINK}>
          {p.name}
        </PluginLink>
      ),
      className: "font-medium",
    },
    {
      id: "effect",
      header: "Effect",
      // As the policy page draws it: colour means "this overrides", so only
      // Deny carries it, and anything but exactly "allow" is a deny to the
      // evaluator.
      cell: (p) =>
        p.effect === "allow" ? (
          <span className="text-foreground">Allow</span>
        ) : (
          <span className="text-destructive">Deny</span>
        ),
    },
    { id: "priority", header: "Priority", cell: (p) => String(p.priority) },
    {
      id: "namespace",
      header: "Namespace",
      cell: (p) => <NamespaceCell path={p.namespacePath} />,
    },
    { id: "selects", header: "How it selects", cell: (p) => selectedBy(p.selectedBy) },
  ]
  return (
    <section className="flex flex-col gap-3">
      <Heading>{heading}</Heading>
      {abacOff && (
        <p className={NOTE}>Policy evaluation is off, so no policy applies to any check.</p>
      )}
      <p className={NOTE}>
        A policy that selects this subject only through a role it holds for one resource
        selects it only on checks for that resource, and is not listed here.
      </p>
      <ResourceTable<SubjectPolicy>
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        caption={rows.length > 0 ? count(rows.length, "policy", "policies") : undefined}
        emptyMessage={`No policy in effect at ${at} selects this subject through its kind, its id or a role it holds for every resource.`}
      />
      {/* With policy evaluation off no policy applies, so saying their
          conditions decide would contradict the note above. */}
      {!abacOff && (
        <p className={NOTE}>
          {"Selecting is not applying. Each policy's actions, resources, window and conditions decide whether it applies to a given check."}
        </p>
      )}
    </section>
  )
}

function RecentChecksSection({ kind, id }: { kind: string; id: string }) {
  const checks = useQuery<CheckLogList>("checkLogs.list", {
    subjectKind: kind,
    subjectId: id,
    limit: RECENT_CHECKS,
  })
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading>Recent checks</Heading>
        <PluginLink to="/check-log" className={`text-sm ${LINK}`}>
          Open the check log
        </PluginLink>
      </div>
      <QueryBoundary title="Recent checks" query={checks} skeletonRows={3}>
        {(data) => {
          // The check log filter reads an empty kind as any kind, so keep only
          // rows naming exactly this subject.
          const rows = (data.items ?? [])
            .filter((c) => c.subjectKind === kind && c.subjectId === id)
            .slice(0, RECENT_CHECKS)
          return (
            <ResourceTable<CheckSummary>
              columns={checkColumns()}
              rows={rows}
              rowKey={(c) => c.id}
              caption={rows.length > 0 ? count(rows.length, "check", "checks") : undefined}
              emptyMessage="No logged check names this subject."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
