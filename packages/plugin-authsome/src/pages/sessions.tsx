import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
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

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">Sessions</h1>

      <CommandAlert error={revoke.error} title="Revoke failed" />

      <QueryView title="Sessions" query={list} skeletonRows={3}>
        {(data) => {
          const sessions = data.sessions ?? []
          if (sessions.length === 0) {
            return <EmptyState message="No active sessions." />
          }

          return (
            <Table>
              <TableCaption>
                {sessions.length}{" "}
                {sessions.length === 1 ? "session" : "sessions"}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>User agent</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-mono text-xs">
                      {session.id}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {session.userId}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {session.ipAddress}
                    </TableCell>
                    <TableCell className="max-w-[18rem] truncate">
                      {session.userAgent}
                    </TableCell>
                    <TableCell>
                      {formatTimestamp(session.lastActivityAt)}
                    </TableCell>
                    <TableCell>{formatTimestamp(session.expiresAt)}</TableCell>
                    <TableCell className="text-right">
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }}
      </QueryView>
    </section>
  )
}
