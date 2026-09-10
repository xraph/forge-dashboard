import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { AckResponse } from "./users"

/** `webhooks.list` / `webhooks.detail`'s row shape. */
export interface WebhookSummary {
  id: string
  url: string
  events: string[]
  active: boolean
  createdAt: string
}

/** `WebhookDetail` embeds `WebhookSummary` in Go, so the JSON is flat. */
export interface WebhookDetail extends WebhookSummary {
  appId?: string
  envId?: string
  updatedAt: string
}

export interface WebhooksList {
  webhooks: WebhookSummary[]
}

/**
 * A cell whose value is legitimately absent renders a dash an assistive
 * reader can still announce, rather than nothing at all.
 */
function NoneCell() {
  return <span aria-label="None">–</span>
}

/**
 * The inline edit panel for one webhook.
 *
 * Mounted with `key={webhook.id}` by the page below, so switching which row
 * is being edited always throws this component away and remounts a fresh
 * one. That gives every row its own `useCommand` state for free - an error
 * or a half-typed URL left over from the last row this panel pointed at
 * never survives to the next one, without needing an explicit `reset()`
 * call the way a single shared `ConfirmDialog` hook would.
 */
function EditWebhookPanel({
  webhook,
  onDone,
}: {
  webhook: WebhookSummary
  onDone: () => void
}) {
  const update = useCommand<AckResponse>("webhooks.update")
  const [url, setUrl] = useState(webhook.url)
  const [eventsInput, setEventsInput] = useState(webhook.events.join(", "))
  const [active, setActive] = useState(webhook.active)

  // The contract takes `string[]` for events and never enumerates valid
  // ones, so this is a plain comma-separated text field: split on save,
  // trim each entry and drop the empties. A select box built from event
  // names we guessed would be worse than a text field that at least never
  // lies about what is allowed.
  const parsedEvents = eventsInput
    .split(",")
    .map((event) => event.trim())
    .filter((event) => event !== "")
  // Two arrays with the same contents are never `===`, so the comparison
  // that decides whether `events` belongs in the payload has to be on the
  // joined strings, not the arrays themselves - otherwise an untouched
  // events list would be re-sent, as a "changed" value, on every save.
  const eventsChanged = parsedEvents.join(",") !== webhook.events.join(",")

  // `webhooks.update` takes pointers: a field the operator did not touch
  // must be absent from the payload, not sent as "" or as the same array
  // reconstructed from scratch.
  const changed: Record<string, unknown> = { id: webhook.id }
  if (url !== webhook.url) changed.url = url
  if (eventsChanged) changed.events = parsedEvents
  if (active !== webhook.active) changed.active = active
  const dirty = Object.keys(changed).length > 1

  async function submit() {
    const result = await update.execute(changed)
    // `execute` resolves with undefined on failure and never rejects, so
    // this is the success check. A failed save must not close the panel and
    // throw away what the operator typed.
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Edit webhook</h2>
      <CommandAlert error={update.error} title="Could not save" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-edit-url">URL</Label>
        <Input id="webhook-edit-url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webhook-edit-events">Events</Label>
        <Input
          id="webhook-edit-events"
          value={eventsInput}
          onChange={(e) => setEventsInput(e.target.value)}
          placeholder="user.created, user.deleted"
        />
        <span className="text-xs text-muted-foreground">
          Comma-separated. The server does not enumerate valid events, so anything typed here is
          sent as-is.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Label id="webhook-edit-active-label">Active</Label>
        <Switch
          id="webhook-edit-active"
          aria-labelledby="webhook-edit-active-label"
          checked={active}
          onCheckedChange={setActive}
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={update.loading || !dirty}>
          {update.loading ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={update.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Webhooks, list and detail together on one page.
 *
 * A webhook is four fields, so a separate detail route for it would be
 * ceremony: the row IS the detail, and editing happens through an inline
 * panel rather than a navigation.
 */
export function AuthWebhooksPage() {
  const [editing, setEditing] = useState<WebhookSummary | null>(null)
  const [deleting, setDeleting] = useState<WebhookSummary | null>(null)

  const list = useQuery<WebhooksList>("webhooks.list")
  // One shared hook for the toggle, since it belongs to the page (every row
  // reaches for the same intent) rather than to any single row.
  const toggle = useCommand<AckResponse>("webhooks.update")
  const remove = useCommand<AckResponse>("webhooks.delete")

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result !== undefined) setDeleting(null)
  }

  const columns: Column<WebhookSummary>[] = [
    { id: "url", header: "URL", cell: (w) => w.url, className: "font-medium" },
    {
      id: "events",
      header: "Events",
      cell: (w) => (w.events.length > 0 ? w.events.join(", ") : <NoneCell />),
    },
    {
      id: "active",
      header: "Active",
      cell: (w) => (
        <Badge variant={w.active ? "outline" : "secondary"}>
          {w.active ? "active" : "inactive"}
        </Badge>
      ),
    },
    { id: "createdAt", header: "Created", cell: (w) => formatTimestamp(w.createdAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Webhooks" />

      {/*
        The toggle's error lives above the table rather than inside a dialog,
        because unlike delete it never opens one - there is nothing here that
        Base UI would mark inert.
      */}
      <CommandAlert error={toggle.error} title="Could not update the webhook" />

      <QueryBoundary title="Webhooks" query={list} skeletonRows={4}>
        {(data) => {
          const webhooks = data.webhooks ?? []
          const caption = `${webhooks.length} ${webhooks.length === 1 ? "webhook" : "webhooks"}`

          return (
            <ResourceTable<WebhookSummary>
              columns={columns}
              rows={webhooks}
              rowKey={(w) => w.id}
              caption={caption}
              emptyMessage="No webhooks yet."
              rowActions={(webhook) => (
                <>
                  <Switch
                    aria-label={`Toggle active for ${webhook.url}`}
                    checked={webhook.active}
                    disabled={toggle.loading}
                    onCheckedChange={(checked) =>
                      void toggle.execute({ id: webhook.id, active: checked })
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${webhook.url}`}
                    onClick={() => setEditing(webhook)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Delete webhook ${webhook.url}`}
                    onClick={() => {
                      // Reset at open, not at close: the operator is about to
                      // read whatever this dialog shows for THIS webhook, so
                      // a failure left over from a previous row's delete must
                      // not be attributed to one they have not touched.
                      remove.reset()
                      setDeleting(webhook)
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      {editing && (
        <EditWebhookPanel key={editing.id} webhook={editing} onDone={() => setEditing(null)} />
      )}

      {/*
        The error lives inside the dialog's description, not above the table.
        Base UI marks everything outside an open AlertDialog `inert` and
        `aria-hidden`, so an alert rendered up here is unreachable for as long
        as the dialog that can actually fail is open.
      */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this webhook?"
        description={
          <span className="flex flex-col gap-2">
            <span>
              {deleting?.url ?? "It"} stops receiving events immediately. This cannot be undone.
            </span>
            <CommandAlert error={remove.error} title="Could not delete" />
          </span>
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
