import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useCallback, useState } from "react"

export function useCursorStack() {
  const [stack, setStack] = useState<string[]>([])
  return {
    cursor: stack.at(-1),
    canGoBack: stack.length > 0,
    next: useCallback((cursor: string) => setStack((s) => [...s, cursor]), []),
    previous: useCallback(() => setStack((s) => s.slice(0, -1)), []),
    reset: useCallback(() => setStack([]), []),
  }
}

export function CursorPager({
  shown,
  nextCursor,
  onNext,
  onPrevious,
  canGoBack,
  busy = false,
}: {
  shown: number
  nextCursor?: string
  onNext: (cursor: string) => void
  onPrevious: () => void
  canGoBack: boolean
  busy?: boolean
}) {
  if (!canGoBack && !nextCursor) return null
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"
    >
      <span>{shown} shown</span>
      <span className="flex gap-2">
        <IconButton variant="outline" disabled={!canGoBack || busy} onClick={onPrevious} label="Previous page" />
        <IconButton variant="outline" disabled={!nextCursor || busy} onClick={() => nextCursor && onNext(nextCursor)} label="Next page" />
      </span>
    </nav>
  )
}
