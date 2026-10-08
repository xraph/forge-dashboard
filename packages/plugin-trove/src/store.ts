import { useSyncExternalStore } from "react"

/**
 * Which store the pages are looking at. "" means the default store, and then
 * every request leaves `store` out, which is what the contract reads as the
 * default. The choice is module state, so every page shares it, and it is
 * remembered for the browser tab in sessionStorage.
 */
const STORAGE_KEY = "forge.trove.store"

function readRemembered(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

let active = readRemembered()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setActiveStore(name: string): void {
  if (name === active) return
  active = name
  try {
    if (name === "") window.sessionStorage.removeItem(STORAGE_KEY)
    else window.sessionStorage.setItem(STORAGE_KEY, name)
  } catch {
    // Storage is unavailable: the choice lasts until the page reloads.
  }
  for (const listener of listeners) listener()
}

export function useActiveStore(): string {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => active
  )
}

/** params plus `store`, or params alone for the default store. */
export function withStore<T extends Record<string, unknown>>(
  store: string,
  params: T
): T & { store?: string } {
  return store === "" ? params : { ...params, store }
}
