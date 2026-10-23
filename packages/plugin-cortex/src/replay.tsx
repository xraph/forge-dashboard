import { useCallback, useEffect, useRef, useState } from "react"
import { useCommand, usePluginClient } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { OutcomeSummary } from "./outcome"
import { ProtectedResult } from "./result"
import type { Run, RunDetail } from "./types"

const eventTypes = [
  "execution_finished",
  "verification_pending",
  "verification_failed",
  "verification_inconclusive",
  "verification_stale",
  "verification_passed",
  "artifact_created",
  "result_committed",
]
interface ReplayEvent {
  schema_version: number
  id: string
  type: string
  run_id: string
  observed_at: string
}
interface ReplayPage {
  gap: boolean
  next_cursor: string
  page: {
    events: ReplayEvent[]
    watermark: { run_id: string; schema_version: number }
  }
}
function validPage(value: unknown, id: string): value is ReplayPage {
  if (!value || typeof value !== "object") return false
  const r = value as ReplayPage
  return (
    typeof r.gap === "boolean" &&
    typeof r.next_cursor === "string" &&
    r.next_cursor.startsWith(`1.${id}.`) &&
    /^[0-9]+$/.test(r.next_cursor.slice(`1.${id}.`.length)) &&
    r.next_cursor.length <= 128 &&
    r.page?.watermark?.run_id === id &&
    r.page.watermark.schema_version === 1 &&
    Array.isArray(r.page.events) &&
    r.page.events.length <= 128 &&
    (!r.gap || r.page.events.length === 0) &&
    r.page.events.every(
      (e) =>
        e.schema_version === 1 &&
        e.run_id === id &&
        typeof e.id === "string" &&
        eventTypes.includes(e.type) &&
        typeof e.observed_at === "string" &&
        Number.isFinite(Date.parse(e.observed_at))
    )
  )
}
function settled(r: Run): boolean {
  if (["incomplete", "failed", "cancelled", "paused"].includes(r.state))
    return true
  if (r.state !== "completed") return false
  if (r.verification_status === "passed") return !!r.result_ref
  if (["failed", "inconclusive", "stale"].includes(r.verification_status ?? ""))
    return true
  return (
    !r.provenance?.verification_required &&
    r.verification_status === "unchecked"
  )
}
export function DurableLiveRun({
  id,
  onDone,
}: {
  id: string
  onDone: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt((v) => v + 1), [])
  return (
    <DurableAttempt
      key={`${id}:${attempt}`}
      id={id}
      onDone={onDone}
      refresh={refresh}
    />
  )
}
function DurableAttempt({
  id,
  onDone,
  refresh,
}: {
  id: string
  onDone: () => void
  refresh: () => void
}) {
  const client = usePluginClient()
  const cancel = useCommand("runs.cancel")
  const [stopping, setStopping] = useState(false)
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])
  const [view, setView] = useState<{
    run?: Run
    events: ReplayEvent[]
    gap: boolean
    error?: string
    done?: boolean
  }>({ events: [], gap: false })
  useEffect(() => {
    let active = true,
      cursor = "",
      rows: ReplayEvent[] = [],
      gap = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const expires = Date.now() + 300_000
    const pump = async () => {
      if (!active) return
      if (Date.now() >= expires) {
        setView({
          events: rows,
          gap,
          error:
            "Live monitoring paused after five minutes. Check again to continue.",
        })
        return
      }
      if (document.visibilityState === "hidden") {
        timer = setTimeout(pump, 500)
        return
      }
      controller = new AbortController()
      timeout = setTimeout(() => {
        controller?.abort()
        if (active) {
          active = false
          setView({
            events: [],
            gap,
            error: "The metadata read timed out. Check again.",
          })
        }
      }, 10_000)
      try {
        const response = await client.query<unknown>(
          "runs.replay",
          { id, after: cursor, limit: 128 },
          { signal: controller.signal }
        )
        if (!active) return
        if (!validPage(response, id)) throw new Error("Invalid metadata page")
        // A gap always refreshes the saved snapshot before accepting the new cursor.
        const detail = await client.query<RunDetail>(
          "runs.detail",
          { id },
          { signal: controller.signal }
        )
        if (!active) return
        if (detail?.run?.id !== id) throw new Error("Invalid run snapshot")
        if (response.gap) {
          rows = []
          gap = true
        }
        const seen = new Set(rows.map((e) => e.id))
        rows = [
          ...rows,
          ...response.page.events.filter((e) => !seen.has(e.id)),
        ].slice(-256)
        cursor = response.next_cursor
        const done = settled(detail.run) && response.page.events.length < 128
        setView({ run: detail.run, events: rows, gap, done })
        clearTimeout(timeout)
        if (done) {
          doneRef.current()
          return
        }
        timer = setTimeout(pump, response.page.events.length === 128 ? 0 : 1000)
      } catch {
        if (!active) return
        clearTimeout(timeout)
        setView({
          events: [],
          gap,
          error:
            "Live metadata is unavailable or access was denied. Check again, or open the saved run.",
        })
      }
    }
    void pump()
    return () => {
      active = false
      controller?.abort()
      clearTimeout(timer)
      clearTimeout(timeout)
    }
  }, [client, id])
  return (
    <article
      className="grid min-w-0 gap-2 rounded-md border p-3"
      aria-label="Protected run progress"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OutcomeSummary outcome={view.run ?? { state: "running" }} />
        <div className="flex flex-wrap gap-2">
          {!view.done && (
            <Button
              size="sm"
              variant="outline"
              disabled={cancel.loading || stopping}
              onClick={async () => {
                if ((await cancel.execute({ id })) !== undefined)
                  setStopping(true)
              }}
            >
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={refresh}>
            Check progress again
          </Button>
        </div>
      </div>
      {cancel.error && (
        <p role="alert" className="text-sm text-destructive">
          The stop request failed or access was denied.
        </p>
      )}
      {view.error ? (
        <p role="alert" className="text-sm text-destructive">
          {view.error}
        </p>
      ) : (
        <>
          {view.gap && (
            <p role="status" className="text-xs text-muted-foreground">
              Some earlier events expired. The saved run was refreshed before
              replay continued.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {view.done
              ? "Saved execution state loaded."
              : "Waiting for execution and verification updates."}
          </p>
          <ol
            className="grid gap-1 text-xs text-muted-foreground"
            aria-label="Recent verification events"
          >
            {view.events.slice(-8).map((e) => (
              <li key={e.id}>{e.type.replaceAll("_", " ")}</li>
            ))}
          </ol>
          {view.run && (
            <ProtectedResult runId={id} resultId={view.run.result_ref} />
          )}
        </>
      )}
    </article>
  )
}
