import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
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
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
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
  const [search, setSearch] = useState("")
  const page = useCursorStack()
  const [banning, setBanning] = useState<UserSummary | null>(null)
  const [banReason, setBanReason] = useState("")
  const [banExpiry, setBanExpiry] = useState("")
  const [deleting, setDeleting] = useState<UserSummary | null>(null)

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

  function searchFor(value: string) {
    setSearch(value)
    // A cursor points into the previous result set. Carrying it across a new
    // search returns page two of the old answer.
    page.reset()
  }

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
    { id: "email", header: "Email", cell: (u) => u.email },
    { id: "name", header: "Name", cell: (u) => displayName(u) },
    {
      id: "emailVerified",
      header: "Verified",
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
    { id: "createdAt", header: "Created", cell: (u) => formatTimestamp(u.createdAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Users"
        actions={<a href="/@auth/users/create" className="underline underline-offset-4">New user</a>}
      />

      <FilterBar
        search={{ value: search, onChange: searchFor, label: "Search users", placeholder: "Search by email" }}
      />

      <CommandAlert error={ban.error} title="Could not ban" />
      <CommandAlert error={unban.error} title="Could not unban" />
      <CommandAlert error={remove.error} title="Could not delete" />

      <QueryBoundary title="Users" query={list} skeletonRows={5}>
        {(data) => (
          <>
            <ResourceTable<UserSummary>
              columns={columns}
              rows={data.users ?? []}
              rowKey={(u) => u.id}
              caption="Users"
              emptyMessage={search ? `No users match “${search}”.` : "No users yet."}
              rowActions={(user) => (
                <>
                  <a
                    href={`/@auth/users/${user.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </a>
                  {user.banned ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Unban ${user.email}`}
                      disabled={unban.loading}
                      onClick={() => void unban.execute({ id: user.id })}
                    >
                      Unban
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Ban ${user.email}`}
                      onClick={() => setBanning(user)}
                    >
                      Ban
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Delete ${user.email}`}
                    onClick={() => setDeleting(user)}
                  >
                    Delete
                  </Button>
                </>
              )}
            />
            <CursorPager
              shown={(data.users ?? []).length}
              total={data.total}
              nextCursor={data.nextCursor}
              canGoBack={page.canGoBack}
              onNext={page.next}
              onPrevious={page.previous}
            />
          </>
        )}
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
        description={
          <span className="flex flex-col gap-2">
            <span>They are signed out of every session and cannot sign in again.</span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="ban-reason">Reason</Label>
              <Input id="ban-reason" value={banReason} onChange={(e) => setBanReason(e.target.value)} />
            </span>
            <span className="flex flex-col gap-1.5">
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
            </span>
          </span>
        }
        confirmLabel="Ban"
        pending={ban.loading}
        onConfirm={() => void confirmBan()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.email ?? ""}?`}
        description="Their sessions, devices and role assignments go with them. This cannot be undone."
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
