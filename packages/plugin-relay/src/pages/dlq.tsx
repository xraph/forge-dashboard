import { useState } from "react"
import type { CommandState } from "@forge-go/dashboard-plugin"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@forge-go/dashboard-kit/components/alert-dialog"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
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
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CursorPager, useCursorStack } from "../components/cursor-pager"
import { describeStatus } from "../lib/format"
import type { Ack, DLQEntrySummary, DLQPage } from "../types"

const DAY = 86_400_000

/** The copy every replay confirms with. It names the consequence. */
export function replayConsequence(url: string) {
  return `Relay will send this event to ${url} again now. The receiver gets a real webhook and cannot tell it apart from the original.`
}

/**
 * Single-entry replay, used by the list and the detail page. The caller owns
 * the command, so it can reset it when the dialog opens: one hook serves
 * every row, and a failure must not follow the operator to another row.
 */
export function ReplayDialog({
  entry,
  open,
  onOpenChange,
  replay,
  onConfirm,
}: {
  entry: Pick<DLQEntrySummary, "url"> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  replay: CommandState<Ack>
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Replay this webhook?"
      description={entry ? replayConsequence(entry.url) : ""}
      confirmLabel="Replay"
      pending={replay.loading}
      onConfirm={onConfirm}
    >
      <CommandAlert title="Could not replay it" error={replay.error} />
    </ConfirmDialog>
  )
}

/**
 * The dead letter queue: deliveries Relay gave up on.
 *
 * Replaying is the one thing on this page that reaches outside the
 * dashboard, so every replay confirms first and says plainly what it sends
 * and to whom. Replayed entries stay in the list, marked, because a second
 * replay would send the webhook twice and Relay refuses it.
 */
export function RelayDLQPage() {
  const [tenant, setTenant] = useState("")
  const [replayedFilter, setReplayedFilter] = useState("all")
  const pager = useCursorStack()
  const [target, setTarget] = useState<DLQEntrySummary | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [purgeOpen, setPurgeOpen] = useState(false)
  const replay = useCommand<Ack>("dlq.replay")

  const params: Record<string, unknown> = { limit: 50 }
  if (tenant.trim()) params.tenantId = tenant.trim()
  if (replayedFilter !== "all") params.replayed = replayedFilter === "replayed"
  if (pager.cursor) params.cursor = pager.cursor
  const query = useQuery<DLQPage>("dlq.list", params)

  const change = (set: (v: string) => void) => (v: string) => {
    set(v)
    pager.reset()
  }

  function openReplay(entry: DLQEntrySummary) {
    replay.reset()
    setNotice(null)
    setTarget(entry)
  }

  async function confirmReplay() {
    if (!target) return
    const ok = await replay.execute({ id: target.id })
    if (ok === undefined) return
    setTarget(null)
    setNotice(`Replayed. A new delivery to ${target.url} is queued.`)
  }

  const columns: Column<DLQEntrySummary>[] = [
    {
      id: "event",
      header: "Event type",
      className: "font-medium",
      cell: (r) => (
        <PluginLink
          to={`/dlq/${r.id}`}
          className="underline underline-offset-4"
        >
          {r.eventType}
        </PluginLink>
      ),
    },
    {
      id: "url",
      header: "Endpoint",
      cell: (r) => <span className="break-all">{r.url}</span>,
    },
    {
      id: "response",
      header: "Response",
      cell: (r) => (
        <span className="text-destructive tabular-nums">
          {describeStatus(r.lastStatusCode)}
        </span>
      ),
    },
    {
      id: "tenant",
      header: "Tenant",
      className: "font-mono text-xs",
      cell: (r) => r.tenantId,
    },
    {
      id: "failed",
      header: "Failed",
      cell: (r) => <Timestamp value={r.failedAt} label="failure time" />,
    },
    {
      id: "replayed",
      header: "Replayed",
      // The badge only: the time is on the entry's page, and a timestamp
      // here pushed the Replay buttons out of view.
      cell: (r) =>
        r.replayedAt ? (
          <Badge variant="secondary">Replayed</Badge>
        ) : (
          <NoneCell label="replay yet" />
        ),
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Dead letters"
        description="Deliveries Relay gave up on. Replaying one sends the webhook again."
        actions={
          <>
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              Replay a time window
            </Button>
            <Button variant="outline" onClick={() => setPurgeOpen(true)}>
              Delete old entries
            </Button>
          </>
        }
      />
      {notice && (
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      <FilterBar
        search={{
          value: tenant,
          onChange: change(setTenant),
          label: "Tenant",
          placeholder: "Filter by tenant",
        }}
        filters={[
          {
            id: "replayed",
            label: "Replayed",
            value: replayedFilter,
            onChange: change(setReplayedFilter),
            options: [
              { label: "All", value: "all" },
              { label: "Not replayed", value: "not-replayed" },
              { label: "Replayed", value: "replayed" },
            ],
          },
        ]}
      />
      <QueryBoundary title="Dead letters" query={query} skeletonRows={6}>
        {(data) => {
          const rows = data.entries ?? []
          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<DLQEntrySummary>
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                caption={`${rows.length} ${rows.length === 1 ? "entry" : "entries"} on this page`}
                emptyMessage={
                  tenant.trim() || replayedFilter !== "all"
                    ? "No dead letters match these filters."
                    : "The dead letter queue is empty. Every delivery either arrived or is still being retried."
                }
                rowActions={(r) =>
                  r.replayedAt ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Replay ${r.eventType} to ${r.url}`}
                      onClick={() => openReplay(r)}
                    >
                      Replay
                    </Button>
                  )
                }
              />
              <CursorPager
                shown={rows.length}
                nextCursor={data.nextCursor}
                onNext={pager.next}
                onPrevious={pager.previous}
                canGoBack={pager.canGoBack}
              />
            </div>
          )
        }}
      </QueryBoundary>

      <ReplayDialog
        entry={target}
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        replay={replay}
        onConfirm={() => void confirmReplay()}
      />
      <BulkReplayDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onDone={setNotice}
      />
      <PurgeDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        onDone={setNotice}
      />
    </section>
  )
}

const WINDOWS = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
]

/**
 * Replays every entry that failed in a window and has not been replayed.
 *
 * The templ page did this from one link with no confirmation over a
 * hardcoded year. Here the window is chosen, and the dialog says how many
 * webhooks it is about to send before the button can send them.
 */
function BulkReplayDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (notice: string) => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {/* Mounted only while open: each opening starts from a fresh window
            and a fresh command, and the count is never asked for while
            nobody is looking. */}
        {open && (
          <BulkReplayBody onClose={() => onOpenChange(false)} onDone={onDone} />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function BulkReplayBody({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (notice: string) => void
}) {
  const [days, setDays] = useState("1")
  // Fixed when the window is chosen, so the preview's params, and with them
  // its cache key, stay still while the dialog is open.
  const [range, setRange] = useState(() => windowFor("1"))
  const bulk = useCommand<{ replayed: number }>("dlq.replayBulk")
  const preview = useQuery<{ replayable: number; alreadyReplayed: number }>(
    "dlq.bulkPreview",
    range
  )

  function choose(v: string) {
    setDays(v)
    setRange(windowFor(v))
    bulk.reset()
  }

  async function confirm() {
    const res = await bulk.execute(range)
    if (res === undefined) return
    onClose()
    onDone(
      `Replayed ${res.replayed} ${res.replayed === 1 ? "webhook" : "webhooks"}.`
    )
  }

  const count = preview.data?.replayable
  const skipped = preview.data?.alreadyReplayed ?? 0

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Replay a time window</AlertDialogTitle>
        <AlertDialogDescription>
          Every dead letter that failed in the window and has not been replayed
          is sent again now. Each receiver gets a real webhook.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bulk-window">Failed in</Label>
        <NativeSelect
          id="bulk-window"
          value={days}
          onChange={(e) => choose(e.target.value)}
        >
          {WINDOWS.map((w) => (
            <NativeSelectOption key={w.value} value={w.value}>
              {w.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <p role="status" className="text-sm">
        {count === undefined
          ? "Counting…"
          : count === 0
            ? "Nothing in this window to replay."
            : `${count} ${count === 1 ? "webhook" : "webhooks"} will be sent.`}
        {skipped > 0 && ` ${skipped} already replayed will be skipped.`}
      </p>
      <CommandAlert
        title="Could not replay the window"
        error={bulk.error ?? preview.error}
      />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={bulk.loading}>Cancel</AlertDialogCancel>
        <Button
          variant="destructive"
          disabled={bulk.loading || !count}
          onClick={() => void confirm()}
        >
          {bulk.loading ? "Working…" : count ? `Replay ${count}` : "Replay"}
        </Button>
      </AlertDialogFooter>
    </>
  )
}

function windowFor(days: string) {
  const to = new Date()
  return {
    from: new Date(to.getTime() - Number(days) * DAY).toISOString(),
    to: to.toISOString(),
  }
}

const AGES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "a year" },
]

/** Deletes entries that failed before a cutoff. They cannot be replayed afterwards. */
function PurgeDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: (notice: string) => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {open && (
          <PurgeBody onClose={() => onOpenChange(false)} onDone={onDone} />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function PurgeBody({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (notice: string) => void
}) {
  const [age, setAge] = useState("90")
  const purge = useCommand<{ purged: number }>("dlq.purge")

  async function confirm() {
    const res = await purge.execute({
      before: new Date(Date.now() - Number(age) * DAY).toISOString(),
    })
    if (res === undefined) return
    onClose()
    onDone(`Deleted ${res.purged} ${res.purged === 1 ? "entry" : "entries"}.`)
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete old dead letters</AlertDialogTitle>
        <AlertDialogDescription>
          Entries that failed before the cutoff are deleted for good and can no
          longer be replayed.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="purge-age">Older than</Label>
        <NativeSelect
          id="purge-age"
          value={age}
          onChange={(e) => setAge(e.target.value)}
        >
          {AGES.map((a) => (
            <NativeSelectOption key={a.value} value={a.value}>
              {a.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <CommandAlert title="Could not delete them" error={purge.error} />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={purge.loading}>Cancel</AlertDialogCancel>
        <Button
          variant="destructive"
          disabled={purge.loading}
          onClick={() => void confirm()}
        >
          {purge.loading ? "Working…" : "Delete"}
        </Button>
      </AlertDialogFooter>
    </>
  )
}
