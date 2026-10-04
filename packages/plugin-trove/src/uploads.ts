import { useSyncExternalStore } from "react"
import type { ContractError, ScopedClient } from "@forge-go/dashboard-plugin"
import { humanBytes } from "./format"
import { withStore } from "./store"
import type { UploadTicket } from "./types"

export type UploadState = "waiting" | "starting" | "uploading" | "completing" | "done" | "conflict" | "failed" | "cancelled"

export interface Upload {
  id: string
  store: string
  bucket: string
  key: string
  size: number
  state: UploadState
  loaded: number
  message?: string
}

interface Item extends Upload {
  file: File
  client: ScopedClient
  overwrite: boolean
  xhr?: XMLHttpRequest
}

const CONCURRENCY = 2
let items: Item[] = []
let snapshot: Upload[] = []
let counter = 0
const listeners = new Set<() => void>()

function publish() {
  snapshot = items.map(({ id, store, bucket, key, size, state, loaded, message }) => ({ id, store, bucket, key, size, state, loaded, message }))
  for (const listener of listeners) listener()
}

function update(id: string, patch: Partial<Item>) {
  items = items.map((item) => (item.id === id ? { ...item, ...patch } : item))
  publish()
}

function find(id: string): Item | undefined {
  return items.find((item) => item.id === id)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Every upload this tab has started, wherever the operator is now. Module
 * state, so an upload keeps going and stays visible when the operator opens
 * another prefix or leaves the browser and comes back.
 */
export function useUploads(): Upload[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

const ACTIVE: UploadState[] = ["starting", "uploading", "completing"]

function pump() {
  let running = items.filter((item) => ACTIVE.includes(item.state)).length
  for (const item of items) {
    if (running >= CONCURRENCY) break
    if (item.state !== "waiting") continue
    running++
    void run(item.id)
  }
}

function putFailure(status: number, body: string): { state: UploadState; message: string } {
  let message = ""
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === "string") message = parsed.error
  } catch {
    // Not JSON.
  }
  if (status === 409) return { state: "conflict", message: message || "An object with this key already exists." }
  if (status === 413) return { state: "failed", message: message || "The file is larger than the size the upload was started with." }
  if (status === 422) return { state: "failed", message: message || "A content scan blocked this upload." }
  if (status === 403) return { state: "failed", message: `The upload ticket was refused. ${message}`.trim() }
  return { state: "failed", message: message || `The content route answered ${status}.` }
}

function put(id: string, ticket: UploadTicket, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    update(id, { xhr })
    xhr.open("PUT", ticket.url)
    // Upload tickets go in this header, never in the URL: forge's tracing
    // records the query string.
    xhr.setRequestHeader("X-Trove-Ticket", ticket.ticket)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) update(id, { loaded: event.loaded })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(putFailure(xhr.status, xhr.responseText))
    }
    xhr.onerror = () => reject({ state: "failed", message: "The upload connection failed." })
    xhr.onabort = () => reject({ state: "cancelled", message: undefined })
    xhr.send(file)
  })
}

async function run(id: string) {
  const start = find(id)
  if (!start) return
  const { client, store, bucket, key, file, overwrite } = start
  update(id, { state: "starting", loaded: 0, message: undefined })
  let ticket: UploadTicket
  try {
    ticket = await client.command<UploadTicket>(
      "objects.beginUpload",
      withStore(store, { bucket, key, size: file.size, ...(file.type !== "" ? { contentType: file.type } : {}), overwrite }),
    )
  } catch (error) {
    const e = error as ContractError
    if (find(id)?.state === "cancelled") return
    if (e.code === "CONFLICT" && e.details?.exists === true) update(id, { state: "conflict", message: "An object with this key already exists." })
    else update(id, { state: "failed", message: e.message })
    pump()
    return
  }
  if (find(id)?.state === "cancelled") {
    pump()
    return
  }
  update(id, { state: "uploading" })
  try {
    await put(id, ticket, file)
  } catch (failure) {
    const f = failure as { state: UploadState; message?: string }
    update(id, { state: f.state, message: f.message, xhr: undefined })
    pump()
    return
  }
  update(id, { state: "completing", loaded: file.size, xhr: undefined })
  try {
    // completeUpload is a command, so its invalidates refresh the listing.
    await client.command("objects.completeUpload", withStore(store, { bucket, key }))
    update(id, { state: "done" })
  } catch (error) {
    update(id, { state: "failed", message: `Uploaded, but confirming it failed: ${(error as ContractError).message}. Refresh the listing to check.` })
  }
  pump()
}

/** Queues files for `bucket`, each under `folder` + its name. */
export function enqueueUploads(
  client: ScopedClient,
  dest: { store: string; bucket: string; folder: string; maxBytes: number | null },
  files: File[],
): void {
  for (const file of files) {
    counter += 1
    const tooBig = dest.maxBytes !== null && file.size > dest.maxBytes
    items = [
      ...items,
      {
        id: `up_${counter}`,
        store: dest.store,
        bucket: dest.bucket,
        key: `${dest.folder}${file.name}`,
        size: file.size,
        state: tooBig ? "failed" : "waiting",
        loaded: 0,
        message: tooBig ? `This file is larger than the ${humanBytes(dest.maxBytes ?? 0)} upload limit.` : undefined,
        file,
        client,
        overwrite: false,
      },
    ]
  }
  publish()
  pump()
}

export function cancelUpload(id: string): void {
  const item = find(id)
  if (!item) return
  if (item.state === "waiting" || item.state === "starting") {
    update(id, { state: "cancelled" })
    pump()
    return
  }
  if (item.state === "uploading") item.xhr?.abort()
}

/** Starts a conflicted upload again, this time replacing the existing object. */
export function replaceUpload(id: string): void {
  if (find(id)?.state !== "conflict") return
  update(id, { state: "waiting", overwrite: true, message: undefined })
  pump()
}

export function dismissUpload(id: string): void {
  items = items.filter((item) => item.id !== id)
  publish()
}

export function clearFinishedUploads(): void {
  items = items.filter((item) => !["done", "failed", "cancelled"].includes(item.state))
  publish()
}

/** Tests only: forget everything. */
export function resetUploads(): void {
  for (const item of items) item.xhr?.abort()
  items = []
  counter = 0
  publish()
}
