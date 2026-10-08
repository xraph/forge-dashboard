import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useEffect, useRef, useState } from "react"
import type { DragEvent, ReactNode } from "react"
import { usePluginClient } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Progress } from "@forge-go/dashboard-kit/components/progress"
import { humanBytes } from "../format"
import {
  cancelUpload,
  clearFinishedUploads,
  dismissUpload,
  enqueueUploads,
  replaceUpload,
  useUploads,
} from "../uploads"
import type { Upload } from "../uploads"

interface Destination {
  store: string
  bucket: string
  folder: string
  maxBytes: number | null
}

function hasFiles(event: { dataTransfer?: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files")
}

/**
 * The listing as a drop target. Native drag and drop: files are queued,
 * folders refused, since a folder entry would need a recursive walk the
 * contract has no batch for.
 */
export function UploadDropZone({ store, bucket, folder, maxBytes, disabled, children }: Destination & { disabled: boolean; children: ReactNode }) {
  const client = usePluginClient()
  const [dragging, setDragging] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  // A file dropped anywhere the page does not handle makes the browser open it
  // in this tab, which unloads the dashboard and kills every queued upload. So
  // while the zone is mounted, a stray file drag is swallowed at the window.
  useEffect(() => {
    function guard(event: globalThis.DragEvent) {
      // A zone that already handled this event owns its effect. Setting "none"
      // on a cancelled dragover tells the browser the drop is not allowed, so
      // it would never send `drop`.
      if (event.defaultPrevented || !hasFiles(event)) return
      event.preventDefault()
      if (event.type === "dragover" && event.dataTransfer) event.dataTransfer.dropEffect = "none"
    }
    window.addEventListener("dragover", guard)
    window.addEventListener("drop", guard)
    return () => {
      window.removeEventListener("dragover", guard)
      window.removeEventListener("drop", guard)
    }
  }, [])

  function onDragOver(event: DragEvent) {
    if (!hasFiles(event)) return
    event.preventDefault()
    if (disabled) {
      // Refuse the drop, but still own the event so the browser does not open the file.
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none"
      return
    }
    setDragging(true)
  }

  function onDrop(event: DragEvent) {
    if (!hasFiles(event)) return
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const files: File[] = []
    let folders = 0
    for (const item of Array.from(event.dataTransfer.items ?? [])) {
      if (item.kind !== "file") continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        folders++
        continue
      }
      const f = item.getAsFile()
      if (f) files.push(f)
    }
    setRefusal(folders > 0 ? "Folders can't be uploaded here. Drop the files inside them instead." : null)
    if (files.length > 0) enqueueUploads(client, { store, bucket, folder, maxBytes }, files)
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col gap-3"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        // relatedTarget is where the drag went. Null means it left the window
        // (or Escape was pressed); inside the zone means it only crossed a child.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDragEnd={() => setDragging(false)}
      onDrop={onDrop}
    >
      {children}
      {refusal ? <p className="text-sm text-destructive">{refusal}</p> : null}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed bg-background/90 text-sm">
          <span>Drop files to upload to</span>
          <span className="font-mono text-xs">{`${bucket}/${folder}`}</span>
          {maxBytes !== null ? <span className="text-xs text-muted-foreground">{`Up to ${humanBytes(maxBytes)} per file.`}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

export function UploadButton({ store, bucket, folder, maxBytes, disabled }: Destination & { disabled: boolean }) {
  const client = usePluginClient()
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Files to upload"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) enqueueUploads(client, { store, bucket, folder, maxBytes }, files)
          e.target.value = ""
        }}
      />
      <Button size="sm" disabled={disabled} onClick={() => input.current?.click()}>
        Upload files
      </Button>
    </>
  )
}

const STATE_LABEL: Record<Upload["state"], string> = {
  waiting: "Waiting",
  starting: "Starting",
  uploading: "Uploading",
  completing: "Confirming",
  done: "Uploaded",
  conflict: "Already exists",
  failed: "Failed",
  cancelled: "Cancelled",
}

/** Every upload in this tab, each on its own row with its own outcome. */
export function UploadTray() {
  const uploads = useUploads()
  if (uploads.length === 0) return null
  const finished = uploads.some((u) => ["done", "failed", "cancelled"].includes(u.state))
  return (
    <section aria-label="Uploads" className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{`Uploads (${uploads.length})`}</h3>
        {finished ? (
          <IconButton variant="ghost" onClick={clearFinishedUploads} label="Clear finished" />
        ) : null}
      </div>
      <ul className="flex flex-col gap-2 overflow-auto" style={{ maxHeight: "12rem" }}>
        {uploads.map((u) => {
          const pct = u.size > 0 ? Math.round((u.loaded / u.size) * 100) : 0
          return (
            <li key={u.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="block max-w-sm truncate font-mono text-xs" title={`${u.bucket}/${u.key}`}>
                  {`${u.bucket}/${u.key}`}
                </span>
                <span className="text-xs text-muted-foreground">{STATE_LABEL[u.state]}</span>
              </div>
              {u.state === "uploading" ? <Progress value={pct} aria-label={`Uploading ${u.key}`} /> : null}
              {u.message ? <p className={u.state === "conflict" ? "text-xs" : "text-xs text-destructive"}>{u.message}</p> : null}
              <div className="flex gap-2">
                {["waiting", "starting", "uploading"].includes(u.state) ? (
                  <Button size="sm" variant="ghost" onClick={() => cancelUpload(u.id)}>
                    Cancel
                  </Button>
                ) : null}
                {u.state === "conflict" ? (
                  <>
                    <IconButton variant="outline" onClick={() => replaceUpload(u.id)} label="Replace" />
                    <IconButton variant="ghost" onClick={() => dismissUpload(u.id)} label="Skip" />
                  </>
                ) : null}
                {["done", "failed", "cancelled"].includes(u.state) ? (
                  <IconButton variant="ghost" onClick={() => dismissUpload(u.id)} label="Dismiss" />
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
