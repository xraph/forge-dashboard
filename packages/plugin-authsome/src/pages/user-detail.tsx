import { useState } from "react"
import { PluginSlot, useCommand, useQuery, useSlotCount } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { displayName, type AckResponse, type UserSummary } from "./users"

/** `users.detail`. UserDetail embeds UserSummary in Go, so the JSON is flat. */
export interface UserDetail extends UserSummary {
  displayName?: string
  phone?: string
  phoneVerified?: boolean
  image?: string
  banReason?: string
  banExpiresAt?: string
  passwordChangedAt?: string
  updatedAt: string
  appId?: string
  envId?: string
}

interface SessionRow {
  id: string
  userId: string
  ipAddress?: string
  userAgent?: string
  lastActivityAt?: string
  expiresAt: string
  createdAt: string
}
interface DeviceRow {
  id: string
  userId: string
  name?: string
  type?: string
  browser?: string
  os?: string
  ipAddress?: string
  trusted: boolean
  lastSeenAt: string
  createdAt: string
}

const sessionColumns: Column<SessionRow>[] = [
  {
    id: "ipAddress",
    header: "IP",
    cell: (s) => s.ipAddress || <NoneCell label="ip address" />,
  },
  { id: "createdAt", header: "Started", cell: (s) => formatTimestamp(s.createdAt) },
  { id: "expiresAt", header: "Expires", cell: (s) => formatTimestamp(s.expiresAt) },
]

const deviceColumns: Column<DeviceRow>[] = [
  // Same fallback chain as `deviceLabel` on the devices page: name, then
  // type, then the id, which always exists - so this column never has a
  // genuine "none" case to hand to `NoneCell`.
  {
    id: "name",
    header: "Device",
    cell: (d) => d.name || d.type || d.id,
    className: "font-medium",
  },
  { id: "browser", header: "Browser", cell: (d) => d.browser || <NoneCell label="browser" /> },
  {
    id: "trusted",
    header: "Trusted",
    cell: (d) => (
      <Badge variant={d.trusted ? "outline" : "secondary"}>
        {d.trusted ? "trusted" : "untrusted"}
      </Badge>
    ),
  },
  { id: "lastSeenAt", header: "Last seen", cell: (d) => formatTimestamp(d.lastSeenAt) },
]

function UserSessions({ userId }: { userId: string }) {
  const query = useQuery<{ sessions: SessionRow[] }>("sessions.list", { userId })
  return (
    <QueryBoundary title="Sessions" query={query} skeletonRows={2}>
      {(data) => {
        const sessions = data.sessions ?? []
        // The caption carries the live count on every render, including at
        // zero, the same as every other table in this package.
        const caption = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`
        return (
          <ResourceTable<SessionRow>
            columns={sessionColumns}
            rows={sessions}
            rowKey={(s) => s.id}
            caption={caption}
            emptyMessage="No active sessions."
          />
        )
      }}
    </QueryBoundary>
  )
}

function UserDevices({ userId }: { userId: string }) {
  const query = useQuery<{ devices: DeviceRow[] }>("devices.list", { userId })
  return (
    <QueryBoundary title="Devices" query={query} skeletonRows={2}>
      {(data) => {
        const devices = data.devices ?? []
        // Same live-count convention as `UserSessions` above.
        const caption = `${devices.length} ${devices.length === 1 ? "device" : "devices"}`
        return (
          <ResourceTable<DeviceRow>
            columns={deviceColumns}
            rows={devices}
            rowKey={(d) => d.id}
            caption={caption}
            emptyMessage="No devices seen."
          />
        )
      }}
    </QueryBoundary>
  )
}

function EditUser({ user }: { user: UserDetail }) {
  const update = useCommand<AckResponse>("users.update")
  const [firstName, setFirstName] = useState(user.firstName ?? "")
  const [lastName, setLastName] = useState(user.lastName ?? "")
  const [username, setUsername] = useState(user.username ?? "")
  const [emailVerified, setEmailVerified] = useState(user.emailVerified)

  // Only what actually changed. `users.update` declares these as Go pointers
  // precisely so "leave unchanged" and "set to empty" stay different things,
  // and an untouched field sent as "" blanks it on the server.
  const changed: Record<string, unknown> = { id: user.id }
  if (firstName !== (user.firstName ?? "")) changed.firstName = firstName
  if (lastName !== (user.lastName ?? "")) changed.lastName = lastName
  if (username !== (user.username ?? "")) changed.username = username
  if (emailVerified !== user.emailVerified) changed.emailVerified = emailVerified
  const dirty = Object.keys(changed).length > 1

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Edit</h2>
      <CommandAlert error={update.error} title="Could not save" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-first">First name</Label>
        <Input id="user-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-last">Last name</Label>
        <Input id="user-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-username">Username</Label>
        <Input id="user-username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        {/*
          No `htmlFor` here on purpose. Base UI's Switch renders a hidden
          native checkbox carrying this `id`, and a Label with a matching
          `htmlFor` auto-wires an `aria-labelledby` onto the visible switch
          too, giving getByLabelText two elements for one name. An explicit
          id/aria-labelledby pair (the same one settings-form.tsx uses for its
          boolean fields) keeps it to one.
        */}
        <Label id="user-verified-label">Email verified</Label>
        <Switch
          id="user-verified"
          aria-labelledby="user-verified-label"
          checked={emailVerified}
          onCheckedChange={setEmailVerified}
        />
      </div>
      <Button
        onClick={() => void update.execute(changed)}
        disabled={update.loading || !dirty}
      >
        {update.loading ? "Saving…" : "Save changes"}
      </Button>
    </div>
  )
}

export function AuthUserDetailPage({ params }: PluginPageProps) {
  const userId = params.id
  if (!userId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No user selected.
      </p>
    )
  }
  return <UserDetailBody userId={userId} />
}

function UserDetailBody({ userId }: { userId: string }) {
  const query = useQuery<UserDetail>("users.detail", { id: userId })
  const contributed = useSlotCount("user.detail.sections")

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="User" query={query} skeletonRows={3}>
        {(user) => (
          <>
            <PageHeader title={displayName(user)} description={user.email} />
            <DetailLayout
              main={
                <>
                  <DescriptionList
                    items={[
                      { term: "Email", value: user.email },
                      {
                        term: "Verified",
                        value: (
                          <Badge variant={user.emailVerified ? "outline" : "secondary"}>
                            {user.emailVerified ? "verified" : "unverified"}
                          </Badge>
                        ),
                      },
                      { term: "Phone", value: user.phone || <NoneCell label="phone" /> },
                      {
                        term: "Status",
                        value: (
                          <Badge variant={user.banned ? "destructive" : "outline"}>
                            {user.banned ? "banned" : "active"}
                          </Badge>
                        ),
                      },
                      {
                        term: "Ban reason",
                        value: user.banReason || <NoneCell label="ban reason" />,
                      },
                      {
                        term: "Ban expires",
                        value: <Timestamp value={user.banExpiresAt} label="ban expiry" />,
                      },
                      {
                        term: "Password changed",
                        value: (
                          <Timestamp value={user.passwordChangedAt} label="password change" />
                        ),
                      },
                      { term: "Created", value: formatTimestamp(user.createdAt) },
                      { term: "Updated", value: formatTimestamp(user.updatedAt) },
                    ]}
                  />
                  <UserSessions userId={userId} />
                  <UserDevices userId={userId} />
                  {/*
                    Where the MFA, consent and social sub-plugins put their
                    per-user panels. The heading is conditional because
                    PluginSlot renders nothing at all when nobody contributes,
                    and a bare heading over nothing is worse than no heading.
                  */}
                  {contributed > 0 && (
                    <h2 className="text-sm font-medium">From installed plugins</h2>
                  )}
                  <PluginSlot name="user.detail.sections" params={{ userId }} />
                </>
              }
              aside={<EditUser user={user} />}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
