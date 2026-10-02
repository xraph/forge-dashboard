import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@forge-go/dashboard-kit/components/field"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import {
  RadioGroup,
  RadioGroupItem,
} from "@forge-go/dashboard-kit/components/radio-group"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { maskedKey } from "../format"
import type {
  KeyRotated,
  KeySummary,
  PolicyRef,
  PreviousKey,
  RotationReason,
} from "../types"
import { EndGraceDialog } from "./end-grace-dialog"
import { OneTimeKey } from "./one-time-key"

/** The longest window the server accepts: 90 days. */
const MAX_GRACE_SECONDS = 7776000
const GRACE_INVALID = "Grace must be between 0 hours and 90 days."
const DEFAULT_GRACE_HOURS = 24
const COMPROMISE_WARNING = "The current key stops working the moment you rotate."

type Unit = "hours" | "days"
const UNIT_SECONDS: Record<Unit, number> = { hours: 3600, days: 86400 }

const REASONS: { value: RotationReason; label: string }[] = [
  { value: "manual", label: "Routine rotation" },
  { value: "compromise", label: "Suspected compromise" },
  { value: "policy", label: "Policy change" },
]

interface Grace {
  value: string
  unit: Unit
}

/**
 * What the grace field shows before anyone edits it. A policy's window is
 * shown in days when it divides into them and in hours otherwise; with no
 * policy window the field shows the engine's own 24 hours.
 */
function presetGrace(policy: PolicyRef | null): Grace & { seconds: number | null } {
  const seconds = policy?.graceSeconds ?? null
  if (seconds === null) {
    return { value: String(DEFAULT_GRACE_HOURS), unit: "hours", seconds: null }
  }
  if (seconds > 0 && seconds % UNIT_SECONDS.days === 0) {
    return { value: String(seconds / UNIT_SECONDS.days), unit: "days", seconds }
  }
  return {
    value: String(Number((seconds / UNIT_SECONDS.hours).toFixed(4))),
    unit: "hours",
    seconds,
  }
}

/** Whole seconds for what the operator typed, or null when it is not a valid window. */
function parseGrace(value: string, unit: Unit): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const seconds = Number(trimmed) * UNIT_SECONDS[unit]
  if (!Number.isSafeInteger(seconds) || seconds > MAX_GRACE_SECONDS) return null
  return seconds
}

export interface RotateKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The key as the page last read it. */
  summary: KeySummary
  /** Its policy, for the grace preset. */
  policy: PolicyRef | null
}

/**
 * The rotate-key dialog.
 *
 * It follows the create dialog: the form and the revealed key live in the
 * content, which Base UI mounts only while the dialog is open, so closing
 * forgets both. Two moments refuse a close for the same reasons as there:
 * while the command is out, and while the new key is up.
 */
export function RotateKeyDialog({
  open,
  onOpenChange,
  summary,
  policy,
}: RotateKeyDialogProps) {
  const [locked, setLocked] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && locked) {
          details.cancel()
          return
        }
        onOpenChange(next)
      }}
      disablePointerDismissal={locked}
    >
      <DialogContent
        showCloseButton={!locked}
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <RotateKeyForm
          summary={summary}
          policy={policy}
          onClose={() => onOpenChange(false)}
          onLockedChange={setLocked}
        />
      </DialogContent>
    </Dialog>
  )
}

function RotateKeyForm({
  summary,
  policy,
  onClose,
  onLockedChange,
}: {
  summary: KeySummary
  policy: PolicyRef | null
  onClose: () => void
  onLockedChange: (locked: boolean) => void
}) {
  const ids = {
    grace: useId(),
    graceNote: useId(),
    error: useId(),
  }
  const rotate = useCommand<KeyRotated>("keys.rotate")
  const preset = presetGrace(policy)

  const [reason, setReason] = useState<RotationReason>("manual")
  // Where the grace field's content comes from. "preset" follows the policy,
  // "zero" is what Suspected compromise asks for, and "custom" is whatever
  // the operator typed, which nothing overwrites.
  const [mode, setMode] = useState<"preset" | "zero" | "custom">("preset")
  const [custom, setCustom] = useState<Grace>({ value: "", unit: "hours" })
  const [problem, setProblem] = useState<string | null>(null)
  // The one copy of the raw key outside OneTimeKey's props. It is cleared by
  // Done, and by the whole form unmounting.
  const [revealed, setRevealed] = useState<KeyRotated | null>(null)
  const [windowsEnded, setWindowsEnded] = useState(false)
  const [ending, setEnding] = useState(false)
  // Set synchronously, so a second Enter in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  const locked = rotate.loading || revealed !== null
  useEffect(() => {
    onLockedChange(locked)
  }, [locked, onLockedChange])
  useEffect(() => () => onLockedChange(false), [onLockedChange])

  const shown: Grace =
    mode === "custom"
      ? custom
      : mode === "zero"
        ? { value: "0", unit: "hours" }
        : preset
  const graceSeconds =
    mode === "preset" ? preset.seconds : parseGrace(shown.value, shown.unit)
  const warnsImmediate = graceSeconds === 0

  const message = problem ?? rotate.error?.message
  const graceInvalid = problem === GRACE_INVALID

  function changeReason(next: RotationReason) {
    setReason(next)
    if (next === "compromise") {
      setMode("zero")
    } else if (mode === "zero") {
      // Leaving compromise puts back what was there, unless it was edited.
      setMode("preset")
    }
    setProblem(null)
  }

  function editGrace(next: Partial<Grace>) {
    setCustom({ ...shown, ...next })
    setMode("custom")
    setProblem(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || rotate.loading) return

    if (mode === "custom" && graceSeconds === null) {
      setProblem(GRACE_INVALID)
      return
    }
    setProblem(null)

    sending.current = true
    let result: KeyRotated | undefined
    try {
      result = await rotate.execute({
        id: summary.id,
        reason,
        // Omitted, not 24 hours, when the field is the untouched default:
        // the server then applies its own, whatever it is by then.
        ...(graceSeconds !== null && { graceSeconds }),
      })
    } finally {
      sending.current = false
    }
    if (!result) return
    // Copy first, then drop the hook's own copy of the answer.
    setRevealed(result)
    rotate.reset()
  }

  function done() {
    setRevealed(null)
    onClose()
  }

  if (revealed) {
    const windows = windowsEnded ? [] : revealed.previousKeys
    // The window this rotation opened carries the hint the key had until now.
    // Anything else is a window that was already open.
    const thisRotation = windows
      .filter((p) => p.hint === summary.hint)
      .reduce<PreviousKey | undefined>(
        (latest, p) =>
          latest === undefined || p.rotatedAt > latest.rotatedAt ? p : latest,
        undefined
      )
    const earlierOpen = windows.some((p) => p !== thisRotation)
    const maskedOf = (p: PreviousKey) =>
      maskedKey({
        prefix: revealed.key.prefix,
        environment: revealed.key.environment,
        hint: p.hint,
      })

    return (
      <>
        <DialogHeader>
          <DialogTitle>Save your new key</DialogTitle>
        </DialogHeader>
        <OneTimeKey
          rawKey={revealed.rawKey}
          summary={revealed.key}
          onDone={done}
          showHeading={false}
        >
          <div className="flex flex-col gap-2">
            {windows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {windowsEnded
                  ? "Every previous key has been stopped."
                  : "Your previous key stopped working when you rotated."}
              </p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {windows.map((p) => (
                    <li
                      key={p.rotationId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs">{maskedOf(p)}</span>
                      <span className="text-muted-foreground">
                        keeps working until
                      </span>
                      <Timestamp value={p.graceEnds} label="cutoff" />
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setEnding(true)}
                      >
                        End now
                      </Button>
                    </li>
                  ))}
                </ul>
                {earlierOpen && (
                  <p className="text-sm text-muted-foreground">
                    An earlier previous key is still accepted. End it now if it
                    may also be compromised.
                  </p>
                )}
              </>
            )}
          </div>
        </OneTimeKey>
        <EndGraceDialog
          open={ending}
          onOpenChange={setEnding}
          keyId={summary.id}
          masked={windows.map(maskedOf)}
          onEnded={() => setWindowsEnded(true)}
        />
      </>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>Rotate key</DialogTitle>
        <DialogDescription>
          {`A new key replaces ${maskedKey(summary)}. The new key is shown once, right after.`}
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Reason</FieldLegend>
          <RadioGroup
            aria-label="Reason"
            value={reason}
            onValueChange={(v) => changeReason(v as RotationReason)}
            className="flex flex-col gap-2"
          >
            {REASONS.map((r) => (
              <Label key={r.value} className="font-normal">
                <RadioGroupItem value={r.value} />
                {r.label}
              </Label>
            ))}
          </RadioGroup>
        </FieldSet>

        <Field>
          <Label htmlFor={ids.grace}>Grace period</Label>
          <div className="flex items-center gap-2">
            <Input
              id={ids.grace}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={shown.value}
              aria-invalid={graceInvalid ? true : undefined}
              aria-describedby={graceInvalid ? ids.error : ids.graceNote}
              className="w-24"
              onChange={(e) => editGrace({ value: e.target.value })}
            />
            <NativeSelect
              aria-label="Unit"
              value={shown.unit}
              onChange={(e) => editGrace({ unit: e.target.value as Unit })}
            >
              <NativeSelectOption value="hours">hours</NativeSelectOption>
              <NativeSelectOption value="days">days</NativeSelectOption>
            </NativeSelect>
            {mode === "preset" && preset.seconds === null && (
              <span className="text-sm text-muted-foreground">(default)</span>
            )}
          </div>
          <FieldDescription id={ids.graceNote}>
            The current key keeps working for this long after the new one is
            made. Up to 90 days.
          </FieldDescription>
          {warnsImmediate && (
            <p className="text-sm text-destructive">{COMPROMISE_WARNING}</p>
          )}
        </Field>
      </FieldGroup>

      {message && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" />}
          disabled={rotate.loading}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={rotate.loading}>
          Rotate key
        </Button>
      </DialogFooter>
    </form>
  )
}
