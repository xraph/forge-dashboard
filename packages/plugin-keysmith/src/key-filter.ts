import { useSyncExternalStore } from "react"
import { useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { KeyDetail } from "./types"

/**
 * Where this plugin mounts. Keysmith declares no routed context dimension, so
 * its pages always live under "/@keysmith" (definePlugin makes the namespace
 * the extension name). test/key-filter.test.tsx checks this against the
 * platform's own mountPath.
 */
export const KEYSMITH_MOUNT = "/@keysmith"

const PARAM = "keyId"

/**
 * A link that carries a key in its query.
 *
 * Absolute on purpose. The host's link resolver appends the CURRENT search to
 * every scope-relative path, so "/usage?keyId=a" from a page already at
 * "?keyId=b" would come out as "?keyId=a?keyId=b". A path starting with the
 * scope sigil is passed through untouched.
 */
function withKey(path: string, id: string): string {
  return `${KEYSMITH_MOUNT}${path}?${new URLSearchParams({ [PARAM]: id })}`
}

/** The Rotations page, narrowed to one key. */
export function rotationsForKey(id: string): string {
  return withKey("/rotations", id)
}

/** The Usage page, with one key chosen. */
export function usageForKey(id: string): string {
  return withKey("/usage", id)
}

// Told after every change made through useSetKeyIdParam, so a reader never
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

function readKeyId(): string {
  return (new URLSearchParams(window.location.search).get(PARAM) ?? "").trim()
}

/**
 * The key id in the address, "" when there is none.
 *
 * The plugin API gives a page route params and no search, so this reads
 * `window.location.search`, as Trove's browser does. A navigation through the
 * host's router re-renders the page and the snapshot is read again; back and
 * forward fire `popstate`; `useSetKeyIdParam` tells its readers directly.
 */
export function useKeyIdParam(): string {
  return useSyncExternalStore(subscribe, readKeyId, () => "")
}

/**
 * Sets the key on one of this plugin's pages, or takes it off for "".
 *
 * Through the host's router, never a bare history write. The host carries
 * the router's search into every sidebar link and every resolved path, so a
 * key written behind its back comes back the moment you click one of them,
 * even after you cleared it. The price is a history entry per change, which
 * also means Back steps through the keys you chose.
 *
 * The path is absolute for the reason the links above are, and every other
 * query parameter stays as it was.
 */
export function useSetKeyIdParam(
  path: "/rotations" | "/usage",
): (id: string) => void {
  const navigateTo = useNavigateTo()
  return (id: string) => {
    const search = new URLSearchParams(window.location.search)
    if (id === "") search.delete(PARAM)
    else search.set(PARAM, id)
    const query = search.toString()
    navigateTo(`${KEYSMITH_MOUNT}${path}${query ? `?${query}` : ""}`)
    for (const listener of listeners) listener()
  }
}

/**
 * A key's name from keys.detail, for a filter that names a key the page has
 * no list entry for. Undefined while it loads, when it cannot be read, and
 * when `enabled` is false; the caller shows the id instead.
 */
export function useKeyName(id: string, enabled: boolean): string | undefined {
  const detail = useQuery<KeyDetail>(
    "keys.detail",
    { id },
    { enabled: enabled && id !== "" },
  )
  return detail.data?.key.name
}
