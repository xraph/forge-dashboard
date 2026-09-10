import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { PresenceInfo, PresenceList } from "./overview"
import type { CommandResult } from "./rooms"

/**
 * The statuses an operator may set.
 *
 * The contract takes any string, so this list is a UI decision rather than a
 * constraint the server enforces. Keeping it short is the point: a free-text
 * status field on an admin page produces a hundred spellings of "away".
 */
const STATUSES = ["online", "away", "busy", "offline"]

export function StreamingPresencePage() {
  const query = useQuery<PresenceList>("presence.list")
  const setPresence = useCommand<CommandResult>("presence.set")

  const columns: Column<PresenceInfo>[] = [
    { id: "userID", header: "User", cell: (p) => p.userID, className: "font-mono text-xs" },
    {
      id: "status",
      header: "Status",
      cell: (p) => (
        <NativeSelect
          aria-label={`Status for ${p.userID}`}
          // Driven off the server's own record, not off local state. A
          // failed override must leave the row showing what the status
          // actually is, and the only way to guarantee that without a
          // separate "did this fail" branch is to never let the select hold
          // an opinion of its own: it always renders `p.status`, which only
          // moves once the write actually lands and `presence.list`
          // re-fetches.
          value={p.status}
          disabled={setPresence.loading}
          onChange={(event) =>
            void setPresence.execute({ userID: p.userID, status: event.target.value })
          }
        >
          {/*
            The server's current value may be something this list does not
            hold. Render it anyway, or the select would silently show a
            different status from the one the user actually has.
          */}
          {(STATUSES.includes(p.status) ? STATUSES : [p.status, ...STATUSES]).map(
            (status) => (
              <NativeSelectOption key={status} value={status}>
                {status}
              </NativeSelectOption>
            ),
          )}
        </NativeSelect>
      ),
    },
    {
      id: "customStatus",
      header: "Custom",
      cell: (p) => p.customStatus || "–",
    },
    { id: "rooms", header: "Rooms", cell: (p) => (p.rooms ?? []).length, align: "end" },
    { id: "lastSeen", header: "Last seen", cell: (p) => formatTimestamp(p.lastSeen) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Presence"
        description="Who is online, and an override for when the client gets it wrong."
      />
      <CommandAlert error={setPresence.error} title="Could not set the status" />
      <QueryBoundary title="Presence" query={query} skeletonRows={4}>
        {(data) => {
          const presence = data.presence ?? []
          return (
            <ResourceTable<PresenceInfo>
              columns={columns}
              rows={presence}
              rowKey={(p) => p.userID}
              caption={
                presence.length === 0
                  ? undefined
                  : `${presence.length} ${presence.length === 1 ? "person" : "people"}`
              }
              emptyMessage="No presence records."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
