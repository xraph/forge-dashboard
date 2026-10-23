import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import {
  ContractError,
  queryStore,
  usePluginClient,
  type ScopedClient,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"

interface ProtectedIdentity {
  result_ref?: string
  provenance?: { verification_required?: boolean }
  metadata?: Record<string, unknown>
}
export function contentProtected(run?: ProtectedIdentity): boolean {
  return !!(
    run?.result_ref ||
    run?.provenance?.verification_required ||
    run?.metadata?.content_withheld === true
  )
}
export interface PublishedResult {
  schema_version: number
  run_id: string
  result_id: string
  run_revision: string
  content: string
  publication_status: string
  content_changed: boolean
  verification_status: string
  verified_at: string
  checked_at: string
}
function validResult(
  value: unknown,
  runId: string,
  resultId: string
): value is PublishedResult {
  if (!value || typeof value !== "object") return false
  const r = value as PublishedResult
  return (
    r.schema_version === 1 &&
    r.run_id === runId &&
    r.result_id === resultId &&
    typeof r.run_revision === "string" &&
    /^[1-9][0-9]{0,18}$/.test(r.run_revision) &&
    BigInt(r.run_revision) <= 9223372036854775807n &&
    typeof r.content === "string" &&
    new TextEncoder().encode(r.content).length <= 1048576 &&
    r.verification_status === "passed" &&
    ["approved", "flagged", "redacted"].includes(r.publication_status) &&
    typeof r.content_changed === "boolean" &&
    (!r.content_changed || r.publication_status === "redacted") &&
    typeof r.verified_at === "string" &&
    Number.isFinite(Date.parse(r.verified_at)) &&
    typeof r.checked_at === "string" &&
    Number.isFinite(Date.parse(r.checked_at))
  )
}
export function resultFailure(error: unknown): string {
  const code = error instanceof ContractError ? error.details?.code : undefined
  switch (code) {
    case "result_denied":
      return "You no longer have access to this result."
    case "result_stale":
      return "This result no longer matches current verification."
    case "result_blocked":
      return "Current publication policy blocks this result."
    case "result_not_found":
      return "This result was not found in your current scope."
    case "result_limit":
      return "This result exceeds the publication size limit."
    case "result_invalid_response":
      return "The server returned an invalid result response."
    case "result_interrupted":
      return "The result check timed out. Try again."
    default:
      return "Result content is unavailable. Check the configured reader and try again."
  }
}
function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener)
  return () => document.removeEventListener("visibilitychange", listener)
}
const visibleSnapshot = () => document.visibilityState !== "hidden"

export function ProtectedResult({
  runId,
  resultId,
}: {
  runId: string
  resultId?: string
}) {
  const context = useSyncExternalStore(
    queryStore.subscribeContext,
    queryStore.contextSnapshot,
    queryStore.contextSnapshot
  )
  const visible = useSyncExternalStore(
    subscribeVisibility,
    visibleSnapshot,
    () => false
  )
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt((v) => v + 1), [])
  if (!resultId)
    return (
      <ZeroState
        title="No committed result yet"
        body="Content becomes available after the required checks pass and a result is committed."
      />
    )
  if (!visible)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Result content is hidden while this tab is inactive.
      </p>
    )
  return (
    <ResultAttempt
      key={`${context}:${runId}:${resultId}:${attempt}`}
      runId={runId}
      resultId={resultId}
      refresh={refresh}
    />
  )
}
function ResultAttempt({
  runId,
  resultId,
  refresh,
}: {
  runId: string
  resultId: string
  refresh: () => void
}) {
  const client = usePluginClient()
  const [state, setState] = useState<{
    client?: ScopedClient
    result?: PublishedResult
    error?: string
  }>({})
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let renew: ReturnType<typeof setTimeout> | undefined
    const timeout = setTimeout(() => {
      active = false
      controller.abort()
      setState({
        client,
        error: resultFailure(
          new ContractError("UNAVAILABLE", "", { code: "result_interrupted" })
        ),
      })
    }, 10_000)
    void client
      .query<unknown>(
        "runs.result",
        { id: runId, result_id: resultId },
        { signal: controller.signal }
      )
      .then(
        (value) => {
          if (!active) return
          clearTimeout(timeout)
          if (!validResult(value, runId, resultId)) {
            setState({
              client,
              error: resultFailure(
                new ContractError("UNAVAILABLE", "", {
                  code: "result_invalid_response",
                })
              ),
            })
            return
          }
          setState({ client, result: value })
          // This bounds local display retention, not the lifetime of a server grant.
          renew = setTimeout(refresh, 15_000)
        },
        (error) => {
          if (!active) return
          clearTimeout(timeout)
          setState({ client, error: resultFailure(error) })
        }
      )
    return () => {
      active = false
      controller.abort()
      clearTimeout(timeout)
      clearTimeout(renew)
    }
  }, [client, runId, resultId, refresh])
  const current = state.client === client ? state : {}
  return (
    <div className="grid min-w-0 gap-2" aria-label="Checked result">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {current.result ? (
          <span>
            Checked{" "}
            <Timestamp
              value={current.result.checked_at}
              label="publication check"
            />
          </span>
        ) : (
          <span role="status">
            {current.error
              ? "Result unavailable"
              : "Checking current access and publication policy…"}
          </span>
        )}
        <Button size="sm" variant="outline" onClick={refresh}>
          Check again
        </Button>
      </div>
      {current.error && (
        <p role="alert" className="text-sm text-destructive">
          {current.error}
        </p>
      )}
      {current.result && (
        <>
          <p className="text-xs text-muted-foreground">
            {current.result.content_changed
              ? "The original candidate was verified. This redacted projection has not been separately verified."
              : "The committed candidate passed its required checks."}{" "}
            Screening: {current.result.publication_status}.
          </p>
          {current.result.content ? (
            <pre
              aria-label="Checked result content"
              className="max-h-96 overflow-auto rounded-md bg-muted/40 p-3 text-sm break-words whitespace-pre-wrap"
            >
              {current.result.content}
            </pre>
          ) : (
            <p role="status" className="text-sm">
              {current.result.publication_status === "redacted"
                ? "Publication policy removed all result text."
                : "The checked result contains no text."}
            </p>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            Revision {current.result.run_revision}
          </span>
        </>
      )}
    </div>
  )
}
