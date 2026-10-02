import { useState } from "react"
import type { ComponentType } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CasStateBadge } from "../badges"
import { Bytes } from "../components/bytes"
import { StorePicker } from "../components/store-picker"
import { formatBytes } from "../format"
import { useActiveStore, withStore } from "../store"
import type { CasEntry, CasGCResult, CasList, CasStatus } from "../types"

const PAGE_SIZE = 100

export const CasPage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const status = useQuery<CasStatus>("cas.status", withStore(store, {}))

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="CAS"
        description="Content-addressable storage: blobs stored under their hash, with a reference count per hash."
        actions={<StorePicker />}
      />
      <QueryBoundary title="CAS status" query={status} skeletonRows={3}>
        {(data) =>
          data.enabled ? (
            <>
              <CasCeiling status={data} />
              {/* Keyed by store so a switch starts from the first page. */}
              <CasEntries key={store} store={store} />
            </>
          ) : (
            <EmptyState title="CAS is not enabled on this store." />
          )
        }
      </QueryBoundary>
    </section>
  )
}

function CasCeiling({ status }: { status: CasStatus }) {
  return (
    <section className="flex flex-col gap-2">
      <DescriptionList
        items={[
          { term: "Algorithm", value: status.algorithm ? <span className="font-mono text-xs">{status.algorithm}</span> : <NoneCell label="algorithm" /> },
          { term: "Bucket", value: status.bucket ? <span className="font-mono text-xs">{status.bucket}</span> : <NoneCell label="bucket" /> },
          { term: "Index", value: status.index === "memory" ? "In memory" : status.index ?? <NoneCell label="index" /> },
        ]}
      />
      {status.resetsOnRestart ? (
        <p className="text-sm text-muted-foreground">
          The index lives in this process's memory. A restart forgets every reference count and pin, and blobs already in the bucket then show as not indexed.
        </p>
      ) : null}
      {!status.releaseSupported ? (
        <p className="text-sm text-muted-foreground">
          Nothing in CAS lowers a reference count, so garbage collection never finds anything to collect.
        </p>
      ) : null}
    </section>
  )
}

function entriesCaption(n: number, more: boolean): string {
  if (more) return `${n} on this page, more after it`
  return `${n} ${n === 1 ? "entry" : "entries"}`
}

function CasEntries({ store }: { store: string }) {
  const [cursors, setCursors] = useState<string[]>([])
  const cursor = cursors.at(-1) ?? ""
  const list = useQuery<CasList>("cas.list", withStore(store, cursor ? { cursor, limit: PAGE_SIZE } : { limit: PAGE_SIZE }))
  const pin = useCommand<CasEntry>("cas.pin")
  const unpin = useCommand<CasEntry>("cas.unpin")
  const gc = useCommand<CasGCResult>("cas.gc")
  const [confirmingGC, setConfirmingGC] = useState(false)
  const [gcResult, setGCResult] = useState<CasGCResult | null>(null)

  const columns: Column<CasEntry>[] = [
    { id: "hash", header: "Hash", className: "font-mono text-xs font-medium", cell: (e) => e.hash },
    { id: "size", header: "Stored size", cell: (e) => <Bytes value={e.storedSize} /> },
    {
      id: "refs",
      header: "References",
      className: "font-mono text-xs",
      cell: (e) => (e.refCount === null ? <NoneCell label="reference count" /> : e.refCount),
    },
    { id: "state", header: "State", cell: (e) => <CasStateBadge entry={e} /> },
    { id: "modified", header: "Last modified", cell: (e) => <Timestamp value={e.lastModified ?? undefined} label="modified time" /> },
  ]

  function openGC() {
    gc.reset()
    setGCResult(null)
    setConfirmingGC(true)
  }

  async function runGC() {
    const result = await gc.execute(withStore(store, {}))
    if (result === undefined) return
    setGCResult(result)
    setConfirmingGC(false)
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Entries</h2>
        <Button variant="outline" onClick={openGC}>
          Run garbage collection
        </Button>
      </div>
      {gcResult ? (
        <p className="text-sm">
          {`Checked ${gcResult.scanned} index entries, deleted ${gcResult.deleted}, freed ${formatBytes(gcResult.freedBytes)}.`}
          {gcResult.errors > 0 ? ` ${gcResult.errors} could not be deleted.` : ""}
        </p>
      ) : null}
      <CommandAlert error={pin.error} title="Could not pin" />
      <CommandAlert error={unpin.error} title="Could not unpin" />

      <QueryBoundary title="CAS entries" query={list} skeletonRows={5}>
        {(data) => (
          <>
            <ResourceTable<CasEntry>
              columns={columns}
              rows={data.entries}
              rowKey={(e) => e.hash}
              caption={entriesCaption(data.entries.length, data.nextCursor !== null)}
              emptyMessage={
                data.nextCursor !== null
                  ? "Nothing on this page, but the driver has more to list."
                  : cursors.length > 0
                    ? "No more entries."
                    : "No CAS content stored yet."
              }
              rowActions={(e) =>
                !e.indexed ? null : e.pinned ? (
                  <Button variant="ghost" size="sm" aria-label={`Unpin ${e.hash}`} disabled={unpin.loading} onClick={() => void unpin.execute(withStore(store, { hash: e.hash }))}>
                    Unpin
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" aria-label={`Pin ${e.hash}`} disabled={pin.loading} onClick={() => void pin.execute(withStore(store, { hash: e.hash }))}>
                    Pin
                  </Button>
                )
              }
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>
                Previous page
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.nextCursor === null}
                onClick={() => data.nextCursor !== null && setCursors((c) => [...c, data.nextCursor as string])}
              >
                Next page
              </Button>
            </div>
          </>
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={confirmingGC}
        onOpenChange={(open) => !open && !gc.loading && setConfirmingGC(false)}
        title="Run garbage collection?"
        description={
          <span className="flex flex-col gap-2">
            <span>
              It deletes indexed entries that have no references and are not pinned. Nothing lowers a reference count today, so expect it to delete nothing. Blobs the index does not know are never touched.
            </span>
            <CommandAlert error={gc.error} title="Garbage collection failed" />
          </span>
        }
        confirmLabel="Run"
        destructive={false}
        pending={gc.loading}
        onConfirm={() => void runGC()}
      />
    </section>
  )
}
