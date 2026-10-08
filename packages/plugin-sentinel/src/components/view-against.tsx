import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { formatThreshold } from "../format"
import type { BaselinesList } from "../types"

/** What this view compares against instead of the run's own answer. */
export interface ViewChoice {
  baselineId?: string
  threshold?: number
}

const THRESHOLD_RANGE = "threshold must be between 0 and 1"

/**
 * Compare this run against another of its suite's baselines, or at another
 * threshold, for this view only. Nothing is saved: the run keeps its recorded
 * threshold and the suite its current baseline.
 */
export function ViewAgainst({
  suiteId,
  recordedThreshold,
  choice,
  onChange,
  error,
}: {
  suiteId: string
  /** The threshold the run's own answer used, shown as the placeholder. */
  recordedThreshold?: number
  choice: ViewChoice | null
  onChange: (choice: ViewChoice | null) => void
  /** Why the server refused the last choice, if it did. */
  error?: string
}) {
  const id = useId()
  const baselines = useQuery<BaselinesList>("baselines.list", { suiteId })
  const [baselineId, setBaselineId] = useState(choice?.baselineId ?? "")
  const [threshold, setThreshold] = useState(choice?.threshold === undefined ? "" : String(choice.threshold))
  const [problem, setProblem] = useState<string | null>(null)
  const message = problem ?? error

  function apply(event: FormEvent) {
    event.preventDefault()
    const t = threshold.trim()
    const value = t === "" ? undefined : Number(t)
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) return setProblem(THRESHOLD_RANGE)
    setProblem(null)
    if (baselineId === "" && value === undefined) return onChange(null)
    onChange({ ...(baselineId !== "" && { baselineId }), ...(value !== undefined && { threshold: value }) })
  }

  function reset() {
    setBaselineId("")
    setThreshold("")
    setProblem(null)
    onChange(null)
  }

  return (
    <form onSubmit={apply} noValidate aria-label="View against" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-baseline`}>Baseline</Label>
          <NativeSelect id={`${id}-baseline`} value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
            <NativeSelectOption value="">The current baseline</NativeSelectOption>
            {(baselines.data?.items ?? []).map((b) => (
              <NativeSelectOption key={b.id} value={b.id}>
                {b.isCurrent ? `${b.name} (current)` : b.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-threshold`}>Threshold</Label>
          <Input
            id={`${id}-threshold`}
            inputMode="decimal"
            autoComplete="off"
            className="w-28"
            placeholder={recordedThreshold === undefined ? "" : formatThreshold(recordedThreshold)}
            value={threshold}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? `${id}-error` : `${id}-about`}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          Compare
        </Button>
        {choice && (
          <IconButton type="button" variant="ghost" onClick={reset} label="Back to the run's own answer" />
        )}
      </div>
      {message ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : (
        <p id={`${id}-about`} className="text-sm text-muted-foreground">
          For this view only. The run keeps its recorded threshold and the suite its current baseline.
        </p>
      )}
    </form>
  )
}
