import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent } from "react"
import {
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
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
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { ENVIRONMENTS, formatDuration, keyPath } from "../format"
import type {
  Environment,
  KeyWithSecret,
  PoliciesList,
  ScopesList,
} from "../types"
import { OneTimeKey } from "./one-time-key"

const MAX_NAME_LENGTH = 200
// Mirrors the server's pattern. The server stays the authority: this only
// saves a round trip for the two mistakes people make most.
const PREFIX_PATTERN = /^[a-z][a-z0-9]{1,15}$/
const NAME_REQUIRED = "name is required"
const NAME_TOO_LONG = "name is too long"
const PREFIX_INVALID =
  "prefix must be 2 to 16 lowercase letters or digits, starting with a letter"
const EXPIRY_IN_PAST = "Choose today or a later date."
// The most each picker asks for, and what its "first N" lines say.
const PICKER_LIMIT = 200
const PICKER_PARAMS = { limit: PICKER_LIMIT }

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/** A date input's value for a Date, in the operator's own time zone. */
function dateValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The operator's local 23:59:59 on a date input's `YYYY-MM-DD` value. */
function endOfLocalDay(value: string): Date {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, m - 1, d, 23, 59, 59)
}

/**
 * The last date whose local end of day is at or before now + the lifetime, as
 * a date input's value. Later than that and the server refuses the key.
 */
function lastDateWithin(now: number, lifetimeSeconds: number): string {
  const limit = new Date(now + lifetimeSeconds * 1000)
  const sameDay = dateValue(limit)
  if (endOfLocalDay(sameDay).getTime() <= limit.getTime()) return sameDay
  // Step the calendar, not 24 hours: on a clock-change day a day is 23 or 25
  // hours, and day 0 normalises to the last day of the previous month.
  const [y, m, d] = sameDay.split("-").map(Number)
  return dateValue(new Date(y, m - 1, d - 1))
}

function longDate(value: string): string {
  return endOfLocalDay(value).toLocaleDateString(undefined, {
    dateStyle: "long",
  })
}

export interface CreateKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The create-key dialog.
 *
 * The form, its queries and the revealed key all live in the content, which
 * Base UI mounts only while the dialog is open. Closing therefore forgets the
 * form and the key, with nothing to remember to reset.
 *
 * Two moments must not close the dialog. While the command is in flight, the
 * answer would arrive with nowhere to show it, and the key would be lost. While
 * the key is up, closing before the person has stored it loses it just the
 * same. The form reports those as `locked`, and the root refuses the close:
 * `eventDetails.cancel()` keeps Base UI's own state from flipping, and the
 * controlled `open` would not change either way.
 */
export function CreateKeyDialog({ open, onOpenChange }: CreateKeyDialogProps) {
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
        <CreateKeyForm
          onClose={() => onOpenChange(false)}
          onLockedChange={setLocked}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateKeyForm({
  onClose,
  onLockedChange,
}: {
  onClose: () => void
  onLockedChange: (locked: boolean) => void
}) {
  const ids = {
    name: useId(),
    description: useId(),
    prefix: useId(),
    policy: useId(),
    expiry: useId(),
    expiryNote: useId(),
    error: useId(),
  }
  const navigate = useNavigateTo()
  const create = useCommand<KeyWithSecret>("keys.create")
  const policies = useQuery<PoliciesList>("policies.list", PICKER_PARAMS)
  const scopes = useQuery<ScopesList>("scopes.list", PICKER_PARAMS)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [environment, setEnvironment] = useState<Environment>("test")
  const [prefix, setPrefix] = useState("sk")
  const [policyId, setPolicyId] = useState("")
  const [expiry, setExpiry] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [expiryProblem, setExpiryProblem] = useState<string | null>(null)
  // When the form opened. Only the date input's bounds read it, so they do not
  // move under the operator mid-edit; the submit check reads the clock afresh.
  const [openedAt] = useState(() => Date.now())
  // The one copy of the raw key outside OneTimeKey's props. It is cleared by
  // Done, and by the whole form unmounting.
  const [revealed, setRevealed] = useState<KeyWithSecret | null>(null)
  // Done was pressed. The content stays mounted through the dialog's exit
  // animation, and without this it would show the filled form again for
  // those frames. From here on only the title renders.
  const [finished, setFinished] = useState(false)
  // Set synchronously, so a second Enter in the same tick cannot slip past a
  // button that has not re-rendered as disabled yet.
  const sending = useRef(false)

  const locked = create.loading || revealed !== null || finished
  useEffect(() => {
    onLockedChange(locked)
  }, [locked, onLockedChange])
  useEffect(() => () => onLockedChange(false), [onLockedChange])

  const message = problem ?? create.error?.message
  const nameInvalid = message === NAME_REQUIRED || message === NAME_TOO_LONG
  const prefixInvalid = message === PREFIX_INVALID

  const policy = policies.data?.policies?.find((p) => p.id === policyId)
  const allowed = policy?.allowedScopes ?? []
  const narrowed = allowed.length > 0
  const minDate = dateValue(new Date(openedAt))
  const maxDate =
    policy?.maxKeyLifetimeSeconds != null
      ? lastDateWithin(openedAt, policy.maxKeyLifetimeSeconds)
      : undefined
  const visibleScopes = (scopes.data?.scopes ?? []).filter(
    (s) => !narrowed || allowed.includes(s.name)
  )

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending.current || create.loading) return

    const trimmed = name.trim()
    const invalid =
      trimmed === ""
        ? NAME_REQUIRED
        : [...trimmed].length > MAX_NAME_LENGTH
          ? NAME_TOO_LONG
          : !PREFIX_PATTERN.test(prefix)
            ? PREFIX_INVALID
            : null
    const pastDate =
      expiry !== "" && expiry < dateValue(new Date()) ? EXPIRY_IN_PAST : null
    setProblem(invalid)
    setExpiryProblem(pastDate)
    if (invalid || pastDate) return

    // A scope ticked under one policy and not allowed by the next is left out.
    const chosen = visibleScopes
      .filter((s) => picked.includes(s.name))
      .map((s) => s.name)

    sending.current = true
    let result: KeyWithSecret | undefined
    try {
      result = await create.execute({
        name: trimmed,
        ...(description.trim() !== "" && { description: description.trim() }),
        environment,
        prefix,
        ...(policyId !== "" && { policyId }),
        // A date input has no time: the end of that day where the operator is.
        ...(expiry !== "" && { expiresAt: endOfLocalDay(expiry).toISOString() }),
        scopes: chosen,
      })
    } finally {
      sending.current = false
    }
    if (!result) return
    // Copy first, then drop the hook's own copy of the answer.
    setRevealed(result)
    create.reset()
  }

  function changePolicy(id: string) {
    setPolicyId(id)
    const next = policies.data?.policies?.find((p) => p.id === id)
    const max =
      next?.maxKeyLifetimeSeconds != null
        ? lastDateWithin(openedAt, next.maxKeyLifetimeSeconds)
        : undefined
    // A date the new policy would refuse is not kept.
    if (max !== undefined && expiry > max) setExpiry("")
    setExpiryProblem(null)
  }

  function done() {
    if (!revealed) return
    const id = revealed.key.id
    setFinished(true)
    setRevealed(null)
    onClose()
    navigate(keyPath(id))
  }

  if (finished) {
    return (
      <DialogHeader>
        <DialogTitle>Save your new key</DialogTitle>
      </DialogHeader>
    )
  }

  if (revealed) {
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
        />
      </>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="contents" noValidate>
      <DialogHeader>
        <DialogTitle>Create key</DialogTitle>
        <DialogDescription>
          The full key is shown once, right after it is created.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Field>
          <Label htmlFor={ids.name}>Name</Label>
          <Input
            id={ids.name}
            value={name}
            aria-invalid={nameInvalid ? true : undefined}
            aria-describedby={nameInvalid ? ids.error : undefined}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field>
          <Label htmlFor={ids.description}>Description</Label>
          <Textarea
            id={ids.description}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Environment</FieldLegend>
          <RadioGroup
            aria-label="Environment"
            value={environment}
            onValueChange={(v) => setEnvironment(v as Environment)}
            className="flex gap-4"
          >
            {ENVIRONMENTS.map((e) => (
              <Label key={e.value} className="font-normal">
                <RadioGroupItem value={e.value} />
                {e.label}
              </Label>
            ))}
          </RadioGroup>
        </FieldSet>

        <Field>
          <Label htmlFor={ids.prefix}>Prefix</Label>
          <Input
            id={ids.prefix}
            value={prefix}
            aria-invalid={prefixInvalid ? true : undefined}
            aria-describedby={prefixInvalid ? ids.error : undefined}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setPrefix(e.target.value)}
          />
          <FieldDescription>
            Keys will start{" "}
            <span className="font-mono text-foreground">
              {`${prefix}_${environment}_…`}
            </span>
          </FieldDescription>
        </Field>

        <Field>
          <Label htmlFor={ids.policy}>Policy</Label>
          <NativeSelect
            id={ids.policy}
            className="w-full"
            value={policyId}
            onChange={(e) => changePolicy(e.target.value)}
          >
            <NativeSelectOption value="">No policy</NativeSelectOption>
            {(policies.data?.policies ?? []).map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {policies.data?.hasMore && (
            <FieldDescription>
              {`Only the first ${PICKER_LIMIT} policies are listed.`}
            </FieldDescription>
          )}
          {policies.error && (
            <FieldDescription>
              Policies could not be loaded, so none can be chosen right now.
            </FieldDescription>
          )}
          {policy && (
            <FieldDescription>
              Maximum lifetime:{" "}
              {policy.maxKeyLifetimeSeconds === null
                ? "No maximum"
                : formatDuration(policy.maxKeyLifetimeSeconds)}
              . Grace period:{" "}
              {policy.graceSeconds === null
                ? "Not set"
                : formatDuration(policy.graceSeconds)}
              .
            </FieldDescription>
          )}
        </Field>

        <Field>
          <Label htmlFor={ids.expiry}>Expiry (optional)</Label>
          <Input
            id={ids.expiry}
            type="date"
            value={expiry}
            min={minDate}
            max={maxDate}
            aria-invalid={expiryProblem ? true : undefined}
            aria-describedby={expiryProblem ? ids.expiryNote : undefined}
            onChange={(e) => {
              setExpiry(e.target.value)
              setExpiryProblem(null)
            }}
          />
          {expiryProblem && (
            <p id={ids.expiryNote} className="text-xs text-destructive">
              {expiryProblem}
            </p>
          )}
          {expiry !== "" && !expiryProblem && (
            <FieldDescription>
              {`Expires at the end of ${longDate(expiry)}, your time.`}
            </FieldDescription>
          )}
          {policy?.maxKeyLifetimeSeconds != null && (
            <FieldDescription>
              {`Keys under this policy expire after ${formatDuration(policy.maxKeyLifetimeSeconds)} unless you choose an earlier date.`}
            </FieldDescription>
          )}
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Scopes</FieldLegend>
          {scopes.error ? (
            <FieldDescription>
              Scopes could not be loaded. You can still create the key and add
              scopes later.
            </FieldDescription>
          ) : scopes.loading && !scopes.data ? (
            <FieldDescription>Loading scopes…</FieldDescription>
          ) : visibleScopes.length === 0 ? (
            <FieldDescription>
              {narrowed
                ? scopes.data?.hasMore
                  ? `None of the first ${PICKER_LIMIT} scopes are allowed by this policy.`
                  : "This policy allows none of the scopes that exist."
                : "No scopes exist in this tenant yet."}
            </FieldDescription>
          ) : (
            <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
              {visibleScopes.map((s) => (
                <Label key={s.id} className="font-normal">
                  <Checkbox
                    checked={picked.includes(s.name)}
                    onCheckedChange={(checked) =>
                      setPicked((cur) =>
                        checked === true
                          ? [...cur.filter((n) => n !== s.name), s.name]
                          : cur.filter((n) => n !== s.name)
                      )
                    }
                  />
                  {s.name}
                </Label>
              ))}
            </div>
          )}
          {narrowed && (
            <FieldDescription>
              Only the scopes this policy allows are listed.
            </FieldDescription>
          )}
          {scopes.data?.hasMore && (
            <FieldDescription>
              {`Only the first ${PICKER_LIMIT} scopes are listed. You can add others from the key's page after it is created.`}
            </FieldDescription>
          )}
        </FieldSet>
      </FieldGroup>

      {message && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" />}
          disabled={create.loading}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={create.loading}>
          Create key
        </Button>
      </DialogFooter>
    </form>
  )
}
