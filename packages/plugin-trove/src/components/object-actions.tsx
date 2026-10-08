import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
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
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { browserHref, folderOf } from "../browser-location"
import { withStore } from "../store"
import type { BucketsList, ContentLink, ObjectHead, ObjectRow } from "../types"

const LIFETIMES = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 86400, label: "1 day" },
  { seconds: 604800, label: "7 days" },
]

export function ObjectActions({
  store,
  bucket,
  prefix,
  head,
  casBucket,
}: {
  store: string
  bucket: string
  prefix: string
  head: ObjectHead
  /** The CAS bucket when CAS is on, otherwise null. */
  casBucket: string | null
}) {
  const [open, setOpen] = useState<"share" | "copy" | "delete" | null>(null)
  const key = head.object.key
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {head.presign.available ? (
          <IconButton variant="outline" onClick={() => setOpen("share")} label="Share link" />
        ) : null}
        <IconButton variant="outline" onClick={() => setOpen("copy")} label="Copy to" />
        <IconButton variant="destructive" onClick={() => setOpen("delete")} label="Delete" />
      </div>
      {!head.presign.available ? (
        <p className="text-xs text-muted-foreground">{head.presign.reason ?? "Share links are not available for this object."}</p>
      ) : null}
      {open === "share" ? <ShareDialog store={store} bucket={bucket} objectKey={key} onClose={() => setOpen(null)} /> : null}
      {open === "copy" ? <CopyDialog store={store} bucket={bucket} objectKey={key} onClose={() => setOpen(null)} /> : null}
      <DeleteDialog
        open={open === "delete"}
        store={store}
        bucket={bucket}
        prefix={prefix}
        objectKey={key}
        refused={casBucket !== null && casBucket === bucket}
        onClose={() => setOpen(null)}
      />
    </div>
  )
}

function ShareDialog({ store, bucket, objectKey, onClose }: { store: string; bucket: string; objectKey: string; onClose: () => void }) {
  const presign = useCommand<ContentLink>("objects.presign")
  const [seconds, setSeconds] = useState(3600)

  async function submit(event: FormEvent) {
    event.preventDefault()
    await presign.execute(withStore(store, { bucket, key: objectKey, expiresSeconds: seconds }))
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !presign.loading && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Share link</DialogTitle>
            <DialogDescription>
              Anyone with this link can download the object until it expires. The link goes straight to the storage backend, so the dashboard cannot revoke it.
            </DialogDescription>
          </DialogHeader>
          <CommandAlert error={presign.error} title="Could not create the link" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="share-lifetime">Expires after</Label>
            <NativeSelect id="share-lifetime" value={String(seconds)} onChange={(e) => setSeconds(Number(e.target.value))}>
              {LIFETIMES.map((l) => (
                <NativeSelectOption key={l.seconds} value={String(l.seconds)}>
                  {l.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {presign.data ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-url">Link</Label>
              <Input id="share-url" aria-label="Share link URL" readOnly className="font-mono text-xs" value={presign.data.url} onFocus={(e) => e.target.select()} />
              <p className="text-xs text-muted-foreground">
                Expires <Timestamp value={presign.data.expiresAt} label="expiry" />
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={presign.loading} onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={presign.loading}>
              {presign.loading ? "Creating…" : "Create link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CopyDialog({ store, bucket, objectKey, onClose }: { store: string; bucket: string; objectKey: string; onClose: () => void }) {
  const buckets = useQuery<BucketsList>("buckets.list", withStore(store, {}))
  const copy = useCommand<ObjectRow>("objects.copy")
  const [dstBucket, setDstBucket] = useState(bucket)
  const [dstKey, setDstKey] = useState(objectKey)
  const [overwrite, setOverwrite] = useState(false)
  const [done, setDone] = useState<{ bucket: string; key: string } | null>(null)
  const exists = copy.error?.code === "CONFLICT" && copy.error.details?.exists === true
  const same = dstBucket === bucket && dstKey === objectKey
  const canSubmit = dstKey !== "" && !same && !copy.loading

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    // The last success was an answer to the last attempt, not this one.
    setDone(null)
    const result = await copy.execute(withStore(store, { srcBucket: bucket, srcKey: objectKey, dstBucket, dstKey, overwrite }))
    if (result !== undefined) {
      setDone({ bucket: dstBucket, key: dstKey })
      // The consent was spent on this copy. Another copy to the same key asks again.
      setOverwrite(false)
      return
    }
    // A failed attempt never leaves a Replace consent behind. If the key still
    // exists, the CONFLICT shows the checkbox again and the operator re-ticks it.
    setOverwrite(false)
  }

  // A new destination is a new question: the Replace consent was for the old
  // one, and the CONFLICT that showed the checkbox described the old one too.
  // The inputs are disabled while a copy runs, and this holds even if an edit
  // gets through: a reset mid-flight would end the pending state early, let
  // the dialog close and drop the command's failure.
  function pickDestination(change: () => void) {
    if (copy.loading) return
    change()
    setOverwrite(false)
    setDone(null)
    copy.reset()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !copy.loading && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Copy to</DialogTitle>
            <DialogDescription>Trove reads the object and writes it again under the new key. Copies within this store only.</DialogDescription>
          </DialogHeader>
          {exists ? null : <CommandAlert error={copy.error} title="Could not copy the object" />}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copy-bucket">Destination bucket</Label>
            <NativeSelect id="copy-bucket" value={dstBucket} disabled={copy.loading} onChange={(e) => pickDestination(() => setDstBucket(e.target.value))}>
              {(buckets.data?.buckets ?? [{ name: bucket, createdAt: null }]).map((b) => (
                <NativeSelectOption key={b.name} value={b.name}>
                  {b.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copy-key">Destination key</Label>
            <Input id="copy-key" className="font-mono text-xs" autoComplete="off" spellCheck={false} value={dstKey} disabled={copy.loading} onChange={(e) => pickDestination(() => setDstKey(e.target.value))} />
          </div>
          {exists ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">An object already exists at this key.</p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="copy-overwrite"
                  aria-labelledby="copy-overwrite-label"
                  checked={overwrite}
                  disabled={copy.loading}
                  onCheckedChange={(v) => setOverwrite(v === true)}
                />
                <span id="copy-overwrite-label" className="cursor-default text-sm select-none" onClick={() => !copy.loading && setOverwrite((v) => !v)}>
                  Replace the existing object
                </span>
              </div>
            </div>
          ) : null}
          {same ? <p className="text-xs text-muted-foreground">Pick a different bucket or key.</p> : null}
          {done ? (
            <p className="text-sm">
              Copied to{" "}
              <PluginLink to={browserHref(done.bucket, { store, prefix: folderOf(done.key), key: done.key })} className="font-mono text-xs hover:underline">
                {`${done.bucket}/${done.key}`}
              </PluginLink>
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={copy.loading} onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {copy.loading ? "Copying…" : "Copy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({
  open,
  store,
  bucket,
  prefix,
  objectKey,
  refused,
  onClose,
}: {
  open: boolean
  store: string
  bucket: string
  prefix: string
  objectKey: string
  refused: boolean
  onClose: () => void
}) {
  const remove = useCommand<{ key: string }>("objects.delete")
  const navigate = useNavigateTo()
  const [opened, setOpened] = useState(false)
  if (open && !opened) {
    setOpened(true)
    remove.reset()
  }
  if (!open && opened) setOpened(false)

  async function confirm() {
    const result = await remove.execute(withStore(store, { bucket, key: objectKey }))
    if (result === undefined) return
    onClose()
    navigate(browserHref(bucket, { store, prefix }))
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && !remove.loading && onClose()}
      title={`Delete ${objectKey}?`}
      description={
        refused
          ? "CAS manages this bucket, so Trove refuses to delete its objects here. Deleting one would leave the CAS index pointing at nothing."
          : "Trove deletes the key on the driver. There is no undo, and a key that is already gone counts as deleted."
      }
      confirmLabel="Delete"
      pending={remove.loading}
      confirmDisabled={refused}
      onConfirm={() => void confirm()}
    >
      <CommandAlert error={remove.error} title="Could not delete the object" />
    </ConfirmDialog>
  )
}
