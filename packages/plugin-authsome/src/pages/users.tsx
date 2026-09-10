import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/** One row of `users.list`. */
export interface UserSummary {
  id: string
  email: string
  emailVerified: boolean
  firstName: string
  lastName: string
  username: string
  banned: boolean
  createdAt: string
}

export interface UsersList {
  users: UserSummary[]
  total: number
}

/**
 * What `users.detail` answers: the summary plus the fields the list omits.
 *
 * The extras are optional because the list row and the detail record are two
 * different projections of one user in authsome, and only the summary's
 * fields are guaranteed by both. A detail response missing `banReason` should
 * render a user, not a blank pane.
 */
export interface UserRecord extends UserSummary {
  displayName?: string
  phone?: string
  phoneVerified?: boolean
  banReason?: string
  banExpiresAt?: string
  updatedAt?: string
}

/** What `users.ban` and `users.unban` answer. */
export interface BanResult {
  ok: boolean
  id: string
}

function BannedBadge({ banned }: { banned: boolean }) {
  return (
    <Badge variant={banned ? "destructive" : "outline"}>
      {banned ? "banned" : "active"}
    </Badge>
  )
}

/**
 * The detail read for one selected user.
 *
 * A child component, and not a second `useQuery` in the page, because
 * `useQuery` fires on mount and there is no id to read until somebody picks a
 * row. Hooks cannot be called conditionally; mounting the component that owns
 * the hook can be. With nobody selected this never renders, so `users.detail`
 * is never called with an undefined id.
 */
function UserDetail({ id }: { id: string }) {
  const detail = useQuery<UserRecord>("users.detail", { id })

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>User detail</CardTitle>
        <CardDescription className="font-mono">{id}</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryBoundary title="User detail" query={detail} skeletonRows={2}>
          {(user) => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>
                {user.displayName ||
                  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
                  user.username}
              </dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user.email}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <BannedBadge banned={user.banned} />
              </dd>
              <dt className="text-muted-foreground">Ban reason</dt>
              <dd>{user.banReason || "–"}</dd>
              <dt className="text-muted-foreground">Updated</dt>
              <dd>{formatTimestamp(user.updatedAt ?? "")}</dd>
            </dl>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  )
}

export function AuthUsersPage() {
  const list = useQuery<UsersList>("users.list")
  const ban = useCommand<BanResult>("users.ban")
  const unban = useCommand<BanResult>("users.unban")

  const [selected, setSelected] = useState<string | null>(null)
  /**
   * Bumped on every successful ban or unban, and used as the detail card's
   * `key`.
   *
   * The manifest says `users.ban` and `users.unban` invalidate both
   * `users.list` and `users.detail`, and `useQuery` is not a cache: it has one
   * invalidation primitive, `refetch`, and it fires on mount. The list is
   * refetched directly because this component holds its query state.
   * `users.detail` belongs to a child, so remounting the child is how its read
   * is reissued - the same effect, without threading a callback ref up out of
   * a component whose whole job is to own that one read.
   */
  const [invalidations, setInvalidations] = useState(0)
  /**
   * Which row is mid-command. `ban.loading` is a page-wide flag, so spinning
   * every row's button on it would say three users are being banned when one
   * is.
   */
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function toggleBan(user: UserSummary) {
    const command = user.banned ? unban : ban
    setPendingId(user.id)
    const result = await command.execute({ id: user.id })
    setPendingId(null)

    // `execute` resolves with `undefined` on failure and never rejects, so
    // this is the success check. A failed ban must not refetch: the list has
    // not changed, and refetching anyway would make this page look like it
    // invalidates correctly even after the invalidation was deleted.
    if (result === undefined) return

    list.refetch()
    setInvalidations((n) => n + 1)
  }

  const columns: Column<UserSummary>[] = [
    {
      id: "email",
      header: "Email",
      cell: (user) => user.email,
      className: "font-medium",
    },
    {
      id: "name",
      header: "Name",
      cell: (user) =>
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.username,
    },
    {
      id: "id",
      header: "ID",
      cell: (user) => user.id,
      className: "font-mono text-xs",
    },
    {
      id: "verified",
      header: "Verified",
      cell: (user) => (
        <Badge variant={user.emailVerified ? "outline" : "secondary"}>
          {user.emailVerified ? "verified" : "unverified"}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (user) => <BannedBadge banned={user.banned} />,
    },
    {
      id: "created",
      header: "Created",
      cell: (user) => formatTimestamp(user.createdAt),
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Users" />

      <CommandAlert error={ban.error} title="Ban failed" />
      <CommandAlert error={unban.error} title="Unban failed" />

      <QueryBoundary title="Users" query={list} skeletonRows={4}>
        {(data) => {
          // The Go handler builds this slice itself so it is never null on the
          // wire, but the page is rendered by a host that will happily hand it
          // whatever the server said. A missing array must not throw inside a
          // plugin's own render.
          const users = data.users ?? []

          return (
            <ResourceTable
              columns={columns}
              rows={users}
              rowKey={(user) => user.id}
              caption={
                users.length > 0
                  ? `${users.length} of ${data.total ?? users.length}`
                  : undefined
              }
              emptyMessage="No users yet."
              rowActions={(user) => (
                <>
                  <button
                    type="button"
                    onClick={() => setSelected(user.id)}
                    className={buttonVariants({
                      variant: "ghost",
                      size: "sm",
                    })}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleBan(user)}
                    disabled={pendingId === user.id}
                    aria-label={`${user.banned ? "Unban" : "Ban"} ${user.email}`}
                    className={buttonVariants({
                      variant: user.banned ? "outline" : "destructive",
                      size: "sm",
                    })}
                  >
                    {pendingId === user.id
                      ? "Working…"
                      : user.banned
                        ? "Unban"
                        : "Ban"}
                  </button>
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      {selected && (
        <UserDetail key={`${selected}:${invalidations}`} id={selected} />
      )}
    </section>
  )
}
