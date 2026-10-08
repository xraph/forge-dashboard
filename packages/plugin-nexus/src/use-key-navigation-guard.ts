import { useLayoutEffect, useRef } from "react"

const popGuards = new Set<(event: PopStateEvent) => void>()
// Imported by the plugin entry before the host mounts BrowserRouter. Window
// POP listeners run in registration order, including capture listeners.
if (typeof window !== "undefined")
  window.addEventListener("popstate", (event) => {
    for (const guard of popGuards) guard(event)
  })

// Keep the component holding a one-time result or uncertain attempt mounted.
// The host uses BrowserRouter's indexed history. Restore that entry when
// Navigation API cancellation is unavailable or disallowed.
export function useKeyNavigationGuard(locked: boolean) {
  const active = useRef(false)
  useLayoutEffect(() => {
    active.current = locked
    if (!locked) return
    const index: unknown = window.history.state?.idx
    const href = window.location.href
    let restoring = false
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation
    const navigate = (event: Event) => {
      const destination = (event as Event & { destination?: { url: string } })
        .destination
      if (restoring && destination?.url === href) return
      if (active.current && event.cancelable) event.preventDefault()
    }
    const pop = (event: PopStateEvent) => {
      if (!active.current && !restoring) return
      const next: unknown = event.state?.idx
      if (typeof index !== "number" || typeof next !== "number") return
      event.stopImmediatePropagation()
      if (next === index) {
        restoring = false
        return
      }
      restoring = true
      window.history.go(index - next)
    }
    const click = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!active.current || !anchor || anchor.hasAttribute("data-key-exit"))
        return
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        anchor.getAttribute("target") === "_blank"
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (!active.current) return
      event.preventDefault()
      event.returnValue = ""
    }
    navigation?.addEventListener("navigate", navigate)
    popGuards.add(pop)
    document.addEventListener("click", click, true)
    window.addEventListener("beforeunload", unload)
    return () => {
      active.current = false
      navigation?.removeEventListener("navigate", navigate)
      popGuards.delete(pop)
      document.removeEventListener("click", click, true)
      window.removeEventListener("beforeunload", unload)
    }
  }, [locked])
  return () => {
    active.current = false
  }
}
