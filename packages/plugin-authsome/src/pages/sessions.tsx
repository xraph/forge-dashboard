import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { AckResponse } from "./users"

/** One row of `sessions.list`. */
export interface SessionSummary {
  id: string
  userId: string
  ipAddress?: string
  userAgent?: string
  lastActivityAt?: string
  expiresAt: string
  createdAt: string
}

export interface SessionsList {
  sessions: SessionSummary[]
}

/**
 * @deprecated Kept only so `src/index.tsx` (Task 10's file, out of bounds for
 * this task) keeps compiling against the old export name. This page itself
 * now types `sessions.revoke` as `AckResponse` and `sessions.bulkRevoke` as
 * `BulkRevokeResponse`.
 */
export type RevokeResult = AckResponse

/**
 * `BulkRevokeResponse`, from `authsome/extension/contract/handlers_sessions.go`:
 * `{ ok bool; count int }` (json tag `count`). Typing `sessions.bulkRevoke`
 * as plain `AckResponse` compiles fine but throws away the one thing the
 * operator asked this command for: how many sessions it actually revoked.
 */
export interface BulkRevokeResponse extends AckResponse {
  count: number
}

/** The server caps what it returns; this is what we ask for. */
const LIMIT = 100

/**
 * Sessions, with revoke, bulk revoke and a filter by user.
 *
 * `sessions.list` is a top-N list, not cursor-paged, so there is no pager
 * here: the description says as much rather than implying completeness.
 * Neither write calls `list.refetch()` - both declare `sessions.list` among
 * `meta.invalidates`, and the store acts on that.
 */
export function AuthSessionsPage() {
  const [userFilter, setUserFilter] = useState("")
  const [revoking, setRevoking] = useState<SessionSummary | null>(null)
  const [bulkFor, setBulkFor] = useState<string | null>(null)
  // The last bulk revoke's own answer, kept around after the dialog that
  // produced it closes: `count` is the whole reason the operator clicked
  // "Revoke all" rather than one row at a time, and a dialog that just closes
  // silently gives them nothing to check that number against.
  const [bulkResult, setBulkResult] = useState<{ userId: string; count: number } | null>(null)

  const list = useQuery<SessionsList>("sessions.list", {
    userId: userFilter || undefined,
    limit: LIMIT,
  })
  const revoke = useCommand<AckResponse>("sessions.revoke")
  const bulkRevoke = useCommand<BulkRevokeResponse>("sessions.bulkRevoke")

  async function confirmRevoke() {
    if (!revoking) return
    const result = await revoke.execute({ id: revoking.id })
    if (result !== undefined) setRevoking(null)
  }
  async function confirmBulk() {
    if (!bulkFor) return
    const result = await bulkRevoke.execute({ userId: bulkFor })
    if (result === undefined) return
    setBulkResult({ userId: bulkFor, count: result.count })
    setBulkFor(null)
  }

  const columns: Column<SessionSummary>[] = [
    {
      id: "session",
      header: "Session",
      cell: (s) => s.id,
      className: "font-mono text-xs",
    },
    {
      id: "user",
      header: "User",
      cell: (s) => s.userId,
      className: "font-mono text-xs",
    },
    {
      id: "ip",
      header: "IP",
      cell: (s) => s.ipAddress || <NoneCell label="ip address" />,
      className: "font-mono text-xs",
    },
    {
      id: "userAgent",
      header: "User agent",
      cell: (s) => s.userAgent || <NoneCell label="user agent" />,
      className: "max-w-[18rem] truncate",
    },
    {
      id: "lastActivity",
      header: "Last activity",
      cell: (s) => <Timestamp value={s.lastActivityAt} label="last activity" />,
    },
    { id: "expires", header: "Expires", cell: (s) => formatTimestamp(s.expiresAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Sessions" description={`Showing the most recent ${LIMIT}.`} />
      <FilterBar
        search={{
          value: userFilter,
          onChange: setUserFilter,
          label: "Filter by user",
          placeholder: "User id",
        }}
      />

      {bulkResult && (
        <p role="status" className="text-sm text-muted-foreground">
          Revoked {bulkResult.count} {bulkResult.count === 1 ? "session" : "sessions"} for{" "}
          {bulkResult.userId}.
        </p>
      )}

      <QueryBoundary title="Sessions" query={list} skeletonRows={5}>
        {(data) => {
          const sessions = data.sessions ?? []

          return (
            <ResourceTable<SessionSummary>
              columns={columns}
              rows={sessions}
              rowKey={(s) => s.id}
              caption={`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}
              emptyMessage="No active sessions."
              rowActions={(session) => (
                <>
                  <a
                    href={`/@auth/sessions/${session.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </a>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Revoke session ${session.id}`}
                    onClick={() => {
                      // Reset at open, not at close: the state that matters
                      // is what the operator is looking at right now, for
                      // this session, not whatever the last dialog left
                      // behind.
                      revoke.reset()
                      setRevoking(session)
                    }}
                  >
                    Revoke
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Revoke all for ${session.userId}`}
                    onClick={() => {
                      bulkRevoke.reset()
                      // A stale count from a previous user's bulk revoke must
                      // not still be on screen once a different user's
                      // dialog opens - it would read as this user's result.
                      setBulkResult(null)
                      setBulkFor(session.userId)
                    }}
                  >
                    Revoke all
                  </Button>
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      {/*
        The error alerts live inside each dialog's description rather than
        above the table. Base UI marks everything outside an open AlertDialog
        `inert` and `aria-hidden`, so an alert rendered up here is invisible -
        to assistive tech and to CSS both - for as long as the dialog that
        can actually fail is open, which is exactly when an operator needs to
        read it.
      */}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this session?"
        description={
          <span className="flex flex-col gap-2">
            <span>Signs {revoking?.userId ?? "the user"} out on that device immediately.</span>
            <CommandAlert error={revoke.error} title="Could not revoke" />
          </span>
        }
        confirmLabel="Revoke"
        pending={revoke.loading}
        onConfirm={() => void confirmRevoke()}
      />
      <ConfirmDialog
        open={bulkFor !== null}
        onOpenChange={(open) => !open && setBulkFor(null)}
        title={`Revoke every session for ${bulkFor ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>Signs them out everywhere, on every device, at once.</span>
            <CommandAlert error={bulkRevoke.error} title="Could not revoke" />
          </span>
        }
        confirmLabel="Revoke all"
        pending={bulkRevoke.loading}
        onConfirm={() => void confirmBulk()}
      />
    </section>
  )
}
