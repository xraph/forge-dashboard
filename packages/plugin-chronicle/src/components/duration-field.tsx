import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { durationProblem } from "../policy"
import type { DurationUnit } from "../policy"

/** How long a policy keeps events, as a whole number of hours or days. */
export function DurationField({
  amount,
  unit,
  onChange,
  placeholder,
}: {
  amount: string
  unit: DurationUnit
  onChange: (amount: string, unit: DurationUnit) => void
  placeholder?: string
}) {
  const problem = durationProblem(amount, unit)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="policy-duration">Keep events for</Label>
      <div className="flex items-center gap-2">
        <Input
          id="policy-duration"
          className="w-28"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={amount}
          aria-invalid={problem !== null}
          onChange={(e) => onChange(e.target.value, unit)}
        />
        <NativeSelect
          aria-label="Duration unit"
          value={unit}
          onChange={(e) =>
            onChange(amount, e.target.value === "days" ? "days" : "hours")
          }
        >
          <NativeSelectOption value="hours">Hours</NativeSelectOption>
          <NativeSelectOption value="days">Days</NativeSelectOption>
        </NativeSelect>
      </div>
      {problem && <p className="text-sm text-destructive">{problem}</p>}
    </div>
  )
}
