import { Identity, PageLink } from "../components/presentation"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@forge-go/dashboard-kit/components/dropdown-menu"
import { useEffect, useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
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
import { ResourceTable, type Column } from "../components/presentation"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { CursorPager, useCursorStack } from "../components/cursor-pager"

export interface UserSummary {
  id: string
  email: string
  emailVerified: boolean
  firstName?: string
  lastName?: string
  username?: string
  banned: boolean
  createdAt: string
}

export interface UsersList {
  users: UserSummary[]
  nextCursor?: string
  total?: number
}

/** The canonical reply for every mutating command in this contract. */
export interface AckResponse {
  ok: boolean
  id?: string
}

export function displayName(user: UserSummary): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    user.email
  )
}

export function AuthUsersPage() {
  // `searchInput` is what the box shows; `search` is what was last actually
  // queried with. FilterBar fires on every keystroke by design (it has no
  // opinion on debounce, only the page does), so those two are kept apart to
  // avoid sending one `users.list` request per character typed.
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const page = useCursorStack()
  const resetPage = page.reset
  const [banning, setBanning] = useState<UserSummary | null>(null)
  const [banReason, setBanReason] = useState("")
  const [banExpiry, setBanExpiry] = useState("")
  const [deleting, setDeleting] = useState<UserSummary | null>(null)

  useEffect(() => {
    // Nothing to apply when the box already matches the search in use: on
    // mount, or after typing back to it. Without this the reset below ran
    // 300ms after every mount and threw away a page you had moved to.
    if (searchInput === search) return
    const timer = setTimeout(() => {
      setSearch(searchInput)
      // A cursor points into the previous result set. Carrying it across a
      // new search returns page two of the old answer.
      resetPage()
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, search, resetPage])

  // `email` and `cursor` are left undefined rather than sent empty. The store
  // keys an undefined value the same as an absent one, and the server reads an
  // empty cursor as "start again", so this is both correct and free.
  const list = useQuery<UsersList>("users.list", {
    email: search || undefined,
    cursor: page.cursor,
  })

  const ban = useCommand<AckResponse>("users.ban")
  const unban = useCommand<AckResponse>("users.unban")
  const remove = useCommand<AckResponse>("users.delete")

  async function confirmBan() {
    if (!banning) return
    const result = await ban.execute({
      id: banning.id,
      reason: banReason,
      // Empty means indefinite in this contract, and an omitted key says that
      // more clearly than an empty string does.
      expiresAt: banExpiry ? new Date(banExpiry).toISOString() : undefined,
    })
    if (result === undefined) return
    setBanning(null)
    setBanReason("")
    setBanExpiry("")
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result !== undefined) setDeleting(null)
  }

  const columns: Column<UserSummary>[] = [
    {
      id: "user",
      header: "User",
      cell: (u) => (
        <Identity name={displayName(u)} email={u.email} to={`/users/${u.id}`} />
      ),
    },
    {
      id: "id",
      header: "User ID",
      cell: (u) => <span title={u.id}>{u.id}</span>,
      className: "max-w-40 truncate font-mono text-xs text-muted-foreground",
    },
    {
      id: "emailVerified",
      header: "Email",
      cell: (u) => (
        <Badge variant={u.emailVerified ? "outline" : "secondary"}>
          {u.emailVerified ? "verified" : "unverified"}
        </Badge>
      ),
    },
    {
      id: "banned",
      header: "Status",
      cell: (u) => (
        <Badge variant={u.banned ? "destructive" : "outline"}>
          {u.banned ? "banned" : "active"}
        </Badge>
      ),
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (u) => formatTimestamp(u.createdAt),
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Users"
        description="Manage accounts, verification, and access to your application."
        actions={
          <PageLink to="/users/create" primary>
            New user
          </PageLink>
        }
      />

      <FilterBar
        search={{
          value: searchInput,
          onChange: setSearchInput,
          label: "Search users",
          placeholder: "Search by email",
        }}
      />

      {/*
        Unban fires straight from its row button, with no confirmation - the
        plan calls it non-destructive, so there is no dialog for Base UI to
        mark the rest of the page inert behind. Ban and delete DO open one,
        so their errors render inside those dialogs instead, below.
      */}
      <CommandAlert error={unban.error} title="Could not unban" />

      <QueryBoundary title="Users" query={list} skeletonRows={5}>
        {(data) => {
          const users = data.users ?? []
          // The caption carries the live count on every render, independent
          // of whether `CursorPager` has anything to navigate to - it renders
          // nothing at all on a single-page result, which used to mean the
          // count disappeared along with it for the common case of a small
          // org.
          const caption =
            data.total !== undefined
              ? `${users.length} of ${data.total}`
              : `${users.length} shown`

          return (
            <>
              <ResourceTable<UserSummary>
                columns={columns}
                rows={users}
                rowKey={(u) => u.id}
                caption={caption}
                emptyMessage={
                  search ? `No users match “${search}”.` : "No users yet."
                }
                rowActions={(user) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Actions for ${user.email}`}
                        />
                      }
                    >
                      <span aria-hidden="true" className="text-lg leading-none">
                        ⋯
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        render={
                          <PluginLink to={`/users/${user.id}`}>
                            Details
                          </PluginLink>
                        }
                      >
                        Details
                      </DropdownMenuItem>
                      {user.banned ? (
                        <DropdownMenuItem
                          disabled={unban.loading}
                          aria-label={`Unban ${user.email}`}
                          onClick={() => void unban.execute({ id: user.id })}
                        >
                          Unban user
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          aria-label={`Ban ${user.email}`}
                          onClick={() => {
                            ban.reset()
                            setBanReason("")
                            setBanExpiry("")
                            setBanning(user)
                          }}
                        >
                          Ban user
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        aria-label={`Delete ${user.email}`}
                        onClick={() => {
                          remove.reset()
                          setDeleting(user)
                        }}
                      >
                        Delete user
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              />
              <CursorPager
                hideCount
                shown={users.length}
                total={data.total}
                // A zero-row page still carrying a `nextCursor` must not
                // leave Next clickable next to a count that says there is
                // nothing to see - so Next only reflects a real cursor when
                // there is something on screen to have paged to.
                nextCursor={users.length > 0 ? data.nextCursor : undefined}
                canGoBack={page.canGoBack}
                onNext={page.next}
                onPrevious={page.previous}
              />
            </>
          )
        }}
      </QueryBoundary>

      <ConfirmDialog
        open={banning !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBanning(null)
            setBanReason("")
            setBanExpiry("")
          }
        }}
        title={`Ban ${banning?.email ?? ""}?`}
        description="They are signed out of every session and cannot sign in again."
        confirmLabel="Ban"
        pending={ban.loading}
        onConfirm={() => void confirmBan()}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ban-reason">Reason</Label>
          <Input
            id="ban-reason"
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ban-expiry">Expires at</Label>
          <Input
            id="ban-expiry"
            type="datetime-local"
            value={banExpiry}
            onChange={(e) => setBanExpiry(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            Leave empty to ban indefinitely.
          </span>
        </div>
        {/*
          Base UI marks everything outside an open AlertDialog `inert`
          and `aria-hidden`, so an alert rendered above the table is
          unreachable for as long as this dialog is open.
        */}
        <CommandAlert error={ban.error} title="Could not ban" />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.email ?? ""}?`}
        description="Their sessions, devices and role assignments go with them. This cannot be undone."
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete" />
      </ConfirmDialog>
    </section>
  )
}
