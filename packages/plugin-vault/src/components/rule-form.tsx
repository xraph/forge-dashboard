import { useState } from "react"
import type { ReactNode } from "react"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { Slider } from "@forge-go/dashboard-kit/components/slider"
import type { FlagType } from "../flag-types"
import {
  MAX_PERCENTAGE,
  MIN_PERCENTAGE,
  isKeptType,
  scheduleProblem,
} from "../rule-draft"
import type { DraftRule } from "../rule-draft"
import { ChipInput } from "./chip-input"
import { ValueInput } from "./value-input"

export interface RuleFormProps {
  rule: DraftRule
  flagType: FlagType
  /** Merges into this rule. Safe to call from an effect: it never reads stale state. */
  onChange: (patch: Partial<DraftRule>) => void
}

function Field({
  label,
  htmlFor,
  labelId,
  children,
  hint,
}: {
  label: string
  htmlFor?: string
  labelId?: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={labelId} htmlFor={htmlFor}>
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

const DIGITS = /^\d{0,3}$/

/**
 * The slider and the number beside it, one value in two controls. The field
 * keeps its own text so a half-typed or out-of-range number can sit on screen
 * without becoming a percentage: the draft holds `undefined` until the text
 * is a whole number from 0 to 100.
 */
function Rollout({ rule, onChange }: Pick<RuleFormProps, "rule" | "onChange">) {
  const [text, setText] = useState(rule.percentage === undefined ? "" : String(rule.percentage))
  const idBase = `${rule.uid}-percentage`
  const n = text === "" ? undefined : Number(text)
  const invalid = rule.percentage === undefined
  const shown = rule.percentage ?? (n !== undefined && n > MAX_PERCENTAGE ? MAX_PERCENTAGE : MIN_PERCENTAGE)

  function fromSlider(next: number) {
    setText(String(next))
    onChange({ percentage: next })
  }

  function fromText(next: string) {
    if (!DIGITS.test(next)) return
    setText(next)
    const parsed = next === "" ? undefined : Number(next)
    onChange({
      percentage:
        parsed !== undefined && parsed >= MIN_PERCENTAGE && parsed <= MAX_PERCENTAGE
          ? parsed
          : undefined,
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <Label id={`${idBase}-label`} htmlFor={idBase}>
        Percentage of tenants
      </Label>
      <div className="flex items-center gap-3">
        <Slider
          aria-labelledby={`${idBase}-label`}
          min={MIN_PERCENTAGE}
          max={MAX_PERCENTAGE}
          step={1}
          value={[shown]}
          onValueChange={(next) => {
            const v = Array.isArray(next) ? next[0] : next
            if (typeof v === "number") fromSlider(v)
          }}
          className="max-w-xs"
        />
        <div className="flex items-center gap-1">
          <Input
            id={idBase}
            className="w-16 text-right font-mono tabular-nums"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={invalid || undefined}
            aria-describedby={`${idBase}-help`}
            value={text}
            onChange={(e) => fromText(e.target.value)}
          />
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            %
          </span>
        </div>
      </div>
      <p id={`${idBase}-help`} className="text-xs text-muted-foreground">
        Tenants whose bucket is under {rule.percentage ?? n ?? 0} get this value. Users without a
        tenant never match.
      </p>
      {invalid ? (
        <p className="text-sm text-destructive">
          Enter a whole number from {MIN_PERCENTAGE} to {MAX_PERCENTAGE}.
        </p>
      ) : null}
    </div>
  )
}

function Schedule({ rule, onChange }: Pick<RuleFormProps, "rule" | "onChange">) {
  const problem = scheduleProblem(rule)
  const errorId = `${rule.uid}-schedule-error`
  // The instant is not known to be wrong until both ends have been looked at,
  // so the message sits under the pair and both controls point at it.
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-4">
        <Field label="Start (UTC)" htmlFor={`${rule.uid}-start`}>
          <Input
            id={`${rule.uid}-start`}
            type="datetime-local"
            className="w-56"
            aria-invalid={problem !== undefined || undefined}
            aria-describedby={problem === undefined ? undefined : errorId}
            value={rule.startText}
            onChange={(e) => onChange({ startText: e.target.value })}
          />
        </Field>
        <Field label="End (UTC)" htmlFor={`${rule.uid}-end`}>
          <Input
            id={`${rule.uid}-end`}
            type="datetime-local"
            className="w-56"
            aria-invalid={problem !== undefined || undefined}
            aria-describedby={problem === undefined ? undefined : errorId}
            value={rule.endText}
            onChange={(e) => onChange({ endText: e.target.value })}
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Times are UTC. Leave one empty for no start or no end.
      </p>
      {problem !== undefined ? (
        <p id={errorId} className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The fields of one draft rule: whatever its type reads, then its return
 * value. A type the engine cannot match has no fields of its own, only a
 * sentence saying what it is, because editing a config the engine ignores
 * would suggest it does something.
 */
export function RuleForm({ rule, flagType, onChange }: RuleFormProps) {
  const valueId = `${rule.uid}-value`
  return (
    <div className="flex flex-col gap-4">
      {rule.type === "when_tenant" ? (
        <Field label="Tenant ids" htmlFor={`${rule.uid}-tenants`}>
          <ChipInput
            id={`${rule.uid}-tenants`}
            noun="tenant id"
            values={rule.tenantIds}
            onChange={(tenantIds) => onChange({ tenantIds })}
          />
        </Field>
      ) : null}
      {rule.type === "when_user" ? (
        <Field label="User ids" htmlFor={`${rule.uid}-users`}>
          <ChipInput
            id={`${rule.uid}-users`}
            noun="user id"
            values={rule.userIds}
            onChange={(userIds) => onChange({ userIds })}
          />
        </Field>
      ) : null}
      {rule.type === "rollout" ? <Rollout rule={rule} onChange={onChange} /> : null}
      {rule.type === "schedule" ? <Schedule rule={rule} onChange={onChange} /> : null}
      {rule.kept !== undefined ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {isKeptType(rule.type)
              ? "The engine cannot match this rule type yet, so it has no fields here. Saving keeps it exactly as it is. Remove it to drop it."
              : "The server does not accept this rule type. Remove it to save."}
          </p>
        </div>
      ) : null}
      <Field label="Return value" htmlFor={valueId} labelId={`${valueId}-label`}>
        <ValueInput
          id={valueId}
          aria-labelledby={`${valueId}-label`}
          type={flagType}
          value={rule.returnValue}
          onChange={(returnValue) => onChange({ returnValue })}
        />
      </Field>
    </div>
  )
}
