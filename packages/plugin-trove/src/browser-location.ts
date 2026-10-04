import { useMemo, useSyncExternalStore } from "react"

/**
 * Where this plugin mounts. Trove declares no routed context dimension, so
 * its pages always live under "/@trove" (definePlugin makes the namespace the
 * extension name). test/browser-location.test.tsx checks this against the
 * platform's own mountPath.
 */
export const TROVE_MOUNT = "/@trove"

export interface BrowserLocation {
  /** "" means the default store. */
  store: string
  prefix: string
  /** The selected object's full key, "" when nothing is selected. */
  key: string
}

/**
 * The browser's address for a bucket, prefix and selected key.
 *
 * Absolute on purpose. The host's link resolver appends the CURRENT search to
 * every scope-relative path, so "/buckets/x?prefix=a" from a page already at
 * "?prefix=b" would come out as "?prefix=a?prefix=b". A path starting with the
 * scope sigil is passed through untouched, by PluginLink and useNavigateTo
 * alike.
 */
export function browserHref(bucket: string, loc: Partial<BrowserLocation> = {}): string {
  const query = new URLSearchParams()
  if (loc.store) query.set("store", loc.store)
  if (loc.prefix) query.set("prefix", loc.prefix)
  if (loc.key) query.set("key", loc.key)
  const q = query.toString()
  return `${TROVE_MOUNT}/buckets/${encodeURIComponent(bucket)}${q ? `?${q}` : ""}`
}

export function parseBrowserSearch(search: string): BrowserLocation {
  const query = new URLSearchParams(search)
  return {
    store: query.get("store") ?? "",
    prefix: query.get("prefix") ?? "",
    key: query.get("key") ?? "",
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

/**
 * The browser's place, read from the address bar.
 *
 * The plugin API gives a page route params and no search, so this reads
 * `window.location.search`. A navigation through the host's router re-renders
 * the page, and the snapshot is read again on that render; back and forward
 * fire `popstate`, which this subscribes to.
 */
export function useBrowserLocation(): BrowserLocation {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  )
  return useMemo(() => parseBrowserSearch(search), [search])
}

/** The prefix up to and including its last "/": the folder being listed. */
export function folderOf(prefix: string): string {
  return prefix.slice(0, prefix.lastIndexOf("/") + 1)
}

/** A key as shown under `folder`: the folder part dropped, nothing else changed. */
export function displayName(key: string, folder: string): string {
  return folder !== "" && key.startsWith(folder) ? key.slice(folder.length) : key
}
