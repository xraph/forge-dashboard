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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@forge-go/dashboard-kit/components/table"
import {
  CommandAlert,
  EmptyState,
  QueryView,
  formatTimestamp,
} from "../components/query-view"

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
        <QueryView title="User detail" query={detail} skeletonRows={2}>
          {(user) => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd>
                {user.displayName ||
                  `${user.firstName} ${user.lastName}`.trim() ||
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
        </QueryView>
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

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">Users</h1>

      <CommandAlert error={ban.error} title="Ban failed" />
      <CommandAlert error={unban.error} title="Unban failed" />

      <QueryView title="Users" query={list} skeletonRows={4}>
        {(data) => {
          // The Go handler builds this slice itself so it is never null on the
          // wire, but the page is rendered by a host that will happily hand it
          // whatever the server said. A missing array must not throw inside a
          // plugin's own render.
          const users = data.users ?? []
          if (users.length === 0) return <EmptyState message="No users yet." />

          return (
            <Table>
              <TableCaption>
                {users.length} of {data.total ?? users.length}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>
                      {`${user.firstName} ${user.lastName}`.trim() ||
                        user.username}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {user.id}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={user.emailVerified ? "outline" : "secondary"}
                      >
                        {user.emailVerified ? "verified" : "unverified"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <BannedBadge banned={user.banned} />
                    </TableCell>
                    <TableCell>{formatTimestamp(user.createdAt)}</TableCell>
                    <TableCell className="flex justify-end gap-2">
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }}
      </QueryView>

      {selected && (
        <UserDetail key={`${selected}:${invalidations}`} id={selected} />
      )}
    </section>
  )
}
