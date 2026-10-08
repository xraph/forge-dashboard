import { useRef, useState } from "react"
import {
  Building2,
  MailPlus,
  Pencil,
  Trash2,
  UsersRound,
} from "@forge-go/dashboard-kit/icons"
import {
  PluginLink,
  PluginSlot,
  defineSubPlugin,
  useCommand,
  useNavigateTo,
  useQuery,
  useSlotCount,
  useSlotEntries,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "../components/presentation"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "../components/presentation"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@forge-go/dashboard-kit/components/tabs"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { Panel } from "../components/presentation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"

/**
 * The organization sub-plugin. It both CONSUMES a slot on the auth
 * overview (`overview.widgets`, wired up in Task 8) and HOSTS three of its
 * own: `org.detail.summary`, `org.detail.sections`, `org.detail.tabs` and
 * `org.create.fields`. This
 * file is the proof that hosting a slot is not something only the core
 * plugin can do: the same `PluginSlot`, `useSlotCount` and `useSlotEntries`
 * a page consumes elsewhere in the dashboard are what this page renders with.
 *
 * Verified against `plugins/organization/contract/`:
 *
 *   orgs.list                -> { organizations: OrgSummary[] }   no input, NO PAGING
 *   orgs.detail({ id })      -> OrgDetail
 *   orgs.create({ name, slug, logo? })  -> { ok, id? }
 *   orgs.update({ id, name?, logo? })   -> { ok }   name/logo are *string
 *   orgs.delete({ id })      -> { ok }
 *   orgs.members({ orgId })  -> { members: MemberSummary[] }   NO PAGING
 *   orgs.addMember({ orgId, userId?, email?, role }) -> { ok, id }
 *   orgs.removeMember({ id }) -> { ok }   id is the MEMBER id, not the user id
 *   orgs.invitations({ orgId }) -> { invitations: InvitationSummary[] }
 *   orgs.createInvitation({ orgId, email, role }) -> InvitationSummary + token
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

interface InvitationSummary {
  id: string
  email: string
  role: string
  status: string
  createdAt: string
  expiresAt: string
}

interface InvitationsResponse {
  invitations: InvitationSummary[]
}

interface CreatedInvitation extends InvitationSummary {
  token: string
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
        <PluginLink
          to={`/organizations/${org.id}`}
          className="underline underline-offset-4"
        >
          {org.name}
        </PluginLink>
      ),
    },
    {
      id: "slug",
      header: "Slug",
      className: "font-mono text-xs",
      cell: (org) => org.slug,
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (org) => formatTimestamp(org.createdAt),
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Organizations"
        actions={
          <PluginLink
            to="/organizations/create"
            className="text-sm underline underline-offset-4"
          >
            New organization
          </PluginLink>
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
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Edit organization</DialogTitle>
        <DialogDescription>
          Update the name or logo shown for this organization.
        </DialogDescription>
      </DialogHeader>
      <CommandAlert error={update.error} title="Could not save" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-edit-name">Name</Label>
        <Input
          id="org-edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-edit-logo">Logo URL</Label>
        <Input
          id="org-edit-logo"
          value={logo}
          onChange={(e) => setLogo(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={update.loading}>
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={update.loading || !dirty || name.trim().length === 0}
        >
          {update.loading ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function OrgMembers({ orgId }: { orgId: string }) {
  const query = useQuery<MembersResponse>("orgs.members", { orgId })
  const invitationsQuery = useQuery<InvitationsResponse>("orgs.invitations", {
    orgId,
  })
  const addMember = useCommand<AckResponse>("orgs.addMember")
  const createInvitation = useCommand<CreatedInvitation>(
    "orgs.createInvitation"
  )
  const removeMember = useCommand<AckResponse>("orgs.removeMember")
  const [removing, setRemoving] = useState<MemberSummary | null>(null)
  const [adding, setAdding] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [memberIdentifier, setMemberIdentifier] = useState("")
  const [email, setEmail] = useState("")
  const [addRole, setAddRole] = useState("member")
  const [inviteRole, setInviteRole] = useState("member")
  const [created, setCreated] = useState<CreatedInvitation | null>(null)
  const [copied, setCopied] = useState(false)

  async function submitMember() {
    const identifier = memberIdentifier.trim()
    const result = await addMember.execute({
      orgId,
      ...(identifier.includes("@")
        ? { email: identifier }
        : { userId: identifier }),
      role: addRole,
    })
    if (result !== undefined) {
      setAdding(false)
      setMemberIdentifier("")
      setAddRole("member")
    }
  }

  async function submitInvitation() {
    const result = await createInvitation.execute({
      orgId,
      email: email.trim(),
      role: inviteRole,
    })
    if (result !== undefined) setCreated(result)
  }

  async function copyToken() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function closeInvitation() {
    setInviting(false)
    setCreated(null)
    setEmail("")
    setInviteRole("member")
    setCopied(false)
  }

  async function confirmRemove() {
    if (!removing) return
    // The MEMBER id, not the user id. MemberSummary carries both and they
    // are different values; orgs.removeMember only accepts the former.
    const result = await removeMember.execute({ id: removing.id })
    if (result !== undefined) setRemoving(null)
  }

  function removeAction(member: MemberSummary) {
    return (
      <Button
        variant="destructive"
        size="sm"
        aria-label={`Remove ${member.userId}`}
        onClick={() => {
          removeMember.reset()
          setRemoving(member)
        }}
      >
        Remove
      </Button>
    )
  }

  const columns: Column<MemberSummary>[] = [
    {
      id: "userId",
      header: "User ID",
      className: "font-mono text-xs",
      cell: (member) => (
        <PluginLink
          to={`/users/${member.userId}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {member.userId}
        </PluginLink>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (member) => <RoleBadge role={member.role} />,
    },
    {
      id: "createdAt",
      header: "Joined",
      cell: (member) => formatTimestamp(member.createdAt),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Members</h3>
          <p className="text-xs text-muted-foreground">
            Add an existing user by email or ID, or invite someone new.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              addMember.reset()
              setAdding(true)
            }}
          >
            Add member
          </Button>
          <Button
            size="sm"
            onClick={() => {
              createInvitation.reset()
              setInviting(true)
            }}
          >
            Create invitation
          </Button>
        </div>
      </div>
      <QueryBoundary title="Members" query={query} skeletonRows={3}>
        {(data) => {
          const members = data.members ?? []
          const caption = `${members.length} ${members.length === 1 ? "member" : "members"}`
          return members.length === 0 ? (
            <ZeroState
              title="No members yet"
              body="Add an existing user or create an invitation to bring someone into this organization."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    addMember.reset()
                    setAdding(true)
                  }}
                >
                  Add member
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid gap-2 sm:hidden">
                <p className="text-xs text-muted-foreground">{caption}</p>
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <PluginLink
                        to={`/users/${member.userId}`}
                        className="block font-mono text-xs font-medium break-all underline-offset-4 hover:underline"
                      >
                        {member.userId}
                      </PluginLink>
                      <div className="flex flex-wrap items-center gap-2">
                        <RoleBadge role={member.role} />
                        <span className="text-xs text-muted-foreground">
                          Joined {formatTimestamp(member.createdAt)}
                        </span>
                      </div>
                    </div>
                    {removeAction(member)}
                  </div>
                ))}
              </div>
              <div className="hidden sm:block">
                <ResourceTable<MemberSummary>
                  columns={columns}
                  rows={members}
                  rowKey={(member) => member.id}
                  caption={caption}
                  emptyMessage="No members yet."
                  rowActions={removeAction}
                />
              </div>
            </>
          )
        }}
      </QueryBoundary>

      <h3 className="pt-2 text-sm font-semibold">Invitations</h3>
      <QueryBoundary
        title="Invitations"
        query={invitationsQuery}
        skeletonRows={2}
      >
        {(data) => {
          const invitations = data.invitations ?? []
          if (invitations.length === 0)
            return (
              <ZeroState
                title="No invitations yet"
                body="Create an invitation for someone who needs access to this organization."
                illustration={<MailPlus className="size-6 stroke-[1.5]" />}
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      createInvitation.reset()
                      setInviting(true)
                    }}
                  >
                    Create invitation
                  </Button>
                }
              />
            )
          const columns: Column<InvitationSummary>[] = [
            {
              id: "email",
              header: "Email",
              className: "font-medium",
              cell: (inv) => inv.email,
            },
            {
              id: "role",
              header: "Role",
              cell: (inv) => <RoleBadge role={inv.role} />,
            },
            {
              id: "status",
              header: "Status",
              cell: (inv) => (
                <Badge
                  variant={inv.status === "pending" ? "secondary" : "outline"}
                >
                  {inv.status}
                </Badge>
              ),
            },
            {
              id: "expiresAt",
              header: "Expires",
              cell: (inv) => formatTimestamp(inv.expiresAt),
            },
          ]
          return (
            <>
              <div className="grid gap-2 sm:hidden">
                {invitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="space-y-2 rounded-md border bg-card p-3 text-sm"
                  >
                    <div className="font-medium break-all">{inv.email}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <RoleBadge role={inv.role} />
                      <Badge
                        variant={
                          inv.status === "pending" ? "secondary" : "outline"
                        }
                      >
                        {inv.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Expires {formatTimestamp(inv.expiresAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden sm:block">
                <ResourceTable
                  columns={columns}
                  rows={invitations}
                  rowKey={(inv) => inv.id}
                  caption={`${invitations.length} ${invitations.length === 1 ? "invitation" : "invitations"}`}
                  emptyMessage="No invitations yet."
                />
              </div>
            </>
          )
        }}
      </QueryBoundary>

      <Dialog open={adding} onOpenChange={(open) => !open && setAdding(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>
              Add an existing user in this app to the organization.
            </DialogDescription>
          </DialogHeader>
          <CommandAlert error={addMember.error} title="Could not add member" />
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="org-member-user">Email or user ID</Label>
              <Input
                id="org-member-user"
                value={memberIdentifier}
                onChange={(event) => setMemberIdentifier(event.target.value)}
                placeholder="person@example.com"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="org-member-role">Role</Label>
              <NativeSelect
                id="org-member-role"
                value={addRole}
                onChange={(event) => setAddRole(event.target.value)}
              >
                <NativeSelectOption value="member">Member</NativeSelectOption>
                <NativeSelectOption value="admin">Admin</NativeSelectOption>
                <NativeSelectOption value="owner">Owner</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={!memberIdentifier.trim() || addMember.loading}
              onClick={() => void submitMember()}
            >
              {addMember.loading ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={inviting}
        onOpenChange={(open) => !open && closeInvitation()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {created ? "Invitation created" : "Create invitation"}
            </DialogTitle>
            <DialogDescription>
              {created
                ? "Copy this token now. It will not be shown again."
                : "Create an invitation token for an email address. Authsome does not send an email."}
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="grid gap-3 text-sm">
              <p>
                Share the token with{" "}
                <span className="font-medium">{created.email}</span> through
                your application. It expires{" "}
                {formatTimestamp(created.expiresAt)}.
              </p>
              <div
                className="rounded-md border bg-muted/30 p-3 font-mono text-xs break-all select-all"
                aria-label="Invitation token"
              >
                {created.token}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeInvitation}>
                  Done
                </Button>
                <Button onClick={() => void copyToken()}>
                  {copied ? "Copied" : "Copy token"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <CommandAlert
                error={createInvitation.error}
                title="Could not create invitation"
              />
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="org-invite-email">Email</Label>
                  <Input
                    id="org-invite-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="person@example.com"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="org-invite-role">Role</Label>
                  <NativeSelect
                    id="org-invite-role"
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value)}
                  >
                    <NativeSelectOption value="member">
                      Member
                    </NativeSelectOption>
                    <NativeSelectOption value="admin">Admin</NativeSelectOption>
                    <NativeSelectOption value="owner">Owner</NativeSelectOption>
                  </NativeSelect>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeInvitation}>
                  Cancel
                </Button>
                <Button
                  disabled={!email.trim() || createInvitation.loading}
                  onClick={() => void submitInvitation()}
                >
                  {createInvitation.loading ? "Creating…" : "Create invitation"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.userId ?? ""}?`}
        description="They lose access to this organization immediately."
        confirmLabel="Remove"
        pending={removeMember.loading}
        onConfirm={() => void confirmRemove()}
      >
        {/*
          Base UI marks everything outside an open dialog inert and
          aria-hidden, so a CommandAlert rendered on the page body would be
          unreachable while this dialog is open, for a sighted operator
          and for assistive tech alike. It has to render inside the
          dialog itself.
        */}
        <CommandAlert title="Could not remove" error={removeMember.error} />
      </ConfirmDialog>
    </div>
  )
}

function OrgPeopleSummary({
  orgId,
  onOpenMembers,
}: {
  orgId: string
  onOpenMembers: () => void
}) {
  const query = useQuery<MembersResponse>("orgs.members", { orgId })

  return (
    <Panel
      title="People"
      actions={
        <Button variant="outline" size="sm" onClick={onOpenMembers}>
          View members
        </Button>
      }
    >
      <QueryBoundary title="Members" query={query} skeletonRows={1}>
        {(data) => {
          const members = data.members ?? []
          return (
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
              >
                <UsersRound className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-lg leading-tight font-semibold tabular-nums">
                  {members.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  {members.length === 1 ? "member" : "members"} in this
                  organization
                </div>
              </div>
            </div>
          )
        }}
      </QueryBoundary>
    </Panel>
  )
}

function OrgTabs({ org, orgId }: { org: OrgDetail; orgId: string }) {
  const membersTabRef = useRef<HTMLButtonElement>(null)
  const contributedTabRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {}
  )
  const sectionsCount = useSlotCount("org.detail.sections")
  const summaryCount = useSlotCount("org.detail.summary")
  /*
    A tab is a trigger in one place and a panel in another, so a contribution
    cannot be one on its own: dropping `PluginSlot` into the `TabsList`
    rendered the contribution's CONTENT into the tab strip and no tab ever
    appeared. That is what this page did until `useSlotEntries` existed, and
    it survived every test because a slot with no contributor renders nothing
    either way. The subscription sub-plugin's Billing tab was the first thing
    to contribute here, and it went straight into the strip.

    So the page places both halves itself, which is the only arrangement that
    can work: the trigger carries the contribution's own `label`, and the
    panel carries its node, both keyed on the same value.
  */
  const contributedTabs = useSlotEntries("org.detail.tabs", { orgId })

  return (
    <Tabs defaultValue="overview">
      <TabsList
        variant="line"
        className="max-w-full overflow-x-auto border-b pb-0"
      >
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="members" ref={membersTabRef}>
          Members
        </TabsTrigger>
        {contributedTabs.map((tab) => (
          <TabsTrigger
            key={tab.key}
            value={tab.key}
            ref={(node) => {
              contributedTabRefs.current[tab.key] = node
            }}
          >
            {tab.label ?? tab.id}
          </TabsTrigger>
        ))}
      </TabsList>

      {/*
        No `keepMounted`, and that is not an oversight. It was here so the
        members query would start with the page rather than when the operator
        clicked over, but Base UI's panel un-hides on activation and does not
        hide again without an exit transition to wait on, and the kit's
        `TabsContent` defines none. The result was every panel visible at
        once, stacked, whichever tab was selected. Two panels made that look
        like a long page; the contributed Billing tab made it obvious.

        Eager loading is worth something. It is not worth a page that shows
        every tab's content simultaneously, and each read already has its own
        QueryBoundary in its own component, so a slow member list never blanks
        out the org's own fields either way.
      */}
      <TabsContent value="overview">
        <div className="grid min-w-0 gap-4 pt-2 @3xl/main:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
          <Panel title="Organization details">
            <DescriptionList
              className="border-0 bg-transparent [&>div]:grid-cols-[7rem_minmax(0,1fr)] [&>div]:px-0"
              items={[
                {
                  term: "Organization ID",
                  value: (
                    <span className="font-mono text-xs break-all">
                      {org.id}
                    </span>
                  ),
                },
                {
                  term: "Slug",
                  value: <span className="font-mono text-xs">{org.slug}</span>,
                },
                { term: "Created", value: formatTimestamp(org.createdAt) },
                { term: "Updated", value: formatTimestamp(org.updatedAt) },
                ...(org.appId
                  ? [
                      {
                        term: "App ID",
                        value: (
                          <span className="font-mono text-xs">{org.appId}</span>
                        ),
                      },
                    ]
                  : []),
                ...(org.metadata && Object.keys(org.metadata).length > 0
                  ? [{ term: "Metadata", value: formatMetadata(org.metadata) }]
                  : []),
              ]}
            />
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            <OrgPeopleSummary
              orgId={orgId}
              onOpenMembers={() => membersTabRef.current?.click()}
            />
            {summaryCount > 0 && (
              <PluginSlot
                name="org.detail.summary"
                params={{
                  orgId,
                  onOpenTab: (key: string) =>
                    contributedTabRefs.current[key]?.click(),
                }}
              />
            )}
          </div>
          {sectionsCount > 0 && (
            <div className="min-w-0 @3xl/main:col-span-2">
              <PluginSlot name="org.detail.sections" params={{ orgId }} />
            </div>
          )}
        </div>
      </TabsContent>
      <TabsContent value="members">
        <div className="pt-2">
          <OrgMembers orgId={orgId} />
        </div>
      </TabsContent>
      {contributedTabs.map((tab) => (
        <TabsContent key={tab.key} value={tab.key}>
          <div className="pt-2">{tab.node}</div>
        </TabsContent>
      ))}
    </Tabs>
  )
}

function OrgDetailBody({ orgId }: { orgId: string }) {
  const query = useQuery<OrgDetail>("orgs.detail", { id: orgId })
  const [editing, setEditing] = useState(false)
  const deleteOrg = useCommand<AckResponse>("orgs.delete")
  const [deleting, setDeleting] = useState(false)
  // `orgs.delete` invalidates `orgs.list` only, never `orgs.detail`, so
  // there is no intent this page could refetch that would tell it the org it
  // is showing is gone. Once a delete succeeds, this page stops rendering
  // the org's header, its data and its live action buttons immediately
  // (not waiting on a navigation that a test environment, or a slow
  // browser, cannot be relied on to have completed yet), and leaves the way
  // a page whose subject just got deleted has to: it has nowhere left to
  // stay, which is the one case `useNavigateTo` exists for rather than a
  // link.
  const [deleted, setDeleted] = useState(false)
  const navigate = useNavigateTo()

  async function confirmDelete() {
    const result = await deleteOrg.execute({ id: orgId })
    if (result === undefined) return
    setDeleted(true)
    navigate("/organizations")
  }

  if (deleted) {
    return (
      <ZeroState
        title="This organization has been deleted."
        action={
          <PluginLink
            to="/organizations"
            className="text-sm underline underline-offset-4"
          >
            Back to organizations
          </PluginLink>
        }
      />
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Organization" query={query} skeletonRows={3}>
        {(org) => (
          <>
            <div className="flex flex-wrap items-center gap-4 border-b pb-4">
              <div
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50 text-muted-foreground"
              >
                {org.logo ? (
                  <img
                    src={org.logo}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <Building2 className="size-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                  Organization
                </div>
                <h1 className="truncate text-xl font-semibold tracking-tight">
                  {org.name}
                </h1>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{org.slug}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{org.id}</span>
                </div>
              </div>
              {!editing && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Delete ${org.name}`}
                    onClick={() => {
                      deleteOrg.reset()
                      setDeleting(true)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                </div>
              )}
            </div>
            <Dialog open={editing} onOpenChange={setEditing}>
              {editing && (
                <EditOrgForm org={org} onDone={() => setEditing(false)} />
              )}
            </Dialog>
            <OrgTabs org={org} orgId={orgId} />

            <ConfirmDialog
              open={deleting}
              onOpenChange={setDeleting}
              title={`Delete ${org.name}?`}
              description="This removes the organization and cannot be undone. Members, teams, invitations and subscriptions tied to it are removed as well."
              confirmLabel="Delete"
              pending={deleteOrg.loading}
              onConfirm={() => void confirmDelete()}
            >
              {/*
                Base UI marks everything outside an open dialog inert and
                aria-hidden, so this has to render inside the dialog itself.
              */}
              <CommandAlert title="Could not delete" error={deleteOrg.error} />
            </ConfirmDialog>
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
      <ZeroState
        title="No organization selected."
        action={
          <PluginLink
            to="/organizations"
            className="text-sm underline underline-offset-4"
          >
            View organizations
          </PluginLink>
        }
      />
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
      <CommandAlert
        error={create.error}
        title="Could not create the organization"
      />
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
        <Input
          id="org-create-logo"
          value={logo}
          onChange={(e) => setLogo(e.target.value)}
        />
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

/* --------------------------------------------------------------- widget */

/**
 * The overview count. `orgs.list` answers the whole collection with no
 * paging, so its length IS the count - no separate intent to keep in sync
 * with the list page, and the same request the list page makes, served from
 * the same query store.
 *
 * Routed through `QueryBoundary` rather than reading `query.data` directly:
 * while the request is in flight `query.data` is `undefined` and a widget
 * that fell back to `?? 0` would render a zero that is not true yet. The
 * boundary draws a skeleton instead, and only renders this render prop once
 * the count is real.
 */
export function OrgCountWidget() {
  const query = useQuery<OrgListResponse>("orgs.list")

  return (
    <QueryBoundary title="Organizations" query={query}>
      {(data) => (
        <StatGrid
          items={[
            { label: "Organizations", value: data.organizations?.length ?? 0 },
          ]}
        />
      )}
    </QueryBoundary>
  )
}

/* ------------------------------------------------------------ declaration */

export const organizationSubPlugin = defineSubPlugin({
  extension: "organization",
  host: "authsome",
  label: "Organization",
  nav: [
    {
      label: "Organizations",
      to: "/organizations",
      group: "Identity",
      priority: 2,
    },
  ],
  routes: [
    { path: "/organizations", element: OrgListPage },
    { path: "/organizations/create", element: OrgCreatePage },
    { path: "/organizations/:id", element: OrgDetailPage },
  ],
  // Reads nothing of its host's. Every intent it uses is its own.
  hostIntents: [],
  contributions: {
    "overview.widgets": [
      { id: "organization-count", priority: 10, render: OrgCountWidget },
    ],
  },
})
