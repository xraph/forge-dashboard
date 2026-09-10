import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/** One row of `sessions.list`. */
export interface SessionSummary {
  id: string
  userId: string
  ipAddress: string
  userAgent: string
  lastActivityAt: string
  expiresAt: string
  createdAt: string
}

export interface SessionsList {
  sessions: SessionSummary[]
}

/** What `sessions.revoke` answers. */
export interface RevokeResult {
  ok: boolean
  id: string
}

/**
 * Sessions, with one mutation.
 *
 * Same shape as the users page and smaller: `sessions.revoke` declares
 * `sessions.list` among its invalidations, so a successful revoke refetches
 * the list and the revoked row disappears. There is no detail read here to
 * remount - `sessions.detail` exists in the contract but this page does not
 * use it, and a card that repeats the row you just clicked would earn
 * nothing.
 */
export function AuthSessionsPage() {
  const list = useQuery<SessionsList>("sessions.list")
  const revoke = useCommand<RevokeResult>("sessions.revoke")
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function handleRevoke(id: string) {
    setPendingId(id)
    const result = await revoke.execute({ id })
    setPendingId(null)

    // Resolved `undefined` means the command failed; the error is already in
    // `revoke.error` and the list still holds the session, so refetching
    // would only ask the server to confirm nothing happened.
    if (result === undefined) return

    list.refetch()
  }

  const columns: Column<SessionSummary>[] = [
    {
      id: "session",
      header: "Session",
      cell: (session) => session.id,
      className: "font-mono text-xs",
    },
    {
      id: "user",
      header: "User",
      cell: (session) => session.userId,
      className: "font-mono text-xs",
    },
    {
      id: "ip",
      header: "IP",
      cell: (session) => session.ipAddress,
      className: "font-mono text-xs",
    },
    {
      id: "userAgent",
      header: "User agent",
      cell: (session) => session.userAgent,
      className: "max-w-[18rem] truncate",
    },
    {
      id: "lastActivity",
      header: "Last activity",
      cell: (session) => formatTimestamp(session.lastActivityAt),
    },
    {
      id: "expires",
      header: "Expires",
      cell: (session) => formatTimestamp(session.expiresAt),
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Sessions" />

      <CommandAlert error={revoke.error} title="Revoke failed" />

      <QueryBoundary title="Sessions" query={list} skeletonRows={3}>
        {(data) => {
          const sessions = data.sessions ?? []

          return (
            <ResourceTable
              columns={columns}
              rows={sessions}
              rowKey={(session) => session.id}
              caption={
                sessions.length > 0
                  ? `${sessions.length} ${
                      sessions.length === 1 ? "session" : "sessions"
                    }`
                  : undefined
              }
              emptyMessage="No active sessions."
              rowActions={(session) => (
                <button
                  type="button"
                  onClick={() => void handleRevoke(session.id)}
                  disabled={pendingId === session.id}
                  aria-label={`Revoke session ${session.id}`}
                  className={buttonVariants({
                    variant: "destructive",
                    size: "sm",
                  })}
                >
                  {pendingId === session.id ? "Revoking…" : "Revoke"}
                </button>
              )}
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
