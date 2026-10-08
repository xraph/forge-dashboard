import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import type { FormEvent, ReactNode } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { WrongTypeBadge } from "../badges"
import type { FlagEvaluation } from "../flag-types"
import { FlagValue } from "./flag-value"

export interface EvaluateBarProps {
  tenantId: string
  userId: string
  onTenantId: (next: string) => void
  onUserId: (next: string) => void
  onEvaluate: () => void
  onClear: () => void
  /** An answer is being fetched. */
  busy?: boolean
  /** There is something to clear: a result, or text in an input. */
  canClear?: boolean
  /**
   * Why Evaluate cannot be pressed right now, said in a sentence. Present
   * means disabled: the button stays where it is and the reason sits beside
   * it, since a dimmed button with no explanation is a dead end.
   */
  disabledReason?: string
  /** The result, under the inputs. */
  children?: ReactNode
}

/**
 * "Evaluate as": the tenant and user an operator wants to ask the engine
 * about, and the buttons that ask it. It holds no state of its own. The page
 * holds what is typed and what was submitted, because those are two different
 * things: the result stays put while an operator edits the inputs, until they
 * press Evaluate again.
 *
 * A form, so Enter in either input evaluates.
 */
export function EvaluateBar({
  tenantId,
  userId,
  onTenantId,
  onUserId,
  onEvaluate,
  onClear,
  busy,
  canClear,
  disabledReason,
  children,
}: EvaluateBarProps) {
  function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in an input submits whatever the button says.
    if (!busy && disabledReason === undefined) onEvaluate()
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <form
        aria-label="Evaluate as"
        onSubmit={submit}
        className="flex flex-wrap items-end gap-x-3 gap-y-2"
      >
        <span className="self-center text-sm font-medium">Evaluate as</span>
        <div className="flex flex-col gap-1">
          <Label htmlFor="evaluate-tenant" className="text-xs text-muted-foreground">
            Tenant id
          </Label>
          <Input
            id="evaluate-tenant"
            className="w-44 font-mono"
            autoComplete="off"
            spellCheck={false}
            value={tenantId}
            onChange={(e) => onTenantId(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="evaluate-user" className="text-xs text-muted-foreground">
            User id
          </Label>
          <Input
            id="evaluate-user"
            className="w-44 font-mono"
            autoComplete="off"
            spellCheck={false}
            value={userId}
            onChange={(e) => onUserId(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            disabled={busy || disabledReason !== undefined}
            aria-describedby={disabledReason === undefined ? undefined : "evaluate-disabled-reason"}
          >
            {busy ? "Evaluating…" : "Evaluate"}
          </Button>
          <IconButton type="button" variant="outline" disabled={!canClear} onClick={onClear} label="Clear" />
        </div>
      </form>
      {disabledReason === undefined ? null : (
        <p id="evaluate-disabled-reason" className="text-sm text-muted-foreground">
          {disabledReason}
        </p>
      )}
      {children}
    </div>
  )
}

export interface EvaluationSummaryProps {
  evaluation: FlagEvaluation
  type: string
  /** What the answer was asked for. An id that was not given is absent. */
  tenantId?: string
  userId?: string
  /** The one-based number of the rule that decided it, when it is known. */
  ruleNumber?: number
  cacheTtlSeconds: number
  /** The page's rules are not the ones the engine walked. */
  mismatch?: boolean
}

function reasonSentence(props: EvaluationSummaryProps): string {
  const { evaluation, tenantId, ruleNumber } = props
  switch (evaluation.reason) {
    case "disabled":
      return "The flag is off, so the default is returned."
    case "tenantOverride":
      return `Tenant ${tenantId ?? ""} has an override.`
    case "rule":
      return ruleNumber === undefined
        ? "A rule decided it."
        : `Rule ${ruleNumber} decided it.`
    case "default":
      return "No rule matched, so the default is returned."
  }
}

/** Who the answer is for, in the words the operator typed. */
function forWhom(tenantId?: string, userId?: string): string {
  if (tenantId === undefined && userId === undefined) return "no tenant and no user"
  return [
    tenantId === undefined ? null : `tenant ${tenantId}`,
    userId === undefined ? null : `user ${userId}`,
  ]
    .filter((part) => part !== null)
    .join(", ")
}

/**
 * The engine's answer in sentences. It names the pair it is for, because the
 * inputs above can be edited after the answer arrived and a stale pair has to
 * be visible as one.
 *
 * A polite live region: an operator who pressed Evaluate is told the result
 * without having to go and find it.
 */
export function EvaluationSummary(props: EvaluationSummaryProps) {
  const { evaluation, type, tenantId, userId, cacheTtlSeconds, mismatch } = props
  return (
    <div
      role="status"
      data-slot="evaluation-result"
      className="flex flex-col gap-1 text-sm"
    >
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>Returns</span>
        <FlagValue value={evaluation.value} type={type} />
        {evaluation.valueMatchesType ? null : <WrongTypeBadge />}
        <span>for {forWhom(tenantId, userId)}.</span>
        <span>{reasonSentence(props)}</span>
      </p>
      {mismatch ? (
        <p className="text-muted-foreground">
          The rules shown here are not the ones the engine just checked, so some are left
          unmarked. Press Evaluate again.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        This is what this server answers now.
        {cacheTtlSeconds > 0
          ? ` Other servers may serve the previous answer for up to ${cacheTtlSeconds} seconds after a change.`
          : ""}
      </p>
    </div>
  )
}
