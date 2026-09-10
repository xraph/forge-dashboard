import { useState } from "react"
import {
  PluginSlot,
  defineSubPlugin,
  useCommand,
  useQuery,
  useSlotCount,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@forge-go/dashboard-kit/components/tabs"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/**
 * The organization sub-plugin. It both CONSUMES a slot on the auth
 * overview (`overview.widgets`, wired up in Task 8) and HOSTS three of its
 * own: `org.detail.sections`, `org.detail.tabs` and `org.create.fields`. This
 * file is the proof that hosting a slot is not something only the core
 * plugin can do - the same `PluginSlot` and `useSlotCount` a page consumes
 * elsewhere in the dashboard are what this page renders with.
 *
 * Verified against `plugins/organization/contract/`:
 *
 *   orgs.list                -> { organizations: OrgSummary[] }   no input, NO PAGING
 *   orgs.detail({ id })      -> OrgDetail
 *   orgs.create({ name, slug, logo? })  -> { ok, id? }
 *   orgs.update({ id, name?, logo? })   -> { ok }   name/logo are *string
 *   orgs.delete({ id })      -> { ok }
 *   orgs.members({ orgId })  -> { members: MemberSummary[] }   NO PAGING
 *   orgs.removeMember({ id }) -> { ok }   id is the MEMBER id, not the user id
 *
 * `CreateInvitation`, `ListInvitations` and `UpdateMemberRole` all exist in
 * `organization/service.go` and none of them is registered with the
 * dispatcher, so this page cannot show pending invitations or let an operator
 * change a member's role. The legacy templ page shows a pending-invitations
 * table; this one says, in the Members tab, that invitations still live in
 * the legacy dashboard, rather than rendering nothing and letting an operator
 * conclude there are none.
 */

export interface OrgSummary {
  id: string
  name: string
  slug: string
  createdAt: string
}

/** `orgs.detail`. OrgDetail embeds OrgSummary in Go, so the JSON is flat. */
export interface OrgDetail extends OrgSummary {
  appId?: string
  logo?: string
  metadata?: Record<string, string>
  updatedAt: string
}

export interface MemberSummary {
  id: string
  userId: string
  role: string
  createdAt: string
}

interface OrgListResponse {
  organizations: OrgSummary[]
}

interface MembersResponse {
  members: MemberSummary[]
}

interface AckResponse {
  ok: boolean
}

interface OrgCreateResponse {
  ok: boolean
  id?: string
}

/**
 * The slug the create form offers for a name.
 *
 * Lowercase, non-alphanumerics collapsed to single hyphens, no leading or
 * trailing hyphen. The Go side validates the slug and rejects anything else,
 * so a form that offers an invalid default is a form that fails on submit for
 * a reason the operator did not cause.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function formatMetadata(metadata?: Record<string, string>) {
  const entries = Object.entries(metadata ?? {})
  if (entries.length === 0) {
    return <span aria-label="No metadata">–</span>
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map(([key, value]) => (
        <li key={key} className="font-mono text-xs">
          <span>{key}</span>: <span>{value}</span>
        </li>
      ))}
    </ul>
  )
}

function RoleBadge({ role }: { role: string }) {
  if (role === "owner") return <Badge variant="default">Owner</Badge>
  if (role === "admin") return <Badge variant="secondary">Admin</Badge>
  return <Badge variant="outline">Member</Badge>
}

/* ------------------------------------------------------------------ list */

export function OrgListPage() {
  const query = useQuery<OrgListResponse>("orgs.list")

  const columns: Column<OrgSummary>[] = [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (org) => (
        <a
          href={`/@auth/organizations/${org.id}`}
          className="underline underline-offset-4"
        >
          {org.name}
        </a>
      ),
    },
    { id: "slug", header: "Slug", className: "font-mono text-xs", cell: (org) => org.slug },
    { id: "createdAt", header: "Created", cell: (org) => formatTimestamp(org.createdAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Organizations"
        actions={
          <a
            href="/@auth/organizations/create"
            className="text-sm underline underline-offset-4"
          >
            New organization
          </a>
        }
      />
      {/*
        orgs.list takes no input at all and answers its whole collection.
        There is no cursor, no limit and nothing here to page - a Next button
        would be a control for a server behaviour that does not exist.
      */}
      <QueryBoundary title="Organizations" query={query} skeletonRows={5}>
        {(data) => {
          const rows = data.organizations ?? []
          const caption = `${rows.length} ${rows.length === 1 ? "organization" : "organizations"}`
          return (
            <ResourceTable<OrgSummary>
              columns={columns}
              rows={rows}
              rowKey={(org) => org.id}
              caption={caption}
              emptyMessage="No organizations yet."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}

/* ---------------------------------------------------------------- detail */

function EditOrgForm({ org, onDone }: { org: OrgDetail; onDone: () => void }) {
  const update = useCommand<AckResponse>("orgs.update")
  const [name, setName] = useState(org.name)
  const [logo, setLogo] = useState(org.logo ?? "")

  // Diffed against the LOADED org, not an empty initial state, and built with
  // conditional assignment rather than `field: value || undefined`. The
  // latter leaves an `undefined`-valued key in the object - invisible once it
  // reaches the wire, but still present to `"logo" in payload`, which is
  // exactly the check `orgs.update`'s pointer semantics need to pass: an
  // untouched field must be ABSENT, and a field cleared to "" must be
  // PRESENT as "".
  const changed: Record<string, unknown> = { id: org.id }
  if (name !== org.name) changed.name = name
  if (logo !== (org.logo ?? "")) changed.logo = logo
  const dirty = Object.keys(changed).length > 1

  async function submit() {
    const result = await update.execute(changed)
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Edit organization</h2>
      <CommandAlert error={update.error} title="Could not save" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-edit-name">Name</Label>
        <Input id="org-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-edit-logo">Logo URL</Label>
        <Input id="org-edit-logo" value={logo} onChange={(e) => setLogo(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={update.loading || !dirty}>
          {update.loading ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={update.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function OrgMembers({ orgId }: { orgId: string }) {
  const query = useQuery<MembersResponse>("orgs.members", { orgId })
  const removeMember = useCommand<AckResponse>("orgs.removeMember")
  const [removing, setRemoving] = useState<MemberSummary | null>(null)

  async function confirmRemove() {
    if (!removing) return
    // The MEMBER id, not the user id. MemberSummary carries both and they
    // are different values; orgs.removeMember only accepts the former.
    const result = await removeMember.execute({ id: removing.id })
    if (result !== undefined) setRemoving(null)
  }

  const columns: Column<MemberSummary>[] = [
    {
      id: "userId",
      header: "User ID",
      className: "font-mono text-xs",
      cell: (member) => member.userId,
    },
    { id: "role", header: "Role", cell: (member) => <RoleBadge role={member.role} /> },
    { id: "createdAt", header: "Joined", cell: (member) => formatTimestamp(member.createdAt) },
  ]

  return (
    <div className="flex flex-col gap-3">
      <QueryBoundary title="Members" query={query} skeletonRows={3}>
        {(data) => {
          const members = data.members ?? []
          const caption = `${members.length} ${members.length === 1 ? "member" : "members"}`
          return (
            <ResourceTable<MemberSummary>
              columns={columns}
              rows={members}
              rowKey={(member) => member.id}
              caption={caption}
              emptyMessage="No members yet."
              rowActions={(member) => (
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={`Remove ${member.userId}`}
                  onClick={() => {
                    // Reset at open, not at close: one hook serves every row,
                    // so a failure left over from a different member's remove
                    // must not be attributed to one the operator has not
                    // touched yet.
                    removeMember.reset()
                    setRemoving(member)
                  }}
                >
                  Remove
                </Button>
              )}
            />
          )
        }}
      </QueryBoundary>

      {/*
        CreateInvitation, ListInvitations and UpdateMemberRole exist in
        organization/service.go but none is registered with the dispatcher.
        The legacy page shows a pending-invitations table; this one says so
        instead, because an operator who sees nothing here would conclude
        there are none.
      */}
      <p className="text-sm text-muted-foreground">
        Invitations are managed in the legacy dashboard until this contract
        exposes them here.
      </p>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.userId ?? ""}?`}
        description={
          <>
            <span>They lose access to this organization immediately.</span>
            {/*
              Base UI marks everything outside an open dialog inert and
              aria-hidden, so a CommandAlert rendered on the page body would be
              unreachable while this dialog is open, for a sighted operator
              and for assistive tech alike. It has to render inside the
              dialog itself, and as a `<span>` rather than CommandAlert's
              `<div>`: AlertDialogDescription renders a `<p>`, and a `<div>`
              is not valid `<p>` content.
            */}
            {removeMember.error && (
              <span role="alert" className="mt-2 block font-medium text-destructive">
                Could not remove: {removeMember.error.message} ({removeMember.error.code})
              </span>
            )}
          </>
        }
        confirmLabel="Remove"
        pending={removeMember.loading}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  )
}

function OrgTabs({ org, orgId }: { org: OrgDetail; orgId: string }) {
  const detailTabCount = useSlotCount("org.detail.tabs")
  const sectionsCount = useSlotCount("org.detail.sections")

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="members">Members</TabsTrigger>
        {/*
          Guarded so an empty slot draws nothing extra into the strip. A
          contribution here is expected to render its own trigger (and, for
          its content, its own panel keyed to the same value) - PluginSlot
          hands every contribution its own client and error boundary, and
          this task ships with nothing contributing to it, which is exactly
          the case this guard exists for.
        */}
        {detailTabCount > 0 && (
          <PluginSlot name="org.detail.tabs" params={{ orgId }} />
        )}
      </TabsList>

      {/*
        keepMounted on both: orgs.detail and orgs.members are read by two
        separate components so a slow member list never blanks out the org's
        own fields, and that only holds if the member list actually starts
        loading at the same time as the rest of the page rather than waiting
        for the operator to click over to it.
      */}
      <TabsContent value="overview" keepMounted>
        <div className="flex flex-col gap-4">
          <DescriptionList
            items={[
              {
                term: "Organization ID",
                value: <span className="font-mono text-xs">{org.id}</span>,
              },
              { term: "Slug", value: <span className="font-mono text-xs">{org.slug}</span> },
              { term: "Created", value: formatTimestamp(org.createdAt) },
              { term: "Updated", value: formatTimestamp(org.updatedAt) },
              ...(org.metadata && Object.keys(org.metadata).length > 0
                ? [{ term: "Metadata", value: formatMetadata(org.metadata) }]
                : []),
            ]}
          />
          {sectionsCount > 0 && (
            <PluginSlot name="org.detail.sections" params={{ orgId }} />
          )}
        </div>
      </TabsContent>
      <TabsContent value="members" keepMounted>
        <OrgMembers orgId={orgId} />
      </TabsContent>
    </Tabs>
  )
}

function OrgDetailBody({ orgId }: { orgId: string }) {
  const query = useQuery<OrgDetail>("orgs.detail", { id: orgId })
  const [editing, setEditing] = useState(false)

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Organization" query={query} skeletonRows={3}>
        {(org) => (
          <>
            <PageHeader
              title={org.name}
              description={org.slug}
              actions={
                !editing && <Button onClick={() => setEditing(true)}>Edit</Button>
              }
            />
            {editing && <EditOrgForm org={org} onDone={() => setEditing(false)} />}
            <OrgTabs org={org} orgId={orgId} />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}

export function OrgDetailPage({ params }: PluginPageProps) {
  const orgId = params.id

  // A detail route reached without an id is a link somebody built wrong, not
  // a server state, so this says so rather than issuing orgs.detail with an
  // undefined id and rendering whatever the server makes of that.
  if (!orgId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No organization selected.
      </p>
    )
  }

  return <OrgDetailBody orgId={orgId} />
}

/* ---------------------------------------------------------------- create */

export function OrgCreatePage() {
  const create = useCommand<OrgCreateResponse>("orgs.create")
  const createFieldsCount = useSlotCount("org.create.fields")

  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [logo, setLogo] = useState("")

  function onNameChange(value: string) {
    setName(value)
    // Once the operator has touched the slug themselves, it's theirs:
    // overwriting it here would lose what they just typed and they may not
    // notice before submitting.
    if (!slugTouched) setSlug(slugify(value))
  }

  function onSlugChange(value: string) {
    setSlug(value)
    setSlugTouched(true)
  }

  async function submit() {
    const result = await create.execute({
      name,
      slug,
      ...(logo ? { logo } : {}),
    })
    if (result === undefined) return
    setName("")
    setSlug("")
    setSlugTouched(false)
    setLogo("")
  }

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <PageHeader title="New organization" />
      <CommandAlert error={create.error} title="Could not create the organization" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-create-name">Name</Label>
        <Input
          id="org-create-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-create-slug">Slug</Label>
        <Input
          id="org-create-slug"
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, numbers and hyphens only. Filled in from the name
          until you edit it.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-create-logo">Logo URL</Label>
        <Input id="org-create-logo" value={logo} onChange={(e) => setLogo(e.target.value)} />
      </div>
      {createFieldsCount > 0 && <PluginSlot name="org.create.fields" />}
      <Button
        onClick={() => void submit()}
        disabled={create.loading || name.trim() === "" || slug.trim() === ""}
      >
        {create.loading ? "Creating…" : "Create organization"}
      </Button>
    </section>
  )
}

/* ------------------------------------------------------------ declaration */

export const organizationSubPlugin = defineSubPlugin({
  extension: "organization",
  host: "auth",
  label: "Organizations",
  nav: [{ label: "Organizations", to: "/organizations", group: "Identity", priority: 2 }],
  routes: [
    { path: "/organizations", element: OrgListPage },
    { path: "/organizations/create", element: OrgCreatePage },
    { path: "/organizations/:id", element: OrgDetailPage },
  ],
  // Reads nothing of its host's. Every intent it uses is its own.
  hostIntents: [],
})
