import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { browserHref } from "../browser-location"
import { SettledBoundary } from "../components/settled-boundary"
import { StorePicker } from "../components/store-picker"
import { useActiveStore, withStore } from "../store"
import type { BucketRow, BucketsList } from "../types"

function bucketCaption(n: number): string {
  return `${n} ${n === 1 ? "bucket" : "buckets"}`
}

function columnsFor(meaning: BucketsList["createdAtMeaning"], store: string): Column<BucketRow>[] {
  const created = meaning === "created"
  return [
    {
      id: "name",
      header: "Name",
      className: "font-mono text-xs font-medium",
      cell: (b) => (
        <PluginLink to={browserHref(b.name, { store })} className="hover:underline">
          {b.name}
        </PluginLink>
      ),
    },
    {
      id: "time",
      header: created ? "Created" : "Last modified",
      cell: (b) => <Timestamp value={b.createdAt ?? undefined} label={created ? "creation time" : "modified time"} />,
    },
  ]
}

export const BucketsPage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const list = useQuery<BucketsList>("buckets.list", withStore(store, {}))
  const create = useCommand<{ name: string }>("buckets.create")
  const remove = useCommand<{ name: string }>("buckets.delete")
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  function openCreate() {
    create.reset()
    setCreating(true)
  }

  function openDelete(name: string) {
    remove.reset()
    setDeleting(name)
  }

  async function confirmDelete() {
    if (deleting === null) return
    const result = await remove.execute(withStore(store, { name: deleting }))
    // undefined means the client threw: the dialog stays open on its error.
    if (result === undefined) return
    setDeleting(null)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Buckets"
        description="Buckets as the driver reports them."
        actions={
          <div className="flex items-center gap-2">
            <StorePicker />
            <Button onClick={openCreate}>Create bucket</Button>
          </div>
        }
      />

      <SettledBoundary title="Buckets" query={list} skeletonRows={5}>
        {(data) => (
          <ResourceTable<BucketRow>
            columns={columnsFor(data.createdAtMeaning, store)}
            rows={data.buckets}
            rowKey={(b) => b.name}
            caption={bucketCaption(data.buckets.length)}
            emptyMessage="No buckets in this store yet. Create one to start storing objects."
            rowActions={(b) => (
              <Button variant="ghost" size="sm" aria-label={`Delete ${b.name}`} onClick={() => openDelete(b.name)}>
                Delete
              </Button>
            )}
          />
        )}
      </SettledBoundary>

      {creating ? (
        <CreateBucketDialog store={store} create={create} onClose={() => setCreating(false)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !remove.loading && setDeleting(null)}
        title={`Delete ${deleting ?? ""}?`}
        description="Only an empty bucket can be deleted. Trove refuses a bucket that still holds objects, and the CAS bucket while CAS is on."
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      >
        <CommandAlert error={remove.error} title="Could not delete the bucket" />
      </ConfirmDialog>
    </section>
  )
}

function CreateBucketDialog({
  store,
  create,
  onClose,
}: {
  store: string
  create: ReturnType<typeof useCommand<{ name: string }>>
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const canSubmit = name.trim() !== "" && !create.loading

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const result = await create.execute(withStore(store, { name }))
    if (result === undefined) return
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !create.loading && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create a bucket</DialogTitle>
            <DialogDescription>The driver decides which names it accepts.</DialogDescription>
          </DialogHeader>
          <CommandAlert error={create.error} title="Could not create the bucket" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bucket-name">Name</Label>
            <Input
              id="bucket-name"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.loading} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {create.loading ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
