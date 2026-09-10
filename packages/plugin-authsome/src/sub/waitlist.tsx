import { useEffect, useState } from "react"
import { defineSubPlugin, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { CursorPager, useCursorStack } from "../components/cursor-pager"

/**
 * The waitlist sub-plugin: the review queue and the counts widget it drops
 * onto the auth overview.
 *
 * Verified against `plugins/waitlist/contract/`:
 *
 *   waitlist.list({ email?, status?, cursor?, limit? })
 *     -> { entries: EntrySummary[], total?, nextCursor? }   limit <= 0 defaults to 100
 *   waitlist.detail({ id })          -> EntrySummary
 *   waitlist.approve({ id, note? })  -> { ok }
 *   waitlist.reject({ id, note? })   -> { ok }
 *   waitlist.delete({ id })          -> { ok }
 *   waitlist.counts                  -> { pending, approved, rejected }
 *
 * `waitlist.counts` answers exactly those three numbers. There is no total,
 * so this never renders one and never sums the three into one: an entry
 * could sit in a state none of them counts, and a made-up total would hide
 * it.
 *
 * This page is a superset of the legacy templ one, deliberately. The templ
 * page has no delete button and no note field, but both exist in the
 * contract and in the newer manifest's action menu. Approve and reject take
 * an optional `note`, and the note is what an operator writes down for the
 * next person, so the dialog offers it. A blank note is fine and is OMITTED
 * from the payload rather than sent as `""`. Delete is offered on every
 * entry, pending or not, because it is how a mistake gets cleaned up.
 */

export interface EntrySummary {
  id: string
  email: string
  name?: string
  status: string
  userId?: string
  ipAddress?: string
  note?: string
  createdAt: string
  updatedAt?: string
}

/** `waitlist.list`'s response. */
export interface EntryList {
  entries: EntrySummary[]
  total?: number
  nextCursor?: string
}

/** `waitlist.counts`'s response, exactly. No total: see the note above. */
export interface WaitlistCounts {
  pending: number
  approved: number
  rejected: number
}

interface AckResponse {
  ok: boolean
}

/** The status is what an operator scans for. The word alone is not the
 * signal; the colour is. */
function StatusBadge({ status }: { status: string }) {
  if (status === "pending") return <Badge variant="outline">{status}</Badge>
  if (status === "approved") return <Badge variant="default">{status}</Badge>
  if (status === "rejected") return <Badge variant="destructive">{status}</Badge>
  return <Badge variant="secondary">{status}</Badge>
}

/* ------------------------------------------------------------------ page */

export function WaitlistPage() {
  // `searchInput` is what the box shows; `search` is what was last actually
  // queried with, kept apart so a debounced page does not send one
  // `waitlist.list` per keystroke.
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const page = useCursorStack()

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      // A cursor points into the previous result set. Carrying it across a
      // new search returns page two of the old answer, and it looks like
      // data rather than like an error.
      page.reset()
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, page.reset])

  function onStatusChange(value: string) {
    // Batched with the reset in the same handler so the next render never
    // sends the new status alongside a cursor from the filter it replaced.
    setStatus(value)
    page.reset()
  }

  const list = useQuery<EntryList>("waitlist.list", {
    email: search || undefined,
    status: status || undefined,
    cursor: page.cursor,
  })

  const approveCmd = useCommand<AckResponse>("waitlist.approve")
  const rejectCmd = useCommand<AckResponse>("waitlist.reject")
  const deleteCmd = useCommand<AckResponse>("waitlist.delete")

  const [approving, setApproving] = useState<EntrySummary | null>(null)
  const [rejecting, setRejecting] = useState<EntrySummary | null>(null)
  const [deleting, setDeleting] = useState<EntrySummary | null>(null)
  const [note, setNote] = useState("")

  async function confirmApprove() {
    if (!approving) return
    const result = await approveCmd.execute({
      id: approving.id,
      ...(note ? { note } : {}),
    })
    if (result === undefined) return
    setApproving(null)
    setNote("")
  }

  async function confirmReject() {
    if (!rejecting) return
    const result = await rejectCmd.execute({
      id: rejecting.id,
      ...(note ? { note } : {}),
    })
    if (result === undefined) return
    setRejecting(null)
    setNote("")
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await deleteCmd.execute({ id: deleting.id })
    if (result !== undefined) setDeleting(null)
  }

  const columns: Column<EntrySummary>[] = [
    {
      id: "email",
      header: "Email",
      className: "font-mono text-xs",
      cell: (entry) => entry.email,
    },
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (entry) => (entry.name ? entry.name : <NoneCell label="name" />),
    },
    { id: "status", header: "Status", cell: (entry) => <StatusBadge status={entry.status} /> },
    { id: "createdAt", header: "Created", cell: (entry) => formatTimestamp(entry.createdAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Waitlist" />

      <FilterBar
        search={{
          value: searchInput,
          onChange: setSearchInput,
          label: "Search waitlist",
          placeholder: "Search by email",
        }}
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            onChange: onStatusChange,
            options: [
              { label: "All", value: "" },
              { label: "Pending", value: "pending" },
              { label: "Approved", value: "approved" },
              { label: "Rejected", value: "rejected" },
            ],
          },
        ]}
      />

      <CommandAlert error={deleteCmd.error} title="Could not delete" />

      <QueryBoundary title="Waitlist" query={list} skeletonRows={5}>
        {(data) => {
          const entries = data.entries ?? []
          // The caption carries the live count on every render, independent
          // of whether CursorPager has anything to navigate to.
          const caption =
            data.total !== undefined
              ? `${entries.length} of ${data.total}`
              : `${entries.length} shown`

          return (
            <>
              <ResourceTable<EntrySummary>
                columns={columns}
                rows={entries}
                rowKey={(entry) => entry.id}
                caption={caption}
                emptyMessage={
                  search || status
                    ? "No entries match this filter."
                    : "No waitlist entries yet."
                }
                rowActions={(entry) => (
                  <>
                    {entry.status === "pending" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Approve ${entry.email}`}
                          onClick={() => {
                            // Opening the dialog is the moment that matters:
                            // one hook serves every row, so a failure or note
                            // left over from a different entry must not
                            // follow the operator here.
                            approveCmd.reset()
                            setNote("")
                            setApproving(entry)
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          aria-label={`Reject ${entry.email}`}
                          onClick={() => {
                            rejectCmd.reset()
                            setNote("")
                            setRejecting(entry)
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {/*
                      Delete is offered on every entry, pending or not. It is
                      how a mistake gets cleaned up, and it does not exist in
                      the legacy templ page at all.
                    */}
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Delete ${entry.email}`}
                      onClick={() => {
                        deleteCmd.reset()
                        setDeleting(entry)
                      }}
                    >
                      Delete
                    </Button>
                  </>
                )}
              />
              <CursorPager
                shown={entries.length}
                total={data.total}
                nextCursor={entries.length > 0 ? data.nextCursor : undefined}
                canGoBack={page.canGoBack}
                onNext={page.next}
                onPrevious={page.previous}
              />
            </>
          )
        }}
      </QueryBoundary>

      <ConfirmDialog
        open={approving !== null}
        onOpenChange={(open) => {
          if (!open) {
            setApproving(null)
            setNote("")
          }
        }}
        title={`Approve ${approving?.email ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>They gain access immediately.</span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="waitlist-approve-note">Note</Label>
              <Input
                id="waitlist-approve-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </span>
            {/*
              Base UI marks everything outside an open dialog inert and
              aria-hidden, so the error has to render inside this dialog, as a
              <span role="alert"> rather than CommandAlert's <div>:
              AlertDialogDescription renders a <p>, and a <div> is not valid
              <p> content.
            */}
            {approveCmd.error && (
              <span role="alert" className="font-medium text-destructive">
                Could not approve: {approveCmd.error.message} ({approveCmd.error.code})
              </span>
            )}
          </span>
        }
        confirmLabel="Approve"
        destructive={false}
        pending={approveCmd.loading}
        onConfirm={() => void confirmApprove()}
      />

      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null)
            setNote("")
          }
        }}
        title={`Reject ${rejecting?.email ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>They are not admitted from the waitlist.</span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="waitlist-reject-note">Note</Label>
              <Input
                id="waitlist-reject-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </span>
            {rejectCmd.error && (
              <span role="alert" className="font-medium text-destructive">
                Could not reject: {rejectCmd.error.message} ({rejectCmd.error.code})
              </span>
            )}
          </span>
        }
        confirmLabel="Reject"
        pending={rejectCmd.loading}
        onConfirm={() => void confirmReject()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.email ?? ""}?`}
        description="This entry is removed from the waitlist. This cannot be undone."
        confirmLabel="Delete"
        pending={deleteCmd.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}

/* -------------------------------------------------------------- widget */

/** The three numbers `waitlist.counts` actually answers. No total. */
export function WaitlistCountsWidget() {
  const counts = useQuery<WaitlistCounts>("waitlist.counts")

  return (
    <QueryBoundary title="Waitlist" query={counts}>
      {(data) => (
        <StatGrid
          items={[
            { label: "Pending", value: data.pending },
            { label: "Approved", value: data.approved },
            { label: "Rejected", value: data.rejected },
          ]}
        />
      )}
    </QueryBoundary>
  )
}

/* ------------------------------------------------------------ declaration */

export const waitlistSubPlugin = defineSubPlugin({
  extension: "waitlist",
  host: "auth",
  label: "Waitlist",
  nav: [{ label: "Waitlist", to: "/waitlist", group: "Compliance", priority: 1 }],
  routes: [{ path: "/waitlist", element: WaitlistPage }],
  // Reads nothing of its host's. Every intent it uses is its own.
  hostIntents: [],
  contributions: {
    "overview.widgets": [{ id: "waitlist-counts", priority: 20, render: WaitlistCountsWidget }],
  },
})
