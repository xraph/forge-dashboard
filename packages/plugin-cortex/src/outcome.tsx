import { State } from "./components"
import type { LiveEvent } from "./types"

export interface ExecutionOutcome {
  state: string
  stop_reason?: string
  verification_status?: string
  result_ref?: string
  provenance?: { publication_status?: string }
}

const terminalStates = [
  "completed",
  "incomplete",
  "failed",
  "cancelled",
  "paused",
]
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined

export function liveOutcome(
  events: LiveEvent[],
  closed: boolean,
  saved?: ExecutionOutcome
): ExecutionOutcome {
  if (saved && terminalStates.includes(saved.state)) return saved
  const event = [...events]
    .reverse()
    .find((item) =>
      ["done", "incomplete", "error", "suspended"].includes(item.event)
    )
  if (!event) return { state: closed ? "unknown" : "running" }
  const state =
    event.event === "done"
      ? "completed"
      : event.event === "suspended"
        ? "paused"
        : event.event === "error"
          ? "failed"
          : event.data.state === "cancelled"
            ? "cancelled"
            : "incomplete"
  return {
    state,
    stop_reason: text(event.data.stop_reason),
    verification_status: text(event.data.verification_status),
    result_ref: text(event.data.result_ref),
    provenance: { publication_status: text(event.data.publication_status) },
  }
}

export function OutcomeSummary({ outcome }: { outcome: ExecutionOutcome }) {
  let verification = outcome.verification_status || "unchecked"
  if (
    verification === "passed" &&
    (outcome.state !== "completed" || !outcome.result_ref)
  ) {
    verification = "inconsistent"
  } else if (
    ![
      "unchecked",
      "pending",
      "passed",
      "failed",
      "inconclusive",
      "stale",
    ].includes(verification)
  ) {
    verification = "unknown"
  }
  const screening = outcome.provenance?.publication_status || "unknown"
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      aria-label="Execution outcome"
    >
      <State value={outcome.state} />
      {outcome.stop_reason && (
        <span>Stopped: {outcome.stop_reason.replaceAll("_", " ")}</span>
      )}
      <span>Verification: {verification}</span>
      <span title="Content screening does not establish factual correctness">
        Screening: {screening}
      </span>
    </div>
  )
}
