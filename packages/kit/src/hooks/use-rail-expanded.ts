import * as React from "react"

export const RAIL_STORAGE_KEY = "forge-dashboard.rail"

function readStored(): boolean {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === "expanded"
  } catch {
    return false
  }
}

/**
 * Whether the rail shows labels. Per browser, not per scope, and
 * collapsed until somebody widens it. Storage that throws (private windows,
 * blocked site data) leaves the rail working and merely forgetful.
 */
export function useRailExpanded(): { expanded: boolean; toggle: () => void } {
  const [expanded, setExpanded] = React.useState(readStored)
  const toggle = React.useCallback(() => {
    setExpanded((value) => {
      const next = !value
      try {
        window.localStorage.setItem(RAIL_STORAGE_KEY, next ? "expanded" : "collapsed")
      } catch {
        // Nothing to do: the state still flips, it just will not survive a reload.
      }
      return next
    })
  }, [])
  return { expanded, toggle }
}
