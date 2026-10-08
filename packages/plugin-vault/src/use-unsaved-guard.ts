import { useEffect } from "react"

/**
 * Asks before the page is left with changes nobody saved.
 *
 * Two doors need watching. Closing the tab, reloading or typing another
 * address fires `beforeunload`, where the browser draws its own prompt. A link
 * inside the dashboard never reaches that: the router changes the URL without
 * unloading anything, so a click on the sidebar would throw the draft away
 * silently. A capture listener on the document sees the click before the
 * router's own handler and can stop it.
 *
 * Links that leave nothing behind are left alone: a modified click (new tab),
 * a link that opens elsewhere, a download, and a bare `#` anchor.
 */
export function useUnsavedGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return

    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Older browsers read this rather than the call above.
      event.returnValue = ""
    }

    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return
      const target = event.target instanceof Element ? event.target : null
      const link = target?.closest("a[href]")
      if (!link) return
      const href = link.getAttribute("href") ?? ""
      if (href === "" || href.startsWith("#")) return
      const to = link.getAttribute("target")
      if ((to !== null && to !== "_self") || link.hasAttribute("download"))
        return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener("beforeunload", beforeUnload)
    document.addEventListener("click", click, true)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      document.removeEventListener("click", click, true)
    }
  }, [active, message])
}
