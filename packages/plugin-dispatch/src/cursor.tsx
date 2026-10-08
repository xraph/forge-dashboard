import { useState } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import type { Page } from "./types"

export function useCursor(filterKey: string) {
  const [state, setState] = useState<{
    key: string
    history: (string | null)[]
  }>({ key: filterKey, history: [null] })
  const history = state.key === filterKey ? state.history : [null]
  if (state.key !== filterKey) setState({ key: filterKey, history })
  return {
    cursor: history[history.length - 1],
    page: history.length,
    next: (cursor: string) =>
      setState({ key: filterKey, history: [...history, cursor] }),
    back: () =>
      setState({
        key: filterKey,
        history: history.slice(0, -1).length ? history.slice(0, -1) : [null],
      }),
    reset: () => setState({ key: filterKey, history: [null] }),
  }
}
export function CursorPager({
  result,
  paging,
  loading,
}: {
  result: Pick<Page<unknown>, "nextCursor" | "complete">
  paging: ReturnType<typeof useCursor>
  loading: boolean
}) {
  return (
    <nav
      aria-label="Cursor pages"
      className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
    >
      <span>
        Page {paging.page}
        {!result.complete ? " · Search incomplete" : ""}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={loading || paging.page === 1}
          onClick={paging.back}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loading || result.nextCursor === null}
          onClick={() => {
            if (result.nextCursor !== null) paging.next(result.nextCursor)
          }}
        >
          Next
        </Button>
      </div>
    </nav>
  )
}
export function EmptyResults({
  subject,
  filtered,
  complete,
  onReset,
  onRefresh,
  onContinue,
}: {
  subject: string
  filtered: boolean
  complete: boolean
  onReset: () => void
  onRefresh: () => void
  onContinue?: () => void
}) {
  return (
    <ZeroState
      title={
        !complete
          ? "No results in this portion"
          : filtered
            ? "No matching " + subject
            : "No " + subject + " yet"
      }
      body={
        !complete
          ? "The search is incomplete. Continue through the remaining records."
          : filtered
            ? "Try changing or clearing the filters."
            : "New records will appear here when they are created."
      }
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={
            !complete && onContinue
              ? onContinue
              : filtered
                ? onReset
                : onRefresh
          }
        >
          {!complete && onContinue
            ? "Continue search"
            : filtered
              ? "Clear filters"
              : "Refresh"}
        </Button>
      }
    />
  )
}
