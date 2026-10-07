import { useId, useState } from "react"
import type { ReactNode } from "react"
import { usePoll, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import type { RunsList, RunState, SuitesList } from "../types"
import { RunsTable } from "./runs-table"
import { SettledBoundary } from "./settled-boundary"

/** The page size runs.list is asked for. Its default is 25 and its cap 100. */
export const RUNS_PAGE = 25
/** How often a list holding a running run is refreshed. */
export const RUN_POLL_MS = 3000

const STATES: { value: "" | RunState; label: string }[] = [
  { value: "", label: "Any state" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
]

/**
 * Runs, newest first, paged by offset (runs.list answers hasMore and no
 * total), filtered by state and, outside a suite, by suite. While any run on
 * the page is running the list refreshes every three seconds, and only while
 * the tab is visible.
 */
export function RunsList({
  suiteId,
  emptyAction,
}: {
  /** A suite's own runs. Without it the list covers every suite and offers a suite filter. */
  suiteId?: string
  emptyAction?: ReactNode
}) {
  const base = useId()
  const [state, setState] = useState<"" | RunState>("")
  const [chosenSuite, setChosenSuite] = useState("")
  const [offset, setOffset] = useState(0)
  const suites = useQuery<SuitesList>("suites.list", undefined, { enabled: suiteId === undefined })
  const scope = suiteId ?? chosenSuite
  // Empty filters are left out rather than sent as "".
  const params = {
    limit: RUNS_PAGE,
    offset,
    ...(scope !== "" && { suiteId: scope }),
    ...(state !== "" && { state }),
  }
  const runs = useQuery<RunsList>("runs.list", params)
  const running = runs.data?.items.some((r) => r.state === "running") ?? false
  usePoll(() => {
    if (running) runs.refetch()
  }, RUN_POLL_MS)

  const filtered = state !== "" || (suiteId === undefined && chosenSuite !== "")
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {suiteId === undefined && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${base}-suite`}>Suite</Label>
            <NativeSelect
              id={`${base}-suite`}
              value={chosenSuite}
              onChange={(e) => {
                setChosenSuite(e.target.value)
                setOffset(0)
              }}
            >
              <NativeSelectOption value="">Every suite</NativeSelectOption>
              {(suites.data?.items ?? []).map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${base}-state`}>State</Label>
          <NativeSelect
            id={`${base}-state`}
            value={state}
            onChange={(e) => {
              setState(e.target.value as "" | RunState)
              setOffset(0)
            }}
          >
            {STATES.map((s) => (
              <NativeSelectOption key={s.value} value={s.value}>
                {s.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <SettledBoundary title="Runs" query={runs} skeletonRows={5}>
        {(data) => {
          const first = data.items.length === 0 ? 0 : offset + 1
          const last = offset + data.items.length
          return (
            <div className="flex flex-col gap-2">
              <RunsTable
                runs={data.items}
                showSuite={suiteId === undefined}
                caption={
                  offset === 0 && !data.hasMore
                    ? `${data.items.length} ${data.items.length === 1 ? "run" : "runs"}, newest first`
                    : data.items.length === 0
                      ? "0 runs on this page"
                      : `Runs ${first} to ${last}, newest first`
                }
                emptyMessage={
                  offset > 0 ? "No runs on this page." : filtered ? "No runs match these filters." : "No runs yet."
                }
                emptyAction={filtered || offset > 0 ? undefined : emptyAction}
              />
              {(offset > 0 || data.hasMore) && (
                <nav aria-label="Pages of runs" className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - RUNS_PAGE))}
                  >
                    Newer runs
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!data.hasMore}
                    onClick={() => setOffset(offset + RUNS_PAGE)}
                  >
                    Older runs
                  </Button>
                </nav>
              )}
            </div>
          )
        }}
      </SettledBoundary>
    </div>
  )
}
