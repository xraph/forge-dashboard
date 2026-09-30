import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import type { ReportPeriod } from "../types"

export interface PeriodDraft {
  from: string
  to: string
}

/**
 * What is wrong with the two dates, or null. Both or neither: the server
 * refuses one alone, and "neither" means the last 90 days.
 */
export function periodProblem({ from, to }: PeriodDraft): string | null {
  if (from === "" && to === "") return null
  if (from === "" || to === "") return "Give both dates, or neither for the last 90 days."
  // ISO dates compare correctly as strings.
  if (to < from) return "The end date cannot be before the start date."
  return null
}

/**
 * The period as RFC3339, or undefined when neither date was given. A date
 * input holds a day, not an instant, so the period is the whole of each day in
 * UTC: the start's first second to the end's last.
 */
export function periodPayload({ from, to }: PeriodDraft): ReportPeriod | undefined {
  if (from === "" || to === "") return undefined
  return { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` }
}

/** The optional period, as two date fields with the problem shown once. */
export function PeriodFields({ value, onChange, idPrefix }: { value: PeriodDraft; onChange: (next: PeriodDraft) => void; idPrefix: string }) {
  const problem = periodProblem(value)
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">Period (optional, UTC)</legend>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`${idPrefix}-from`} className="sr-only">
          Period start
        </Label>
        <Input id={`${idPrefix}-from`} type="date" className="w-40" value={value.from} aria-invalid={problem !== null} onChange={(e) => onChange({ ...value, from: e.target.value })} />
        <span aria-hidden="true">to</span>
        <Label htmlFor={`${idPrefix}-to`} className="sr-only">
          Period end
        </Label>
        <Input id={`${idPrefix}-to`} type="date" className="w-40" value={value.to} aria-invalid={problem !== null} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </div>
      {problem ? (
        <p className="text-sm text-destructive">{problem}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Leave both empty for the last 90 days.</p>
      )}
    </fieldset>
  )
}
