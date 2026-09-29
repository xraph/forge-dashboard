import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { between, describeStatus, formatDuration } from "../lib/format"
import { JsonView } from "./json-view"

/** `deliveries.detail`'s attempt, from AttemptView in relay's contract. */
export interface Attempt {
  id: string
  attemptNum: number
  statusCode: number
  error?: string
  response?: string
  latencyMs: number
  outcome: "delivered" | "retry" | "dlq" | "endpoint_disabled"
  nextAttemptAt?: string
  attemptedAt: string
}

export interface RetryTimelineProps {
  attempts: Attempt[]
  state: string
  maxAttempts: number
  nextAttemptAt: string
  /** The endpoint's state now, when it still exists. */
  endpointEnabled?: boolean
}

const OUTCOME: Record<Attempt["outcome"], { word: string; dot: string }> = {
  delivered: { word: "Delivered", dot: "bg-foreground" },
  retry: {
    word: "Retry scheduled",
    dot: "border-2 border-muted-foreground bg-background",
  },
  dlq: { word: "Gave up", dot: "bg-destructive" },
  endpoint_disabled: { word: "Endpoint disabled", dot: "bg-destructive" },
}

/** A client error Relay does not retry: any 4xx but 429. */
function isClientError(code: number) {
  return code >= 400 && code < 500 && code !== 429
}

/** The word on a node. A 4xx sent to the DLQ was never retried, so it did not "give up". */
function outcomeWord(a: Attempt) {
  return a.outcome === "dlq" && isClientError(a.statusCode)
    ? "Not retried"
    : OUTCOME[a.outcome].word
}

/**
 * Why the sequence stopped, in one sentence. Three different endings with
 * three different fixes, which is the whole reason attempts record their
 * outcome: retries ran out, a client error that was never retried, or a
 * receiver that said it is gone.
 */
export function stoppedBecause(
  last: Attempt,
  endpointEnabled?: boolean
): string | null {
  switch (last.outcome) {
    case "delivered":
      return last.attemptNum === 1
        ? "Delivered first time."
        : `Delivered on attempt ${last.attemptNum}.`
    case "endpoint_disabled":
      return (
        "The receiver answered 410 Gone, so Relay disabled the endpoint." +
        (endpointEnabled ? " It has been enabled again since." : "")
      )
    case "dlq":
      if (isClientError(last.statusCode)) {
        return `Client error ${last.statusCode}, not retried. Sent to the dead letter queue.`
      }
      return `Gave up after ${last.attemptNum} ${last.attemptNum === 1 ? "attempt" : "attempts"}. Sent to the dead letter queue.`
    default:
      return null
  }
}

function Node({
  dot,
  afterGap = false,
  children,
}: {
  dot: string
  afterGap?: boolean
  children: React.ReactNode
}) {
  return (
    <li className="relative pb-6 pl-6 last:pb-0">
      {/* The dot marks the attempt, so under a "waited" line it sits one line lower. */}
      <span
        aria-hidden
        className={cn(
          "absolute -left-[5px] size-2.5 rounded-full",
          afterGap ? "top-[26px]" : "top-1.5",
          dot
        )}
      />
      {children}
    </li>
  )
}

/**
 * One node per attempt, oldest at the top. The line between two nodes
 * carries how long Relay waited, because on a backoff running from seconds
 * to an hour that gap is most of what tells you whether a receiver was down
 * or merely slow. The last node says why the sequence stopped.
 */
export function RetryTimeline({
  attempts,
  state,
  maxAttempts,
  nextAttemptAt,
  endpointEnabled,
}: RetryTimelineProps) {
  const last = attempts[attempts.length - 1]
  const reason = last ? stoppedBecause(last, endpointEnabled) : null

  return (
    <ol aria-label="Retry sequence" className="ml-1.5 border-l">
      {attempts.length === 0 && state !== "delivering" && (
        <Node dot="border-2 border-dashed border-muted-foreground bg-background">
          <p className="text-sm">Not attempted yet.</p>
          <p className="text-xs text-muted-foreground">
            Due <Timestamp value={nextAttemptAt} label="due time" />
          </p>
        </Node>
      )}
      {attempts.map((a, i) => {
        const outcome = OUTCOME[a.outcome]
        const prev = attempts[i - 1]
        const isLast = i === attempts.length - 1
        return (
          <Node key={a.id} dot={outcome.dot} afterGap={Boolean(prev)}>
            {prev && (
              <p className="mb-1 text-xs text-muted-foreground">
                waited {between(prev.attemptedAt, a.attemptedAt)}
              </p>
            )}
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">Attempt {a.attemptNum}</span>
              <span
                className={cn(
                  "tabular-nums",
                  a.statusCode === 0 || a.statusCode >= 400
                    ? "text-destructive"
                    : ""
                )}
              >
                {describeStatus(a.statusCode)}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatDuration(a.latencyMs)}
              </span>
              <span className="text-muted-foreground">{outcomeWord(a)}</span>
              <span className="text-xs text-muted-foreground">
                <Timestamp value={a.attemptedAt} label="attempt time" />
              </span>
            </p>
            {a.error && (
              <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
                {a.error}
              </p>
            )}
            {a.response && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Response body
                </summary>
                <div className="mt-2">
                  <JsonView
                    value={a.response}
                    label={`response to attempt ${a.attemptNum}`}
                  />
                </div>
              </details>
            )}
            {isLast && reason && (
              <p className="mt-2 text-sm font-medium">{reason}</p>
            )}
          </Node>
        )
      })}
      {state === "delivering" && (
        <Node dot="border-2 border-muted-foreground bg-background">
          <p className="text-sm">
            Attempt {attempts.length + 1} is being sent now.
          </p>
        </Node>
      )}
      {state === "pending" && attempts.length > 0 && (
        <Node dot="border-2 border-dashed border-muted-foreground bg-background">
          <p className="text-sm">
            Attempt {attempts.length + 1} of {maxAttempts} is due{" "}
            <Timestamp value={nextAttemptAt} label="next attempt time" />.
          </p>
        </Node>
      )}
    </ol>
  )
}
