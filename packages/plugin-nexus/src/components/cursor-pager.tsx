import { useCallback, useState } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"

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
        <Button
          variant="outline"
          size="sm"
          disabled={!canGoBack || busy}
          onClick={onPrevious}
        >
          Previous page
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!nextCursor || busy}
          onClick={() => nextCursor && onNext(nextCursor)}
        >
          Next page
        </Button>
      </span>
    </nav>
  )
}
