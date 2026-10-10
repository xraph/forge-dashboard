import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent, ReactNode } from "react"
import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { CommandState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@forge-go/dashboard-kit/components/field"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import {
  ApplicationGroupLine,
  GROUP_HEADING,
  KEYSMITH_GROUP_LINE,
  rateLimiterLine,
} from "../enforcement"
import { policyPath, splitDuration, toSeconds } from "../format"
import type { DurationUnit } from "../format"
import type { PolicyDetail, PolicyFields } from "../types"
import { AllowedScopesField } from "./allowed-scopes-field"

const NAME_REQUIRED = "name is required"
const NAME_TOO_LONG = "name is too long"
const NEEDS_WINDOW = "A rate limit needs a window."

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]

const UNIT_SIZE: Record<DurationUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
}

/*
 * The units each duration offers. splitDuration reads an unset value as blank
 * in the LAST unit listed, so the order here picks that default: a lifetime is
 * typed in days, a grace in hours, a window in minutes. The select always
 * shows them smallest first.
 */
const LIFETIME_UNITS: DurationUnit[] = ["hours", "days"]
const GRACE_UNITS: DurationUnit[] = ["days", "hours"]
const WINDOW_UNITS: DurationUnit[] = ["seconds", "hours", "minutes"]
const ROTATION_UNITS: DurationUnit[] = ["days"]

type DurationKey =
  "maxKeyLifetime" | "grace" | "rateLimitWindow" | "rotationPeriod"
type CountKey = "rateLimit" | "burstLimit" | "dailyQuota" | "monthlyQuota"
type ListKey = "ips" | "origins" | "paths"
type GroupKey = "scopes" | "methods"
type ProblemField = "name" | DurationKey | CountKey | ListKey | GroupKey

/** A message the form shows, and the field it is about, if any. */
interface Problem {
  field?: ProblemField
  message: string
}

/*
 * The server names a field by its wire name at the start of a refusal, such
 * as "graceSeconds is at most 90 days" or "allowedIps: ...". The form shows
 * its own label there instead, and marks that field.
 */
const SERVER_FIELDS: [wire: string, label: string, field: ProblemField][] = [
  ["maxKeyLifetimeSeconds", "Max key lifetime", "maxKeyLifetime"],
  ["graceSeconds", "Grace on rotation", "grace"],
  ["rateLimit", "Rate limit", "rateLimit"],
  ["rateLimitWindowSeconds", "Window", "rateLimitWindow"],
  ["burstLimit", "Burst limit", "burstLimit"],
  ["rotationPeriodSeconds", "Rotation period", "rotationPeriod"],
  ["dailyQuota", "Daily quota", "dailyQuota"],
  ["monthlyQuota", "Monthly quota", "monthlyQuota"],
  ["allowedScopes", "Allowed scopes", "scopes"],
  ["allowedIps", "Allowed IPs", "ips"],
  ["allowedOrigins", "Allowed origins", "origins"],
  ["allowedMethods", "Allowed methods", "methods"],
  ["allowedPaths", "Allowed paths", "paths"],
]

// The allowed scopes check names the scope, not the field.
const MISSING_SCOPE = /^scope ".*" does not exist in this tenant$/

/**
 * The server's refusal as the form shows it. A message that starts with a
 * wire name, then a space or a colon, gets the label in its place. Anything
 * else is shown as it came.
 */
function readRefusal(message: string | undefined): Problem | undefined {
  if (message === undefined) return undefined
  if (message === NAME_REQUIRED || message === NAME_TOO_LONG) {
    return { field: "name", message }
  }
  if (MISSING_SCOPE.test(message)) return { field: "scopes", message }
  for (const [wire, label, field] of SERVER_FIELDS) {
    const next = message.charAt(wire.length)
    if (message.startsWith(wire) && (next === " " || next === ":")) {
      return { field, message: label + message.slice(wire.length) }
    }
  }
  return { message }
}

interface Duration {
  value: string
  unit: DurationUnit
  /** What the select offers, fixed when the form opens. */
  units: DurationUnit[]
}

/**
 * A duration as the form starts it. A stored value no offered unit divides
 * comes back in seconds, and seconds is then offered too, so an edit never
 * rounds it away.
 */
function initialDuration(
  seconds: number | null | undefined,
  units: DurationUnit[]
): Duration {
  const split = splitDuration(seconds ?? null, units)
  const offered = units.includes(split.unit) ? units : [...units, split.unit]
  return {
    ...split,
    units: [...offered].sort((a, b) => UNIT_SIZE[a] - UNIT_SIZE[b]),
  }
}

/** A count as the form holds it: blank when unset. */
function initialCount(n: number | null | undefined): string {
  return n == null ? "" : String(n)
}

/** Blank is null; anything but a whole non-negative number is NaN. */
function toCount(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (!/^\d+$/.test(trimmed)) return NaN
  const n = Number(trimmed)
  return Number.isSafeInteger(n) ? n : NaN
}

/** A textarea's entries: one per line, trimmed, blanks dropped. */
function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
}

export interface PolicyEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The policy to edit. Without one the dialog creates a policy. */
  policy?: PolicyDetail
  /**
   * Whether this deployment enforces a policy's rate limit. Undefined when
   * the page has not been told, and the form then says it does not know.
   */
  rateLimiterConfigured: boolean | undefined
}

/**
 * Creates or edits a policy, with the fields grouped by what enforces them.
 *
 * The form lives in the content, which Base UI mounts only while the dialog
 * is open, so every open starts from the policy as it was passed in. The two
 * commands live here, above it, and are reset on open so a failure from the
 * last attempt is not shown against this one. While either is in flight the
 * dialog refuses to close: the answer would have nowhere to land.
 */
export function PolicyEditorDialog({
  open,
  onOpenChange,
  policy,
  rateLimiterConfigured,
}: PolicyEditorDialogProps) {
  const create = useCommand<{ policy: PolicyDetail }>("policies.create")
  const update = useCommand<{ policy: PolicyDetail }>("policies.update")
  const { reset: resetCreate } = create
  const { reset: resetUpdate } = update

  useEffect(() => {
    if (open) {
      resetCreate()
      resetUpdate()
    }
  }, [open, resetCreate, resetUpdate])

  const locked = create.loading || update.loading

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
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl"
      >
        <PolicyForm
          policy={policy}
          rateLimiterConfigured={rateLimiterConfigured}
          command={policy ? update : create}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function PolicyForm({
  policy,
  rateLimiterConfigured,
  command,
  onClose,
}: {
  policy?: PolicyDetail
  rateLimiterConfigured: boolean | undefined
  command: CommandState<{ policy: PolicyDetail }>
  onClose: () => void
}) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`
  const navigate = useNavigateTo()

  const [name, setName] = useState(policy?.name ?? "")
  const [description, setDescription] = useState(policy?.description ?? "")
  const [durations, setDurations] = useState<Record<DurationKey, Duration>>(
    () => ({
      maxKeyLifetime: initialDuration(
        policy?.maxKeyLifetimeSeconds,
        LIFETIME_UNITS
      ),
      grace: initialDuration(policy?.graceSeconds, GRACE_UNITS),
      rateLimitWindow: initialDuration(
        policy?.rateLimitWindowSeconds,
        WINDOW_UNITS
      ),
      rotationPeriod: initialDuration(
        policy?.rotationPeriodSeconds,
        ROTATION_UNITS
      ),
    })
  )
  const [counts, setCounts] = useState<Record<CountKey, string>>(() => ({
    rateLimit: initialCount(policy?.rateLimit),
    burstLimit: initialCount(policy?.burstLimit),
    dailyQuota: initialCount(policy?.dailyQuota),
    monthlyQuota: initialCount(policy?.monthlyQuota),
  }))
  const [pickedScopes, setPickedScopes] = useState<string[]>(
    () => policy?.allowedScopes ?? []
  )
  const [ips, setIps] = useState(() => (policy?.allowedIps ?? []).join("\n"))
  const [origins, setOrigins] = useState(() =>
    (policy?.allowedOrigins ?? []).join("\n")
  )
  const [paths, setPaths] = useState(() =>
    (policy?.allowedPaths ?? []).join("\n")
  )
  const [pickedMethods, setPickedMethods] = useState<string[]>(
    () => policy?.allowedMethods ?? []
  )
  // The allow lists as they were when the form opened. A name on them that
  // the pickers do not list stays on screen, so unticking it is a choice and
  // never an accident.
  const [storedScopes] = useState(() => policy?.allowedScopes ?? [])
  const [methods] = useState(() => [
    ...METHODS,
    ...(policy?.allowedMethods ?? []).filter((m) => !METHODS.includes(m)),
  ])
  const [problem, setProblem] = useState<Problem | null>(null)
  // Set synchronously, so a second submit in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  // The form's own check goes first; a server refusal shows until the next
  // submit.
  const shown = problem ?? readRefusal(command.error?.message)
  const message = shown?.message
  const refusedField = shown?.field

  // The message sits at the foot of a long form, so a refused input or
  // textarea takes the focus: it scrolls into view and is read out with the
  // message. Each new refusal focuses it again.
  useEffect(() => {
    if (!refusedField) return
    const el = document.getElementById(`${base}-${refusedField}`)
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus()
    }
  }, [problem, command.error, refusedField, base])

  const invalidProps = (field: ProblemField) =>
    refusedField === field
      ? { "aria-invalid": true as const, "aria-describedby": id("error") }
      : {}

  function setDuration(key: DurationKey, change: Partial<Duration>) {
    setDurations((cur) => ({ ...cur, [key]: { ...cur[key], ...change } }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || command.loading) return

    const fail = (field: ProblemField, msg: string) => {
      setProblem({ field, message: msg })
    }
    const trimmed = name.trim()
    if (trimmed === "") return fail("name", NAME_REQUIRED)

    const seconds = (key: DurationKey) =>
      toSeconds(durations[key].value, durations[key].unit)
    // The server's field order, so the first problem named is the one it
    // would name.
    const numbers: [ProblemField, string, number | null][] = [
      ["maxKeyLifetime", "Max key lifetime", seconds("maxKeyLifetime")],
      ["grace", "Grace on rotation", seconds("grace")],
      ["rateLimit", "Rate limit", toCount(counts.rateLimit)],
      ["rateLimitWindow", "Window", seconds("rateLimitWindow")],
      ["burstLimit", "Burst limit", toCount(counts.burstLimit)],
      ["rotationPeriod", "Rotation period", seconds("rotationPeriod")],
      ["dailyQuota", "Daily quota", toCount(counts.dailyQuota)],
      ["monthlyQuota", "Monthly quota", toCount(counts.monthlyQuota)],
    ]
    for (const [field, label, n] of numbers) {
      if (Number.isNaN(n))
        return fail(field, `${label} must be a whole number.`)
    }
    const [
      lifetime,
      grace,
      rateLimit,
      window,
      burst,
      rotation,
      daily,
      monthly,
    ] = numbers.map(([, , n]) => n ?? 0)
    if (rateLimit > 0 && window === 0)
      return fail("rateLimitWindow", NEEDS_WINDOW)
    setProblem(null)

    // Every field goes out. On update a blank one clears with 0 or [], which
    // is what the form shows; null would leave the stored value alone.
    const fields: Required<PolicyFields> = {
      name: trimmed,
      description: description.trim(),
      maxKeyLifetimeSeconds: lifetime,
      graceSeconds: grace,
      // Exactly what is ticked. Never filtered through scopes.list, which can
      // fail or change under the open form.
      allowedScopes: pickedScopes,
      rateLimit,
      rateLimitWindowSeconds: window,
      burstLimit: burst,
      allowedIps: lines(ips),
      allowedOrigins: lines(origins),
      allowedMethods: methods.filter((m) => pickedMethods.includes(m)),
      allowedPaths: lines(paths),
      rotationPeriodSeconds: rotation,
      dailyQuota: daily,
      monthlyQuota: monthly,
    }

    sending.current = true
    let result: { policy: PolicyDetail } | undefined
    try {
      result = await command.execute(
        policy ? { id: policy.id, ...fields } : fields
      )
    } finally {
      sending.current = false
    }
    if (!result) return
    onClose()
    if (!policy) navigate(policyPath(result.policy.id))
  }

  const durationField = (
    key: DurationKey,
    label: string,
    placeholder?: string
  ) => (
    <Field>
      <Label htmlFor={id(key)}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id(key)}
          inputMode="numeric"
          autoComplete="off"
          className="min-w-0 flex-1 tabular-nums"
          placeholder={placeholder}
          value={durations[key].value}
          {...invalidProps(key)}
          onChange={(e) => setDuration(key, { value: e.target.value })}
        />
        <NativeSelect
          aria-label={`${label} unit`}
          value={durations[key].unit}
          onChange={(e) =>
            setDuration(key, { unit: e.target.value as DurationUnit })
          }
        >
          {durations[key].units.map((u) => (
            <NativeSelectOption key={u} value={u}>
              {u}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </Field>
  )

  const countField = (key: CountKey, label: string, placeholder: string) => (
    <Field>
      <Label htmlFor={id(key)}>{label}</Label>
      <Input
        id={id(key)}
        inputMode="numeric"
        autoComplete="off"
        className="tabular-nums"
        placeholder={placeholder}
        value={counts[key]}
        {...invalidProps(key)}
        onChange={(e) =>
          setCounts((cur) => ({ ...cur, [key]: e.target.value }))
        }
      />
    </Field>
  )

  const listField = (
    key: ListKey,
    label: string,
    text: string,
    set: (v: string) => void,
    example: ReactNode
  ) => (
    <Field>
      <Label htmlFor={id(key)}>{label}</Label>
      <Textarea
        id={id(key)}
        rows={2}
        spellCheck={false}
        className="font-mono text-xs"
        value={text}
        {...invalidProps(key)}
        onChange={(e) => set(e.target.value)}
      />
      <FieldDescription>One per line, such as {example}.</FieldDescription>
    </Field>
  )

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>
          {policy ? `Edit ${policy.name}` : "Create policy"}
        </DialogTitle>
      </DialogHeader>

      <FieldGroup>
        <Field>
          <Label htmlFor={id("name")}>Name</Label>
          <Input
            id={id("name")}
            value={name}
            autoComplete="off"
            {...invalidProps("name")}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={id("description")}>Description</Label>
          <Textarea
            id={id("description")}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>{GROUP_HEADING.keysmith}</FieldLegend>
          <FieldDescription>{KEYSMITH_GROUP_LINE}</FieldDescription>
          {policy && (
            <FieldDescription>
              Changes apply from now on. Existing keys keep their expiry and
              scopes.
            </FieldDescription>
          )}
          <FieldGroup>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              {durationField(
                "maxKeyLifetime",
                "Max key lifetime",
                "No maximum"
              )}
              {durationField(
                "grace",
                "Grace on rotation",
                "24 hours (default)"
              )}
            </div>
            <AllowedScopesField
              stored={storedScopes}
              picked={pickedScopes}
              onChange={setPickedScopes}
              {...invalidProps("scopes")}
            />
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>{GROUP_HEADING.rateLimiter}</FieldLegend>
          <FieldDescription>
            {rateLimiterLine(rateLimiterConfigured)}
          </FieldDescription>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {countField("rateLimit", "Rate limit", "No limit")}
            {durationField("rateLimitWindow", "Window")}
          </div>
          <FieldDescription>
            How many requests a key may make in each window.
          </FieldDescription>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>{GROUP_HEADING.application}</FieldLegend>
          <FieldDescription>
            <ApplicationGroupLine />
          </FieldDescription>
          <FieldGroup>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              {countField("burstLimit", "Burst limit", "No limit")}
              {durationField("rotationPeriod", "Rotation period", "None")}
              {countField("dailyQuota", "Daily quota", "No quota")}
              {countField("monthlyQuota", "Monthly quota", "No quota")}
            </div>
            {listField(
              "ips",
              "Allowed IPs",
              ips,
              setIps,
              <span className="font-mono">10.0.0.0/8</span>
            )}
            {listField(
              "origins",
              "Allowed origins",
              origins,
              setOrigins,
              <span className="font-mono">https://example.com</span>
            )}
            {listField(
              "paths",
              "Allowed paths",
              paths,
              setPaths,
              <span className="font-mono">/v1/billing</span>
            )}
            <FieldSet {...invalidProps("methods")}>
              <FieldLegend variant="label">Allowed methods</FieldLegend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {methods.map((m) => (
                  <Label key={m} className="font-normal">
                    <Checkbox
                      checked={pickedMethods.includes(m)}
                      onCheckedChange={(on) =>
                        setPickedMethods((cur) =>
                          on === true
                            ? [...cur.filter((x) => x !== m), m]
                            : cur.filter((x) => x !== m)
                        )
                      }
                    />
                    <span className="font-mono text-xs">{m}</span>
                  </Label>
                ))}
              </div>
            </FieldSet>
          </FieldGroup>
        </FieldSet>
      </FieldGroup>

      {message && (
        <p id={id("error")} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" />}
          disabled={command.loading}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={command.loading}>
          {policy ? "Save changes" : "Create policy"}
        </Button>
      </DialogFooter>
    </form>
  )
}
