import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
// Copied from plugin-relay, which copied it from plugin-authsome: plugin
// packages do not depend on each other. This is the third copy, so it is owed
// to kit; it stays here while kit carries another session's uncommitted edits.
import { useCallback, useState } from "react"

/**
 * Remembers the cursors already visited so a cursor-paged list can go back.
 *
 * The server answers `nextCursor` and says nothing about the previous page,
 * which is inherent to cursor paging rather than a gap in this contract: a
 * cursor names a position, so the only way back is to remember where you have
 * been. The first page is the absence of a cursor, which is why the stack's
 * bottom is `undefined` rather than a value.
 */
export function useCursorStack(): {
  cursor: string | undefined
  canGoBack: boolean
  next: (cursor: string) => void
  previous: () => void
  reset: () => void
} {
  const [stack, setStack] = useState<string[]>([])

  const next = useCallback((cursor: string) => {
    setStack((prev) => [...prev, cursor])
  }, [])
  const previous = useCallback(() => {
    setStack((prev) => prev.slice(0, -1))
  }, [])
  const reset = useCallback(() => setStack([]), [])

  return {
    cursor: stack[stack.length - 1],
    canGoBack: stack.length > 0,
    next,
    previous,
    reset,
  }
}

export interface CursorPagerProps {
  /** How many rows are on screen right now. */
  shown: number
  /** The whole result set, when the server bothered to count it. */
  total?: number
  /** The cursor for the next page, or absent when this is the last one. */
  nextCursor?: string
  onNext: (cursor: string) => void
  onPrevious: () => void
  canGoBack: boolean
}

/**
 * Previous and Next for a cursor-paged list.
 *
 * No page numbers, because a cursor cannot produce one. The count reads "25 of
 * 100" rather than "page 2 of 4" for the same reason, and drops to "25 shown"
 * when the server sent no total.
 *
 * Renders nothing at all when there is one page and nowhere to go, so a list
 * that fits on a screen does not carry two dead buttons.
 */
export function CursorPager({
  shown,
  total,
  nextCursor,
  onNext,
  onPrevious,
  canGoBack,
}: CursorPagerProps) {
  if (!canGoBack && !nextCursor) return null

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-2 text-sm text-muted-foreground"
    >
      <span>
        {total === undefined ? `${shown} shown` : `${shown} of ${total}`}
      </span>
      <span className="flex gap-2">
        <IconButton variant="outline" disabled={!canGoBack} onClick={onPrevious} label="Previous page" />
        <IconButton variant="outline" disabled={!nextCursor} onClick={() => nextCursor && onNext(nextCursor)} label="Next page" />
      </span>
    </nav>
  )
}
