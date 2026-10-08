import { useSyncExternalStore } from "react"
import { useNavigateTo } from "@forge-go/dashboard-plugin"

/**
 * Where this plugin mounts. Weave declares no routed context dimension, so
 * its pages always live under "/@weave" (definePlugin makes the namespace
 * the extension name). test/links.test.tsx checks it against mountPath.
 */
export const WEAVE_MOUNT = "/@weave"

const seg = (id: string) => encodeURIComponent(id)

// Scope-relative: no query, so the host's resolver can place them.
export const collectionPath = (id: string) => `/collections/${seg(id)}`
export const collectionEditPath = (id: string) => `/collections/${seg(id)}/edit`
export const collectionIngestPath = (id: string) =>
  `/collections/${seg(id)}/ingest`
export const documentPath = (id: string) => `/documents/${seg(id)}`
export const chunkPath = (id: string) => `/chunks/${seg(id)}`

export interface DocumentFilter {
  collection_id?: string
  state?: string
}

/**
 * Absolute on purpose. The host appends the current search to every
 * scope-relative path, so a relative "/documents?state=failed" written on a
 * page already at "?state=ready" would come out with two query strings. A
 * path starting with the scope sigil passes through untouched.
 */
function absolute(path: string, query: [string, string | undefined][]): string {
  const q = new URLSearchParams()
  for (const [k, v] of query) if (v) q.set(k, v)
  const s = q.toString()
  return `${WEAVE_MOUNT}${path}${s ? `?${s}` : ""}`
}

export function documentsHref(filter: DocumentFilter = {}): string {
  return absolute("/documents", [
    ["collection_id", filter.collection_id],
    ["state", filter.state],
  ])
}

export function chunksHref(collectionId?: string): string {
  return absolute("/chunks", [["collection_id", collectionId]])
}

// Told after every change made through useSetSearchParams, so a reader never
// waits on the host to re-render it.
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener("popstate", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("popstate", onChange)
  }
}

/**
 * One query parameter from the address bar, "" when absent. The plugin API
 * gives a page route params and no search, so this reads
 * window.location.search, as Trove's browser and Keysmith's key filter do.
 */
export function useSearchParam(name: string): string {
  return useSyncExternalStore(
    subscribe,
    () => (new URLSearchParams(window.location.search).get(name) ?? "").trim(),
    () => ""
  )
}

/**
 * Sets query parameters on one of this plugin's list pages, deleting any set
 * to "". Through the host's router, replacing the current entry: changing a
 * filter tidies the page you are on, so Back leaves the page rather than
 * stepping back through every filter you tried. Other parameters stay.
 */
export function useSetSearchParams(
  path: "/documents" | "/chunks"
): (changes: Record<string, string>) => void {
  const navigateTo = useNavigateTo()
  return (changes) => {
    const search = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(changes)) {
      if (v === "") search.delete(k)
      else search.set(k, v)
    }
    const s = search.toString()
    navigateTo(`${WEAVE_MOUNT}${path}${s ? `?${s}` : ""}`, { replace: true })
    for (const listener of listeners) listener()
  }
}
