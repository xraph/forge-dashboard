import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
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
import { HeraldHeader } from "../components/herald-header"
import { plural } from "../format"
import { useDebounced } from "../use-debounced"
import type {
  DeleteResponse,
  InboxListResponse,
  InboxOKResponse,
  NotificationWire,
} from "../wire"

const PAGE_SIZE = 25

/*
 * Herald writes type = the template slug and title = the rendered title, so a
 * raw-body send leaves both empty. The row still has to be readable and
 * actionable, so its controls and its delete dialog fall back to the ID.
 */
/*
 * Three full timestamps on one line each pushed the row actions past the right
 * edge at laptop widths, where the table scrolls sideways and Mark read and
 * Delete were out of sight. Titles and times wrap instead.
 */
const columns: Column<NotificationWire>[] = [
  {
    id: "title",
    header: "Title",
    className: "font-medium whitespace-normal",
    cell: (n) => (n.title === "" ? <NoneCell label="title" /> : n.title),
  },
  {
    id: "type",
    header: "Type",
    className: "font-mono text-xs",
    cell: (n) => (n.type === "" ? <NoneCell label="type" /> : n.type),
  },
  {
    id: "read",
    header: "Read",
    className: "whitespace-normal",
    cell: (n) =>
      n.read ? <Timestamp value={n.readAt} label="read time" /> : "Unread",
  },
  {
    id: "created",
    header: "Created",
    className: "whitespace-normal",
    cell: (n) => <Timestamp value={n.createdAt} label="creation time" />,
  },
  {
    id: "expires",
    header: "Expires",
    className: "whitespace-normal",
    cell: (n) => <Timestamp value={n.expiresAt} label="expiry" />,
  },
]

/** What a notification is called in a control's label or a dialog title: its title, else its ID. */
const nameOf = (n: NotificationWire) => (n.title === "" ? n.id : n.title)

export const InboxPage: ComponentType<PluginPageProps> = () => {
  const [typed, setTyped] = useState("")
  const userId = useDebounced(typed.trim(), 300)
  const pager = useCursorStack()
  const markRead = useCommand<InboxOKResponse>("inbox.markRead")
  const markAll = useCommand<InboxOKResponse>("inbox.markAllRead")
  const remove = useCommand<DeleteResponse>("inbox.delete")
  /*
   * Every command here invalidates inbox.list, and the boundary swaps its
   * children for a skeleton while that refetches (and drops its data if the
   * refetch fails). So the commands, both dialogs and what the dialogs talk
   * about all live out here. Each dialog reads a snapshot taken when it
   * opened, and the snapshot stays after close so the dialog keeps its words
   * while it animates out.
   */
  const [target, setTarget] = useState<NotificationWire | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [markAllFor, setMarkAllFor] = useState<{
    userId: string
    unread: number
  } | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  /*
   * A cursor belongs to the user who was read when it was issued. Going back
   * to the first page happens when the settled user changes, not on every
   * keystroke, so the page stays put while you type. The guard on `cursor`
   * covers the one render between the user changing and the reset landing.
   */
  const [pagedFor, setPagedFor] = useState(userId)
  if (pagedFor !== userId) {
    setPagedFor(userId)
    pager.reset()
    markRead.reset()
  }
  const cursor = pagedFor === userId ? pager.cursor : undefined

  // Absent, never "": params are the query's cache key.
  const params: Record<string, unknown> = { userId, limit: PAGE_SIZE }
  if (cursor) params.cursor = cursor
  const list = useQuery<InboxListResponse>("inbox.list", params, {
    enabled: userId !== "",
  })

  function openDelete(n: NotificationWire) {
    remove.reset()
    setTarget(n)
    setDeleting(true)
  }

  async function confirmDelete() {
    if (!target) return
    const result = await remove.execute({ id: target.id })
    if (result === undefined) return
    setDeleting(false)
  }

  function openMarkAll(forUser: string, unread: number) {
    markAll.reset()
    setMarkAllFor({ userId: forUser, unread })
    setMarkingAll(true)
  }

  async function confirmMarkAll() {
    if (!markAllFor) return
    const result = await markAll.execute({ userId: markAllFor.userId })
    if (result === undefined) return
    setMarkingAll(false)
  }

  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader
        title="Inbox"
        description="One user's in-app notifications in this app."
      />
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="inbox-user">User ID</Label>
        <Input
          id="inbox-user"
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <CommandAlert
        error={markRead.error}
        title="Could not mark the notification read"
      />
      {userId === "" ? (
        <p className="text-sm text-muted-foreground">
          Enter a user ID to see their in-app notifications.
        </p>
      ) : (
        <QueryBoundary title="Inbox" query={list} skeletonRows={6}>
          {(data) => (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-end">
                <IconButton
                  variant="outline"
                  disabled={data.unread === 0}
                  onClick={() => openMarkAll(userId, data.unread)}
                  label="Mark all read"
                />
              </div>
              <ResourceTable<NotificationWire>
                columns={columns}
                rows={data.notifications}
                rowKey={(n) => n.id}
                caption={`${plural(data.notifications.length, "notification")} on this page, ${data.unread} unread in total`}
                emptyMessage={
                  pager.canGoBack
                    ? "Nothing further."
                    : `No notifications for ${userId} in this app.`
                }
                rowActions={(n) => (
                  <>
                    {!n.read && (
                      <IconButton
                        variant="outline"
                        disabled={markRead.loading}
                        onClick={() => {
                          markRead.reset()
                          void markRead.execute({ id: n.id })
                        }}
                        label={`Mark ${nameOf(n)} read`}
                      />
                    )}
                    <IconButton
                      variant="ghost"
                      onClick={() => openDelete(n)}
                      label={`Delete ${nameOf(n)}`}
                    />
                  </>
                )}
              />
              <CursorPager
                shown={data.notifications.length}
                nextCursor={data.nextCursor}
                onNext={pager.next}
                onPrevious={pager.previous}
                canGoBack={pager.canGoBack}
              />
            </div>
          )}
        </QueryBoundary>
      )}
      <ConfirmDialog
        open={markingAll}
        onOpenChange={(open) =>
          !open && !markAll.loading && setMarkingAll(false)
        }
        title={`Mark all of ${markAllFor?.userId ?? ""}'s notifications read?`}
        description={`This marks ${plural(markAllFor?.unread ?? 0, "unread notification")} read for ${markAllFor?.userId ?? ""}. It can't be undone from here.`}
        confirmLabel="Mark all read"
        destructive={false}
        pending={markAll.loading}
        onConfirm={() => void confirmMarkAll()}
      >
        <CommandAlert error={markAll.error} title="Could not mark them read" />
      </ConfirmDialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => !open && !remove.loading && setDeleting(false)}
        title={
          target === null
            ? "Delete the notification?"
            : target.title === ""
              ? `Delete notification ${target.id}?`
              : `Delete "${target.title}"?`
        }
        description={`This removes the notification from ${target?.userId ?? ""}'s inbox. It cannot be undone.`}
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert
          error={remove.error}
          title="Could not delete the notification"
        />
      </ConfirmDialog>
    </section>
  )
}
