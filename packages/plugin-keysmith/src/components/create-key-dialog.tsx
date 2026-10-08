import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import {
  queryStore,
  useCommand,
  useNavigateTo,
  usePluginClient,
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
import {
  alreadyRan,
  claimFailed,
  lostAnswer,
  stillRunning,
  useAttemptKey,
} from "../attempt"
import { ENVIRONMENTS, formatDuration, keyPath } from "../format"
import type {
  Environment,
  KeyWithSecret,
  PoliciesList,
  ScopesList,
} from "../types"
import { KeyListLink } from "./key-list-link"
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
// What keys.create invalidates when it succeeds. A lost or unrepeatable
// answer carried no invalidation, yet a key may exist, so the form asks for
// the same reloads itself.
const CREATE_INVALIDATES = [
  "keys.list",
  "keys.detail",
  "overview",
  "policies.detail",
]

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

/** "a", "a and b", "a, b and c". */
function joinNames(names: string[]): string {
  if (names.length < 2) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
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
  const client = usePluginClient()
  const create = useCommand<KeyWithSecret>("keys.create")
  const attemptKey = useAttemptKey()
  const policies = useQuery<PoliciesList>("policies.list", PICKER_PARAMS)
  const scopes = useQuery<ScopesList>("scopes.list", PICKER_PARAMS)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [environment, setEnvironment] = useState<Environment>("test")
  const [prefix, setPrefix] = useState("sk")
  const [policyId, setPolicyId] = useState("")
  // The chosen policy's name, kept so the form can still name it once a
  // reload of the list no longer has it.
  const [policyName, setPolicyName] = useState("")
  const [expiry, setExpiry] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  // What a reload of the lists took off the form, said in one sentence.
  const [dropped, setDropped] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [expiryProblem, setExpiryProblem] = useState<string | null>(null)
  // The date a policy change just took away, so the form can say so.
  const [clearedExpiry, setClearedExpiry] = useState<string | null>(null)
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
  // A layout effect, not a passive one. React runs it inside the commit that
  // changed `locked` and renders the root again before the browser paints or
  // handles the next event, so the root never acts on an old value. A passive
  // effect runs after the paint. An answer arriving from the network left a
  // gap there: the error was on screen while the root still hid the Close
  // button and refused Cancel and Escape.
  useLayoutEffect(() => {
    onLockedChange(locked)
  }, [locked, onLockedChange])
  useLayoutEffect(() => () => onLockedChange(false), [onLockedChange])

  // An answer the server will not repeat ends the key: pressing Create again
  // after reading why is a new command. Either way the list may have a key it
  // does not show yet.
  const spent = alreadyRan(create.error)
  const lost = lostAnswer(create.error)
  // Neither is an answer about the command itself, so the key stays.
  const running = stillRunning(create.error)
  const unclaimed = claimFailed(create.error)
  useEffect(() => {
    if (spent) attemptKey.end()
    if (spent || lost)
      queryStore.invalidate(client.extension, CREATE_INVALIDATES)
  }, [spent, lost, attemptKey, client.extension])

  const message = problem ?? create.error?.message
  const nameInvalid = message === NAME_REQUIRED || message === NAME_TOO_LONG
  const prefixInvalid = message === PREFIX_INVALID

  // What each list last answered, shown while a later read of it fails. The
  // store drops a list's rows when a read fails, and a form that lost them
  // would lose its picks with them. A context switch forgets these (below).
  const [heldPolicies, setHeldPolicies] = useState<PoliciesList>()
  const [heldScopes, setHeldScopes] = useState<ScopesList>()
  if (policies.data !== undefined && policies.data !== heldPolicies) {
    setHeldPolicies(policies.data)
  }
  if (scopes.data !== undefined && scopes.data !== heldScopes) {
    setHeldScopes(scopes.data)
  }
  const policyList =
    policies.data ?? (policies.error ? heldPolicies : undefined)
  const scopeList = scopes.data ?? (scopes.error ? heldScopes : undefined)

  const policy = policyList?.policies?.find((p) => p.id === policyId)
  const allowed = policy?.allowedScopes ?? []
  const narrowed = allowed.length > 0
  const minDate = dateValue(new Date(openedAt))
  const maxDate =
    policy?.maxKeyLifetimeSeconds != null
      ? lastDateWithin(openedAt, policy.maxKeyLifetimeSeconds)
      : undefined
  const visibleScopes = (scopeList?.scopes ?? []).filter(
    (s) => !narrowed || allowed.includes(s.name)
  )

  // A context switch (this tab's, or another tab's applied when this window
  // comes to the front) blanks both lists while they reload for the new
  // context. Until they answer, the form cannot tell which picks still exist,
  // and submitting would mint the key with none of them.
  const scopesWaiting = scopes.loading && !scopes.data
  const policiesWaiting = policies.loading && !policies.data
  const listsWaiting = scopesWaiting || policiesWaiting

  // A context switch blanks a list to loading with neither data nor an error.
  // The same form in another tenant is another command, so it gets a new key.
  // A re-read after a failed read is loading with no data as well, but keeps
  // the error: that is the same tenant, and the key stays.
  const listsBlanked =
    (scopesWaiting && !scopes.error) || (policiesWaiting && !policies.error)
  useEffect(() => {
    if (listsBlanked) attemptKey.end()
  }, [listsBlanked, attemptKey])
  // A blank list also means the picks were made in another context, so they
  // are unchecked here until the list answers. The blank forgets the held list
  // with it.
  const [scopesUnchecked, setScopesUnchecked] = useState(false)
  const [policiesUnchecked, setPoliciesUnchecked] = useState(false)
  if (scopesWaiting && !scopes.error) {
    if (heldScopes !== undefined) setHeldScopes(undefined)
    if (!scopesUnchecked) setScopesUnchecked(true)
  }
  if (policiesWaiting && !policies.error) {
    if (heldPolicies !== undefined) setHeldPolicies(undefined)
    if (!policiesUnchecked) setPoliciesUnchecked(true)
  }

  // Once they answer, a pick the new lists do not hold comes off the form,
  // and the form says which. Adjusted during render, so no commit ever
  // offers Create with a pick that would be dropped without a word.
  //
  // A failed read says nothing about the picks. Ones made or confirmed in
  // this context stay, and so does the idempotency key that goes with them.
  // Ones carried over a context switch were never checked here, so they come
  // off rather than go to the new tenant unseen. The key ended at the switch,
  // so no retry depends on them.
  const unlistedScopes =
    scopes.data === undefined
      ? []
      : picked.filter((n) => !scopes.data?.scopes?.some((s) => s.name === n))
  const uncheckedScopes =
    scopes.data === undefined && scopes.error && scopesUnchecked ? picked : []
  const policyUnlisted =
    policies.data !== undefined &&
    policyId !== "" &&
    !policies.data.policies?.some((p) => p.id === policyId)
  const policyUnchecked =
    policies.data === undefined &&
    policies.error !== undefined &&
    policiesUnchecked &&
    policyId !== ""
  const goneScopes = [...unlistedScopes, ...uncheckedScopes]
  const policyGone = policyUnlisted || policyUnchecked
  if (scopes.data !== undefined && scopesUnchecked) setScopesUnchecked(false)
  if (policies.data !== undefined && policiesUnchecked) {
    setPoliciesUnchecked(false)
  }
  if (!revealed && !finished && (goneScopes.length > 0 || policyGone)) {
    const policyLabel = `the ${policyName} policy`
    const unlisted = [
      ...unlistedScopes,
      ...(policyUnlisted ? [policyLabel] : []),
    ]
    const unchecked = [
      ...uncheckedScopes,
      ...(policyUnchecked ? [policyLabel] : []),
    ]
    setDropped(
      [
        unlisted.length > 0 &&
          `Some of your picks are no longer listed and came off the form: ${joinNames(unlisted)}.`,
        unchecked.length > 0 &&
          `Some of your picks couldn't be checked after the switch and came off the form: ${joinNames(unchecked)}.`,
      ]
        .filter(Boolean)
        .join(" ")
    )
    if (goneScopes.length > 0) {
      setPicked(picked.filter((n) => !goneScopes.includes(n)))
    }
    if (policyGone) {
      setPolicyId("")
      setPolicyName("")
      setClearedExpiry(null)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    // The button is disabled while the lists reload, but a click can already
    // be on its way when they blank.
    if (sending.current || create.loading || listsWaiting) return

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

    const payload = {
      name: trimmed,
      ...(description.trim() !== "" && { description: description.trim() }),
      environment,
      prefix,
      ...(policyId !== "" && { policyId }),
      // A date input has no time: the end of that day where the operator is.
      ...(expiry !== "" && { expiresAt: endOfLocalDay(expiry).toISOString() }),
      scopes: chosen,
    }

    sending.current = true
    let result: KeyWithSecret | undefined
    try {
      result = await create.execute(payload, {
        // Keyed on the scopes sorted: they follow the list's order, and a
        // reload that only reorders the list is still the same form.
        idempotencyKey: attemptKey.keyFor({
          ...payload,
          scopes: [...chosen].sort(),
        }),
      })
    } finally {
      sending.current = false
    }
    if (!result) return
    // Copy first, then drop the hook's own copy of the answer.
    setRevealed(result)
    create.reset()
    attemptKey.end()
  }

  function changePolicy(id: string) {
    setPolicyId(id)
    const next = policyList?.policies?.find((p) => p.id === id)
    setPolicyName(next?.name ?? "")
    setDropped(null)
    const max =
      next?.maxKeyLifetimeSeconds != null
        ? lastDateWithin(openedAt, next.maxKeyLifetimeSeconds)
        : undefined
    // A date the new policy would refuse is not kept, and the form says so.
    if (max !== undefined && expiry > max) {
      setClearedExpiry(expiry)
      setExpiry("")
    } else {
      setClearedExpiry(null)
    }
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
            {(policyList?.policies ?? []).map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {policyList?.hasMore && (
            <FieldDescription>
              {`Only the first ${PICKER_LIMIT} policies are listed.`}
            </FieldDescription>
          )}
          {policies.error && (
            <FieldDescription>
              {policyList
                ? "Policies could not be reloaded, so these are the ones from the last time they loaded."
                : "Policies could not be loaded, so none can be chosen right now."}
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
              setClearedExpiry(null)
            }}
          />
          {clearedExpiry && (
            <FieldDescription>
              {`${longDate(clearedExpiry)} is later than this policy allows, so the date was cleared.`}
            </FieldDescription>
          )}
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
          {scopes.error && !scopeList ? (
            <FieldDescription>
              Scopes could not be loaded. You can still create the key and add
              scopes later.
            </FieldDescription>
          ) : scopes.loading && !scopeList ? (
            <FieldDescription>Loading scopes…</FieldDescription>
          ) : visibleScopes.length === 0 ? (
            <FieldDescription>
              {narrowed
                ? scopeList?.hasMore
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
                    onCheckedChange={(checked) => {
                      setDropped(null)
                      setPicked((cur) =>
                        checked === true
                          ? [...cur.filter((n) => n !== s.name), s.name]
                          : cur.filter((n) => n !== s.name)
                      )
                    }}
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
          {scopes.error && scopeList && (
            <FieldDescription>
              Scopes could not be reloaded, so these are the ones from the last
              time they loaded.
            </FieldDescription>
          )}
          {scopeList?.hasMore && (
            <FieldDescription>
              {`Only the first ${PICKER_LIMIT} scopes are listed. You can add others from the key's page after it is created.`}
            </FieldDescription>
          )}
        </FieldSet>
      </FieldGroup>

      {dropped && (
        <p role="status" className="text-sm">
          {dropped}
        </p>
      )}

      {message && (
        <p id={ids.error} role="alert" className="text-sm text-destructive">
          {problem === null && spent ? (
            <>
              Your key was created, but its secret can&apos;t be shown again.
              Revoke it from the <KeyListLink onFollow={onClose} />, then create
              it again.
            </>
          ) : problem === null && lost ? (
            <>
              The server&apos;s answer didn&apos;t arrive, so your key may have
              been created. Check the <KeyListLink onFollow={onClose} /> before
              you try again. If it isn&apos;t there, pressing Create key again
              from this form, with nothing changed, is the safest retry.
            </>
          ) : problem === null && running ? (
            "Your earlier attempt is still finishing, so try again in a moment."
          ) : problem === null && unclaimed ? (
            "The server couldn't take this just now. Try again in a moment."
          ) : (
            message
          )}
        </p>
      )}

      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="outline" />}
          disabled={create.loading}
        >
          Cancel
        </DialogClose>
        <Button type="submit" disabled={create.loading || listsWaiting}>
          Create key
        </Button>
      </DialogFooter>
    </form>
  )
}
