import { useSyncExternalStore } from "react"

const QUERY = "(min-width: 1024px)"

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {}
  const media = window.matchMedia(QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

/**
 * Whether the inspector fits beside the ranking. Where the browser can't say
 * (jsdom has no matchMedia), it answers wide, so the inspector renders inline.
 */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window.matchMedia === "function"
        ? window.matchMedia(QUERY).matches
        : true,
    () => true
  )
}
