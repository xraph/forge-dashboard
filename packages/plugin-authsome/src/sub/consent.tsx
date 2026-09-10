import { useEffect, useState } from "react"
import type { ComponentType } from "react"
import { defineSubPlugin, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import type { FilterOption } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CursorPager, useCursorStack } from "../components/cursor-pager"

/**
 * The consent sub-plugin.
 *
 * Verified against `plugins/consent/contract/`:
 *
 *   consent.list({ userId?, purpose?, cursor?, limit? }) -> { items, nextCursor? }
 *   consent.userConsents(...)  same input, SAME HANDLER as consent.list
 *   consent.grant({ userId, purpose, version?, ipAddress? })  -> { ok, id }
 *   consent.revoke({ userId, purpose })                       -> { ok }
 *
 * `consent.revoke` does NOT take the record id. It matches on the
 * `(userId, purpose)` composite, scoped to the caller's app server-side. Every
 * row carries an `id` and sending it is the obvious wrong thing to do.
 *
 * `consent.list` and `consent.userConsents` are registered to the SAME Go
 * handler and are wire-identical today, differing only in name. This file
 * still keeps them as two separate intents, and therefore two separate cache
 * entries: a future Go change that makes them diverge should not require
 * finding every call site that had conflated them into one.
 *
 * This page is new functionality, not a port. The legacy `/compliance/consent`
 * templ page is a card reading "Consent data is available on individual user
 * detail pages", with no table at all.
 *
 * No overview widget is contributed here. The legacy widget is a static card
 * reading "Consent / Active" with no live count, and there is no counts
 * intent to build a real one from - `consent.list({ limit: 1 })` answers a
 * page of records, not a count. A tile that always says the same thing is
 * furniture, so this sub-plugin ships without one. See the migration notes.
 */

export interface ConsentRecord {
  id: string
  userId: string
  appId?: string
  purpose: string
  granted: boolean
  version?: string
  ipAddress?: string
  grantedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt?: string
}

export interface ConsentList {
  items: ConsentRecord[]
  nextCursor?: string
}

interface AckResponse {
  ok: boolean
}

function ConsentStatusBadge({ granted }: { granted: boolean }) {
  return (
    <Badge variant={granted ? "default" : "destructive"}>
      {granted ? "granted" : "revoked"}
    </Badge>
  )
}

/** Shared by the app-wide list and the user section. Neither owns fewer than these five. */
function baseColumns(): Column<ConsentRecord>[] {
  return [
    {
      id: "purpose",
      header: "Purpose",
      className: "font-medium",
      cell: (r) => r.purpose,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <ConsentStatusBadge granted={r.granted} />,
    },
    {
      id: "version",
      header: "Version",
      className: "font-mono text-xs",
      cell: (r) => r.version ?? <NoneCell label="version" />,
    },
    {
      id: "grantedAt",
      header: "Granted",
      // grantedAt and revokedAt are both optional, so both go through
      // Timestamp rather than formatTimestamp: the formatter answers a bare
      // unlabelled dash for an absent value, and there is no way to attach an
      // aria-label to a character inside a plain string.
      cell: (r) => <Timestamp value={r.grantedAt} label="grant date" />,
    },
    {
      id: "revokedAt",
      header: "Revoked",
      cell: (r) => <Timestamp value={r.revokedAt} label="revocation date" />,
    },
  ]
}

/* ------------------------------------------------------------------ list */

export function ConsentsPage() {
  // `searchInput` is what the box shows; `userId` is what was last actually
  // queried with, kept apart so a keystroke does not send a request per
  // character. Same shape as the users page's own search field.
  const [searchInput, setSearchInput] = useState("")
  const [userId, setUserId] = useState("")
  const [purpose, setPurpose] = useState("")
  const page = useCursorStack()
  const [revoking, setRevoking] = useState<ConsentRecord | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setUserId(searchInput)
      // A cursor points into the previous result set. Carrying it across a
      // new search returns page two of an answer nobody asked for.
      page.reset()
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, page.reset])

  const list = useQuery<ConsentList>("consent.list", {
    userId: userId || undefined,
    purpose: purpose || undefined,
    cursor: page.cursor,
  })

  const revoke = useCommand<AckResponse>("consent.revoke")

  async function confirmRevoke() {
    if (!revoking) return
    // The composite key, never the record id: consent.revoke matches on
    // (userId, purpose), scoped to the caller's app server-side. The row
    // carries an id and sending it is the obvious wrong thing to do.
    const result = await revoke.execute({
      userId: revoking.userId,
      purpose: revoking.purpose,
    })
    if (result !== undefined) setRevoking(null)
  }

  // There is no purposes intent, so the filter offers whatever purposes are
  // in the current page of results rather than the whole set. That is the
  // honest option list this contract can produce.
  //
  // The label is capitalized and the value is not: the raw purpose string
  // still has to go out on the wire unchanged, but a table already showing
  // that exact lowercase string in its Purpose column means an identically
  // cased option label would be a second, indistinguishable "marketing" in
  // the same accessibility tree.
  const purposeOptions: FilterOption[] = [
    { label: "All purposes", value: "" },
    ...Array.from(new Set((list.data?.items ?? []).map((r) => r.purpose)))
      .sort()
      .map((p) => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: p })),
  ]

  const columns: Column<ConsentRecord>[] = [
    {
      id: "userId",
      header: "User",
      className: "font-mono text-xs",
      cell: (r) => r.userId,
    },
    ...baseColumns(),
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Consent" />

      <FilterBar
        search={{
          value: searchInput,
          onChange: setSearchInput,
          label: "Search by user",
          placeholder: "User ID",
        }}
        filters={[
          {
            id: "purpose",
            label: "Purpose",
            value: purpose,
            options: purposeOptions,
            onChange: (value) => {
              setPurpose(value)
              // Same handler, not a separate effect: a cursor left over from
              // the previous filter points into a result set this query does
              // not share.
              page.reset()
            },
          },
        ]}
      />

      <QueryBoundary title="Consent" query={list} skeletonRows={5}>
        {(data) => {
          const items = data.items ?? []
          const caption = `${items.length} ${items.length === 1 ? "record" : "records"}`
          return (
            <>
              <ResourceTable<ConsentRecord>
                columns={columns}
                rows={items}
                rowKey={(r) => r.id}
                caption={caption}
                emptyMessage={
                  userId || purpose
                    ? "No consent records match this filter."
                    : "No consent records yet."
                }
                rowActions={(r) =>
                  // Revoke only makes sense against an active grant. A
                  // record already revoked has nothing left to revoke.
                  r.granted ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Revoke ${r.purpose} for ${r.userId}`}
                      onClick={() => {
                        // Reset at open, not at close: one hook serves every
                        // row, so a failure left over from a different row's
                        // revoke must not follow the operator to a row they
                        // have not touched yet.
                        revoke.reset()
                        setRevoking(r)
                      }}
                    >
                      Revoke
                    </Button>
                  ) : null
                }
              />
              <CursorPager
                shown={items.length}
                // A zero-row page still carrying a nextCursor must not leave
                // Next clickable next to a count that says there is nothing
                // to see.
                nextCursor={items.length > 0 ? data.nextCursor : undefined}
                canGoBack={page.canGoBack}
                onNext={page.next}
                onPrevious={page.previous}
              />
            </>
          )
        }}
      </QueryBoundary>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking?.purpose ?? ""} for ${revoking?.userId ?? ""}?`}
        description={
          <>
            <span>They are treated as though they never gave this consent.</span>
            {/*
              Base UI marks everything outside an open dialog inert and
              aria-hidden, so a CommandAlert rendered on the page body would be
              unreachable while this dialog is open, for a sighted operator and
              for assistive tech alike. It has to render inside the dialog
              itself, and as a <span> rather than CommandAlert's <div>:
              AlertDialogDescription renders a <p>, and a <div> is not valid
              <p> content.
            */}
            {revoke.error && (
              <span role="alert" className="mt-2 block font-medium text-destructive">
                Could not revoke: {revoke.error.message} ({revoke.error.code})
              </span>
            )}
          </>
        }
        confirmLabel="Revoke"
        pending={revoke.loading}
        onConfirm={() => void confirmRevoke()}
      />
    </section>
  )
}

/* ---------------------------------------------------------------- section */

/**
 * A `user.detail.sections` contribution. Registered on `consentSubPlugin`,
 * `PluginSlot` spreads that slot's params (`{ userId }`) straight onto this
 * component's own props - it does not arrive nested under a `params` object
 * the way a routed page's do.
 *
 * Renders nothing at all, not even a heading, when the user has no consent
 * records. A section on somebody else's page is a guest: the host cannot see
 * it and cannot lay out around it, so an empty card headed "Consent" on every
 * user who has none would be clutter rather than information. That is
 * different from the full list page above, where an empty state IS the
 * information, which is why that one keeps its `ResourceTable` empty state
 * instead of disappearing.
 */
export function ConsentUserSection({ userId }: { userId?: string }) {
  const query = useQuery<ConsentList>("consent.userConsents", { userId })

  // Nothing to say yet, and nothing to say that went wrong: a guest
  // contribution that is still loading or that failed quietly is still
  // better read as "no section" than as a skeleton or an error card
  // competing for attention on somebody else's page.
  if (query.loading || query.error) return null

  const items = query.data?.items ?? []
  if (items.length === 0) return null

  const caption = `${items.length} ${items.length === 1 ? "record" : "records"}`

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Consent</h3>
      <ResourceTable<ConsentRecord>
        columns={baseColumns()}
        rows={items}
        rowKey={(r) => r.id}
        caption={caption}
        emptyMessage="No consent records."
      />
    </section>
  )
}

/* ------------------------------------------------------------ declaration */

export const consentSubPlugin = defineSubPlugin({
  extension: "consent",
  host: "auth",
  label: "Consent",
  nav: [{ label: "Consent", to: "/compliance/consent", group: "Compliance", priority: 0 }],
  routes: [{ path: "/compliance/consent", element: ConsentsPage }],
  // Reads nothing of its host's. Every intent it uses is its own.
  hostIntents: [],
  contributions: {
    "user.detail.sections": [
      {
        id: "consent",
        priority: 30,
        // `SlotContribution.render` takes `ComponentType<Record<string,
        // unknown>>`, and `tsc` compares `ComponentType`'s `ComponentClass`
        // branch contravariantly, so the narrower `ComponentType<{ userId?:
        // string }>` does not assign without help even though the section
        // only ever reads a `userId` string. The cast changes nothing at
        // runtime: it is still the exact same component instance.
        render: ConsentUserSection as unknown as ComponentType<Record<string, unknown>>,
      },
    ],
  },
})
