import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import {
  usePluginClient,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { ContractError } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { XIcon } from "@forge-go/dashboard-kit/icons"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  OPERATOR_WORDS,
  PRIORITY_HELP,
  subjectText,
  windowTime,
  type PolicyCondition,
  type PolicyDetail,
  type PolicySubject,
} from "./policy-rule"
import type { AckResponse } from "../pages/roles"

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/** Mirrors the Go `PolicyDraft`, the body `policies.validate` reads. */
export interface PolicyDraft {
  name: string
  description?: string
  effect: string
  priority: number
  notBefore?: string
  notAfter?: string
  subjects: PolicySubject[]
  actions: string[]
  resources: string[]
  conditions: PolicyCondition[]
  obligations: string[]
}

/** Mirrors the Go `ConditionIssue`: one bad condition row, by index. */
export interface ConditionIssue {
  index: number
  message: string
}

/**
 * Mirrors the Go `PolicyValidateResponse`: `PolicyIssues` embedded, so the
 * JSON is flat. `matchesEverything` is the server's own analysis of the
 * draft, and the only thing the save confirmation reads it from.
 */
export interface PolicyValidateResponse {
  valid: boolean
  matchesEverything: boolean
  fields: Record<string, string>
  conditions: ConditionIssue[]
}

/**
 * Mirrors the Go `PolicyUpdateInput`. Every part is a pointer there: absent
 * leaves it alone, an empty list clears the list, and `""` on a bound clears
 * that bound. Namespace is not patchable.
 *
 * `expectedVersion` is the version the editor loaded. When the stored policy
 * is at a newer version the server refuses the update as stale and writes
 * nothing. A version above the stored one, or a negative one, was never
 * stored, so the server refuses it as bad input. Absent, the server skips that check.
 */
export interface PolicyUpdatePayload {
  id: string
  expectedVersion?: number
  name?: string
  description?: string
  effect?: string
  priority?: number
  notBefore?: string
  notAfter?: string
  subjects?: PolicySubject[]
  actions?: string[]
  resources?: string[]
  conditions?: PolicyCondition[]
  obligations?: string[]
}

/** Warden's closed set of subject kinds (`validSubjectKinds` in the Go). */
export const SUBJECT_KINDS = ["user", "api_key", "service", "service_acct"] as const

/** The server's own sentence for an empty subject matcher, in `collectPolicyIssues`. */
export const EMPTY_SUBJECT =
  "An empty subject matcher matches everyone. To mean everyone, remove every subject instead."

export const PRIORITY_NOT_WHOLE = "Priority must be a whole number."

export const CHANGED_MID_CHECK =
  "The draft changed while it was being checked, so nothing was saved. Save again to save it."

/**
 * Said in place of the server's message when an update is refused as stale:
 * the stored policy is no longer at the version the editor loaded, so
 * nothing was written. The draft stays on screen whatever the refusal.
 */
export const STALE_EDIT =
  "This policy was saved again after the copy you are editing was loaded, so your changes were not saved. Your edits are still on screen. Reload the page to get the current version, then make your edits there."

/**
 * Whether a refused update was refused because the policy moved on since it
 * was loaded. A taken name is CONFLICT too, without this reason, and keeps
 * the server's own message.
 */
export function isStale(error: ContractError | undefined): boolean {
  return error?.code === "CONFLICT" && error.details?.reason === "stale"
}

// ---------------------------------------------------------------------------
// Condition values
// ---------------------------------------------------------------------------

/** What kind of value an operator reads, which decides the input it gets. */
export type ValueKind = "list" | "cidr" | "time" | "number" | "pattern" | "none" | "text"

export function valueKind(operator: string): ValueKind {
  switch (operator) {
    case "in":
    case "not_in":
      return "list"
    case "ip_in_cidr":
      return "cidr"
    case "time_after":
    case "time_before":
      return "time"
    case "gt":
    case "lt":
    case "gte":
    case "lte":
      return "number"
    case "regex":
      return "pattern"
    case "exists":
    case "not_exists":
      return "none"
  }
  return "text"
}

/** The JSON type each kind sends. A change of operator keeps a value only when this stays the same. */
function wireType(kind: ValueKind): "array" | "number" | "string" | "none" {
  switch (kind) {
    case "list":
    case "cidr":
      return "array"
    case "number":
      return "number"
    case "none":
      return "none"
  }
  return "string"
}

/** One stored value as the text an input shows. */
function itemText(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return JSON.stringify(v)
}

/**
 * One condition row as it is edited. `items` holds a list value and `text`
 * every other kind; the operator decides which one is sent.
 *
 * `stored` is the condition the row was loaded from. While the operator and
 * the value are still what was loaded, the row sends the stored value itself,
 * so a row nobody touched sends exactly what is stored, whatever JSON type it
 * was stored with, and the condition list reads as unchanged.
 */
interface ConditionRow {
  key: number
  id?: string
  field: string
  operator: string
  items: string[]
  text: string
  stored?: { operator: string; items: string[]; text: string; value: unknown }
}

let nextRowKey = 0

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null
}

function rowFrom(c: PolicyCondition): ConditionRow {
  const v = c.value
  const items = Array.isArray(v) ? v.map(itemText) : hasValue(v) ? [itemText(v)] : []
  const text = Array.isArray(v) || !hasValue(v) ? "" : itemText(v)
  return {
    key: nextRowKey++,
    ...(c.id && { id: c.id }),
    field: c.field,
    operator: c.operator,
    items,
    text,
    stored: { operator: c.operator, items, text, value: v },
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * A row's value on the wire, or `undefined` for no `value` key. Numbers go as
 * JSON numbers, lists as JSON arrays. A number that does not parse goes as
 * the text typed, so the server says what is wrong with it rather than the
 * page quietly sending something else.
 */
function rowValue(r: ConditionRow): unknown {
  const s = r.stored
  if (s && r.operator === s.operator && r.text === s.text && sameList(r.items, s.items)) {
    return hasValue(s.value) ? s.value : undefined
  }
  switch (valueKind(r.operator)) {
    case "none":
      return undefined
    case "list":
    case "cidr":
      return [...r.items]
    case "number": {
      const t = r.text.trim()
      const n = Number(t)
      return t !== "" && Number.isFinite(n) ? n : r.text
    }
  }
  return r.text
}

/**
 * A row as the wire condition. The stored id rides along for a row that came
 * from a stored condition, so update keeps that condition's id; a new row
 * sends none and gets a fresh one.
 */
function wireCondition(r: ConditionRow): PolicyCondition {
  const value = rowValue(r)
  return {
    ...(r.id && { id: r.id }),
    field: r.field,
    operator: r.operator,
    ...(value !== undefined && { value }),
  }
}

function storedCondition(c: PolicyCondition): PolicyCondition {
  return {
    ...(c.id && { id: c.id }),
    field: c.field,
    operator: c.operator,
    ...(hasValue(c.value) && { value: c.value }),
  }
}

/** A subject with its empty parts left out, as the server sends one. */
function cleanSubject(s: PolicySubject): PolicySubject {
  return {
    ...(s.kind && { kind: s.kind }),
    ...(s.id && { id: s.id }),
    ...(s.role && { role: s.role }),
  }
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

interface EditorState {
  name: string
  description: string
  priority: string
  effect: string
  notBefore: string
  notAfter: string
  subjects: PolicySubject[]
  actions: string[]
  resources: string[]
  obligations: string[]
  conditions: ConditionRow[]
}

function stateFrom(p: PolicyDetail): EditorState {
  return {
    name: p.name,
    description: p.description ?? "",
    priority: String(p.priority),
    effect: p.effect,
    notBefore: p.notBefore ?? "",
    notAfter: p.notAfter ?? "",
    subjects: (p.subjects ?? []).map(cleanSubject),
    actions: [...(p.actions ?? [])],
    resources: [...(p.resources ?? [])],
    obligations: [...(p.obligations ?? [])],
    conditions: (p.conditions ?? []).map(rowFrom),
  }
}

/** The priority as the whole number the wire's `int` needs, or null. */
function priorityOf(text: string): number | null {
  const t = text.trim()
  if (t === "") return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}

/** The whole draft, as `policies.validate` reads it. */
export function draftOf(s: EditorState, loaded: PolicyDetail): PolicyDraft {
  return {
    name: s.name,
    description: s.description,
    effect: s.effect,
    // Priority is not validated, and a draft that cannot say one still has
    // everything else worth checking, so it goes as the stored one.
    priority: priorityOf(s.priority) ?? loaded.priority,
    notBefore: s.notBefore,
    notAfter: s.notAfter,
    subjects: s.subjects.map(cleanSubject),
    actions: s.actions,
    resources: s.resources,
    conditions: s.conditions.map(wireCondition),
    obligations: s.obligations,
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Only the parts that differ from the loaded policy. An untouched part is
 * absent, so the server leaves it alone; a list emptied here is `[]`, and a
 * bound cleared here is `""`.
 */
export function patchOf(s: EditorState, loaded: PolicyDetail): PolicyUpdatePayload {
  const out: PolicyUpdatePayload = { id: loaded.id }
  if (s.name !== loaded.name) out.name = s.name
  if (s.description !== (loaded.description ?? "")) out.description = s.description
  if (s.effect !== loaded.effect) out.effect = s.effect
  const priority = priorityOf(s.priority)
  if (priority !== null && priority !== loaded.priority) out.priority = priority
  if (s.notBefore !== (loaded.notBefore ?? "")) out.notBefore = s.notBefore
  if (s.notAfter !== (loaded.notAfter ?? "")) out.notAfter = s.notAfter
  const subjects = s.subjects.map(cleanSubject)
  if (!same(subjects, (loaded.subjects ?? []).map(cleanSubject))) out.subjects = subjects
  if (!same(s.actions, loaded.actions ?? [])) out.actions = [...s.actions]
  if (!same(s.resources, loaded.resources ?? [])) out.resources = [...s.resources]
  const conditions = s.conditions.map(wireCondition)
  if (!same(conditions, (loaded.conditions ?? []).map(storedCondition))) {
    out.conditions = conditions
  }
  if (!same(s.obligations, loaded.obligations ?? [])) out.obligations = [...s.obligations]
  return out
}

// ---------------------------------------------------------------------------
// The save confirmation
// ---------------------------------------------------------------------------

/**
 * Where a bound sits in time, in epoch milliseconds, or NaN when the page
 * cannot place it. Mirrors the shape Go's `time.Parse(time.RFC3339, ...)`
 * accepts, including a comma before the fraction, which `Date.parse` does
 * not read. NaN never means "the server will refuse this": only the
 * validate answer says that. It means only that the page does not know
 * when the bound falls.
 */
const RFC3339 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:[.,](\d+))?(Z|[+-]\d{2}:\d{2})$/

export function boundTime(raw: string): number {
  const m = RFC3339.exec(raw)
  if (!m) return Number.NaN
  const [, base, fraction, zone] = m
  return Date.parse(`${base}${fraction ? `.${fraction.slice(0, 3)}` : ""}${zone}`)
}

export interface SaveConfirmationInput {
  /** The loaded policy: its `isActive`, which the editor never changes, and its window. */
  loaded: PolicyDetail
  /** The effect as it will be saved. */
  effect: string
  /** The window as it will be saved, `""` for no bound. */
  notBefore: string
  notAfter: string
  /** From the latest `policies.validate` response for this exact draft. */
  matchesEverything: boolean
  /**
   * Whether that same response marks the window. Only this says the server
   * will refuse a window: the page never guesses it from its own parser.
   */
  windowRefused: boolean
  evaluationOff: boolean
  now: number
}

/**
 * What Save must confirm, or null when it saves straight away.
 *
 * It returns null only when the page is sure the saved policy will not
 * apply to every check, and each sentence is true in every case it appears
 * in:
 * - policy evaluation is off: no policy is evaluated at all;
 * - the server's analysis of this draft says it does not match everything;
 * - the policy is inactive, and the editor does not change that;
 * - the window is patched and the server's validate answer marks it, so the
 *   update is refused and nothing is saved;
 * - the saved window has ended (its end before now) or ends before it
 *   starts, judged only from bounds the page can place in time, because
 *   `EffectiveAt` then never holds again.
 * When a bound the server accepts cannot be placed, it still confirms, with
 * a sentence that names no time.
 *
 * The window tests are `EffectiveAt`'s: a policy is out of effect before
 * its start and after its end, so a start equal to now is open and an end
 * equal to now has not ended.
 *
 * Anything but exactly "allow" is a deny to the evaluator, so it reads as
 * one here too.
 */
export function saveConfirmation(input: SaveConfirmationInput): string | null {
  const { loaded, effect, notBefore, notAfter, matchesEverything, windowRefused, evaluationOff, now } =
    input
  if (evaluationOff || !matchesEverything || !loaded.isActive) return null
  const patched =
    notBefore !== (loaded.notBefore ?? "") || notAfter !== (loaded.notAfter ?? "")
  // The server judges a patched window as the merged pair, and validate
  // judged exactly that pair. An untouched window is never refused.
  if (patched && windowRefused) return null
  const start = notBefore ? boundTime(notBefore) : Number.NaN
  const end = notAfter ? boundTime(notAfter) : Number.NaN
  const startKnown = !Number.isNaN(start)
  const endKnown = !Number.isNaN(end)
  if (startKnown && endKnown && end < start) return null
  if (endKnown && end < now) return null

  const isAllow = effect === "allow"
  // An explicit deny beats every allow from every model (mergeDecisions),
  // so a deny that matches every check applies to every one of them. An
  // allow does not win outright: any deny policy that matches a check beats
  // it, so it grants only what no deny refuses.
  const lead = isAllow
    ? "This allow will grant every check in its namespace and below that no deny policy refuses"
    : "This deny will apply to every check in its namespace and below"
  const sep = isAllow ? ", " : " "
  const startUnknown = notBefore !== "" && !startKnown
  const endUnknown = notAfter !== "" && !endKnown
  if (startUnknown || endUnknown) return `${lead}${sep}whenever its window is open.`
  if (startKnown && start > now) {
    return `${lead}${sep}from ${windowTime(new Date(start).toISOString())}.`
  }
  return `${lead}${sep}as soon as you save.`
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

interface Issues {
  fields: Record<string, string>
  conditions: ConditionIssue[]
}

/**
 * The issues on a refused save, read defensively off `error.details`: it is
 * a free-form map, and a refusal without them marks nothing.
 */
export function issuesOf(error: ContractError | undefined): Issues {
  const details = error?.details
  const fields: Record<string, string> = {}
  const conditions: ConditionIssue[] = []
  const rawFields = details?.fields
  if (rawFields && typeof rawFields === "object" && !Array.isArray(rawFields)) {
    for (const [k, v] of Object.entries(rawFields as Record<string, unknown>)) {
      if (typeof v === "string") fields[k] = v
    }
  }
  const rawConditions = details?.conditions
  if (Array.isArray(rawConditions)) {
    for (const item of rawConditions) {
      if (typeof item !== "object" || item === null) continue
      const c = item as Record<string, unknown>
      if (typeof c.index === "number" && typeof c.message === "string") {
        conditions.push({ index: c.index, message: c.message })
      }
    }
  }
  return { fields, conditions }
}

const KNOWN_FIELDS = new Set([
  "name",
  "effect",
  "window",
  "subjects",
  "actions",
  "resources",
  "obligations",
])

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const LABEL = "text-muted-foreground"

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

/** A message the server (or the page, saying the server's sentence) attached to one part. */
function Issue({ part, children }: { part: string; children: ReactNode }) {
  return (
    <p data-issue={part} className="text-xs font-medium text-foreground">
      {children}
    </p>
  )
}

/** Chips joined by a muted `or`, each with a remove button, or the any-word when there are none. */
function RemovableChips({
  values,
  anyWord,
  noun,
  onRemove,
}: {
  values: string[]
  anyWord: string
  noun: string
  onRemove: (index: number) => void
}) {
  if (values.length === 0) return <Muted>{anyWord}</Muted>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {values.map((v, i) => (
        <Fragment key={`${i}-${v}`}>
          {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
          <Badge variant="outline" className="gap-1 pr-0.5 font-mono text-xs">
            {v === "" ? '""' : v}
            <button
              type="button"
              aria-label={`Remove ${noun} ${v}`}
              className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(i)}
            >
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          </Badge>
        </Fragment>
      ))}
    </span>
  )
}

/** One input and a button that adds its trimmed text as a chip. Enter adds too. */
function AddEntry({
  noun,
  placeholder,
  onAdd,
}: {
  noun: string
  placeholder?: string
  onAdd: (value: string) => void
}) {
  const [text, setText] = useState("")
  function add() {
    const v = text.trim()
    if (v === "") return
    onAdd(v)
    setText("")
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      add()
    }
  }
  return (
    <span className="flex items-center gap-1.5">
      <Input
        aria-label={`New ${noun}`}
        className="h-7 w-56 font-mono text-xs"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button type="button" size="xs" variant="outline" onClick={add}>
        {`Add ${noun}`}
      </Button>
    </span>
  )
}

/** The value input for one condition row, typed by its operator. */
function ValueInput({
  row,
  n,
  onChange,
}: {
  row: ConditionRow
  n: number
  onChange: (next: Partial<ConditionRow>) => void
}) {
  const kind = valueKind(row.operator)
  const label = `Condition ${n} value`
  switch (kind) {
    case "none":
      return null
    case "list":
    case "cidr": {
      const noun = kind === "cidr" ? `network for condition ${n}` : `value for condition ${n}`
      return (
        <span className="flex flex-col gap-1.5" data-value-kind={kind}>
          <RemovableChips
            values={row.items}
            anyWord="no values yet"
            noun={noun}
            onRemove={(i) => onChange({ items: row.items.filter((_, j) => j !== i) })}
          />
          <AddEntry
            noun={noun}
            placeholder={kind === "cidr" ? "network" : "value"}
            onAdd={(v) => onChange({ items: [...row.items, v] })}
          />
        </span>
      )
    }
    case "number":
      return (
        <Input
          aria-label={label}
          data-value-kind={kind}
          type="number"
          inputMode="decimal"
          className="h-7 w-32 font-mono text-xs"
          value={row.text}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      )
  }
  // Placeholders name the shape, never a plausible value, so an empty input
  // cannot be read as one that is set.
  const placeholder =
    kind === "time" ? "RFC3339 time" : kind === "pattern" ? "pattern" : "value"
  return (
    <Input
      aria-label={label}
      data-value-kind={kind}
      className="h-7 w-56 font-mono text-xs"
      placeholder={placeholder}
      value={row.text}
      onChange={(e) => onChange({ text: e.target.value })}
    />
  )
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

/**
 * An open confirmation: what it says, what it will send, and what the
 * sentence was judged from, so confirming can judge it again against the
 * clock at that moment.
 */
interface Pending {
  sentence: string
  patch: PolicyUpdatePayload
  key: string
  judged: Omit<SaveConfirmationInput, "now">
}

/**
 * The rule block with every clause edited in place, and the aside's name,
 * description and priority.
 *
 * The draft is checked by `policies.validate` 400 ms after it stops changing,
 * and each part and each condition row is marked with the server's own
 * messages while they are about the draft on screen. Save sends only what
 * differs from the loaded policy.
 */
export function PolicyEditor({
  policy,
  evaluationOff = false,
}: {
  policy: PolicyDetail
  /** Only an explicit false from config.detail, never an unreadable config. */
  evaluationOff?: boolean
}) {
  const client = usePluginClient()
  const navigate = useNavigateTo()
  const update = useCommand<AckResponse>("policies.update")

  // What the editor loaded, and so what Save diffs against. Held, not read
  // from the prop, so a refetch cannot move the baseline under a draft.
  const [loaded] = useState(policy)
  const [state, setState] = useState(() => stateFrom(policy))
  const [kind, setKind] = useState("")
  const [subjectId, setSubjectId] = useState("")
  const [subjectRole, setSubjectRole] = useState("")
  const [subjectRefused, setSubjectRefused] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<ContractError | undefined>(undefined)
  const [refusedKey, setRefusedKey] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Pending | null>(null)
  // Whether this editor is still mounted, and whether Cancel was pressed.
  // A check or a save still in flight reads them when it settles, so
  // leaving the editor can never be followed by a save or a navigation.
  const alive = useRef(true)
  const cancelled = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  // Set when the draft changed while Save was checking it, so what the
  // operator asked to save is no longer what is on screen.
  const [changedMidCheck, setChangedMidCheck] = useState(false)

  const draft = draftOf(state, loaded)
  const draftKey = JSON.stringify(draft)
  // The draft on screen, for a check that settles after it was taken.
  const latestKey = useRef(draftKey)
  useEffect(() => {
    latestKey.current = draftKey
  }, [draftKey])

  // The draft validate is asked about, 400 ms after the last change. Kept as
  // its serialised key so the effect depends on the draft's content only.
  const [validatedKey, setValidatedKey] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setValidatedKey(draftKey), 400)
    return () => clearTimeout(t)
  }, [draftKey])
  const validation = useQuery<PolicyValidateResponse>(
    "policies.validate",
    validatedKey === null ? undefined : (JSON.parse(validatedKey) as Record<string, unknown>),
    { enabled: validatedKey !== null }
  )
  // Marks are about the draft on screen or not shown at all.
  const verdict = validatedKey === draftKey ? validation.data : undefined
  const refused = refusedKey === draftKey ? issuesOf(update.error) : undefined

  const fieldIssues: Record<string, string[]> = {}
  const conditionIssues: Record<number, string[]> = {}
  for (const source of [verdict, refused]) {
    if (!source) continue
    for (const [k, v] of Object.entries(source.fields ?? {})) {
      const list = (fieldIssues[k] ??= [])
      if (!list.includes(v)) list.push(v)
    }
    for (const c of source.conditions ?? []) {
      const list = (conditionIssues[c.index] ??= [])
      if (!list.includes(c.message)) list.push(c.message)
    }
  }
  const otherFields = Object.keys(fieldIssues).filter((k) => !KNOWN_FIELDS.has(k))

  const priorityBad = priorityOf(state.priority) === null
  const patch = patchOf(state, loaded)
  const changed = Object.keys(patch).length > 1

  function edit(next: Partial<EditorState>) {
    setState((s) => ({ ...s, ...next }))
  }

  function editRow(index: number, next: Partial<ConditionRow>) {
    setState((s) => ({
      ...s,
      conditions: s.conditions.map((r, i) => (i === index ? { ...r, ...next } : r)),
    }))
  }

  function setOperator(index: number, operator: string) {
    setState((s) => ({
      ...s,
      conditions: s.conditions.map((r, i) => {
        if (i !== index) return r
        // A value of the wrong JSON type for the new operator is cleared,
        // never carried over to be sent as something it is not.
        const keep = wireType(valueKind(r.operator)) === wireType(valueKind(operator))
        return keep ? { ...r, operator } : { ...r, operator, items: [], text: "" }
      }),
    }))
  }

  function addSubject() {
    const s = cleanSubject({ kind: kind.trim(), id: subjectId.trim(), role: subjectRole.trim() })
    if (!s.kind && !s.id && !s.role) {
      setSubjectRefused(true)
      return
    }
    setSubjectRefused(false)
    edit({ subjects: [...state.subjects, s] })
    setKind("")
    setSubjectId("")
    setSubjectRole("")
  }

  async function send(p: PolicyUpdatePayload, key: string): Promise<boolean> {
    // The version from `loaded`, never the prop, so the server judges the
    // draft against the policy it was made from.
    const result = await update.execute({ ...p, expectedVersion: loaded.version })
    // execute() resolves undefined only when the command failed, so this is
    // the success check. A refusal keeps the form and everything typed.
    if (result === undefined) {
      if (alive.current) setRefusedKey(key)
      return false
    }
    // Only an editor still on screen moves the operator: one that was left
    // mid-save must not pull them back from wherever they went.
    if (alive.current) navigate(`/policies/${loaded.id}`)
    return true
  }

  async function save() {
    if (priorityBad || !changed) return
    // A confirmation belongs to the one save it was computed for. Whatever
    // an earlier save left behind is dropped before this one is judged, so
    // no dialog can come back over this save with its sentence or its
    // patch.
    setConfirming(null)
    setChangedMidCheck(false)
    setCheckError(undefined)
    // Cleared by nothing: once Cancel has been pressed, nothing this
    // editor started may still save.
    if (cancelled.current) return
    // The patch, the draft and the confirmation are all about this one
    // snapshot, whatever is typed while the check is in flight.
    const p = patch
    const key = draftKey
    let answer = validatedKey === key && !validation.error ? validation.data : undefined
    if (!answer) {
      // The debounce has not caught up with the draft, so ask about exactly
      // this draft now. The confirmation is never judged on an older one.
      setChecking(true)
      try {
        answer = await client.query<PolicyValidateResponse>(
          "policies.validate",
          JSON.parse(key) as Record<string, unknown>
        )
      } catch (e) {
        if (!alive.current || cancelled.current) return
        setCheckError(e as ContractError)
        setChecking(false)
        // No answer, no save: the page cannot tell whether this draft
        // would need confirming, so it sends nothing.
        return
      }
      // The editor was left while the check was in flight. What was asked
      // for no longer stands, so nothing is sent.
      if (!alive.current || cancelled.current) return
      setChecking(false)
      // The draft was edited while it was being checked. The answer, the
      // patch and any sentence are about a draft no longer on screen, so
      // nothing is sent and nothing is confirmed.
      if (latestKey.current !== key) {
        setChangedMidCheck(true)
        return
      }
    }
    const judged = {
      loaded,
      effect: state.effect,
      notBefore: state.notBefore,
      notAfter: state.notAfter,
      matchesEverything: answer?.matchesEverything === true,
      windowRefused: typeof answer?.fields?.window === "string",
      evaluationOff,
    }
    const sentence = saveConfirmation({ ...judged, now: Date.now() })
    if (sentence) {
      update.reset()
      setConfirming({ sentence, patch: p, key, judged })
      return
    }
    await send(p, key)
  }

  async function confirmSave() {
    if (!confirming) return
    // Never send a patch for a draft that is no longer the one on screen.
    if (confirming.key !== draftKey) {
      setConfirming(null)
      return
    }
    // Judged again at the moment of confirming: a window can open or close
    // while the dialog is up. A sentence that no longer holds is replaced
    // and must be confirmed again; a save that no longer needs confirming
    // (its window has ended) goes out.
    const sentence = saveConfirmation({ ...confirming.judged, now: Date.now() })
    if (sentence !== null && sentence !== confirming.sentence) {
      setConfirming({ ...confirming, sentence })
      return
    }
    await send(confirming.patch, confirming.key)
  }

  // A refusal that names parts or rows takes the dialog down, so the marks
  // it put on the form are not left behind an inert dialog, and the
  // confirmation is dropped with it: it was for a save that is over. Any
  // other failure stays in the dialog that failed. Set while rendering,
  // which React supports for state derived from what just changed.
  const refusal = issuesOf(update.error)
  const refusalNamesRows =
    Object.keys(refusal.fields).length > 0 || refusal.conditions.length > 0
  if (
    confirming !== null &&
    update.error !== undefined &&
    refusalNamesRows &&
    refusedKey === confirming.key
  ) {
    setConfirming(null)
  }
  // Open only for the draft on screen, so the dialog can never show a
  // sentence computed for another draft or send another draft's patch.
  const dialogOpen = confirming !== null && confirming.key === draftKey

  const saving = update.loading && !dialogOpen
  // A stale refusal is said in the page's words, with the server's code;
  // every other refusal in the server's own, wherever it is shown.
  const saveError = (
    <CommandAlert
      error={isStale(update.error) ? { code: "CONFLICT", message: STALE_EDIT } : update.error}
      title="Could not save the policy"
    />
  )
  const isAllow = state.effect === "allow"
  const rows = state.conditions

  const main = (
    <section aria-label="Rule editor" className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <div role="group" aria-label="Effect" className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={isAllow ? "secondary" : "ghost"}
            aria-pressed={isAllow}
            className="text-base font-medium text-foreground"
            onClick={() => edit({ effect: "allow" })}
          >
            Allow
          </Button>
          {/* Colour means "this overrides", so only a chosen Deny carries it.
              Anything but exactly "allow" is a deny, so it reads as one. */}
          <Button
            type="button"
            size="sm"
            variant={isAllow ? "ghost" : "secondary"}
            aria-pressed={!isAllow}
            className={cn("text-base font-medium", isAllow ? "text-foreground" : "text-destructive")}
            onClick={() => edit({ effect: "deny" })}
          >
            Deny
          </Button>
        </div>
        {fieldIssues.effect?.map((m) => (
          <Issue key={m} part="effect">
            {m}
          </Issue>
        ))}
      </div>

      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 text-sm">
        <dt className={LABEL}>subject</dt>
        <dd data-row="subject" className="flex flex-col gap-1.5">
          <RemovableChips
            values={state.subjects.map((s) =>
              !s.kind && !s.id && !s.role ? "empty matcher" : subjectText(s)
            )}
            anyWord="anyone"
            noun="subject"
            onRemove={(i) => edit({ subjects: state.subjects.filter((_, j) => j !== i) })}
          />
          <span className="flex flex-wrap items-center gap-1.5">
            <NativeSelect
              aria-label="New subject kind"
              size="sm"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value)
                setSubjectRefused(false)
              }}
            >
              <NativeSelectOption value="">any kind</NativeSelectOption>
              {SUBJECT_KINDS.map((k) => (
                <NativeSelectOption key={k} value={k}>
                  {k}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label="New subject id"
              placeholder="id"
              className="h-7 w-32 font-mono text-xs"
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value)
                setSubjectRefused(false)
              }}
            />
            <Input
              aria-label="New subject role"
              placeholder="role"
              className="h-7 w-32 font-mono text-xs"
              value={subjectRole}
              onChange={(e) => {
                setSubjectRole(e.target.value)
                setSubjectRefused(false)
              }}
            />
            <IconButton type="button" variant="outline" onClick={addSubject} label="Add subject" />
          </span>
          {subjectRefused && <Issue part="new-subject">{EMPTY_SUBJECT}</Issue>}
          {fieldIssues.subjects?.map((m) => (
            <Issue key={m} part="subjects">
              {m}
            </Issue>
          ))}
        </dd>

        <dt className={LABEL}>action</dt>
        <dd data-row="action" className="flex flex-col gap-1.5">
          <RemovableChips
            values={state.actions}
            anyWord="any action"
            noun="action"
            onRemove={(i) => edit({ actions: state.actions.filter((_, j) => j !== i) })}
          />
          <AddEntry
            noun="action"
            placeholder="action"
            onAdd={(v) => edit({ actions: [...state.actions, v] })}
          />
          {fieldIssues.actions?.map((m) => (
            <Issue key={m} part="actions">
              {m}
            </Issue>
          ))}
        </dd>

        <dt className={LABEL}>resource</dt>
        <dd data-row="resource" className="flex flex-col gap-1.5">
          <RemovableChips
            values={state.resources}
            anyWord="any resource"
            noun="resource"
            onRemove={(i) => edit({ resources: state.resources.filter((_, j) => j !== i) })}
          />
          <AddEntry
            noun="resource"
            placeholder="resource"
            onAdd={(v) => edit({ resources: [...state.resources, v] })}
          />
          {fieldIssues.resources?.map((m) => (
            <Issue key={m} part="resources">
              {m}
            </Issue>
          ))}
        </dd>

        {rows.map((r, i) => {
          const n = i + 1
          const issues = conditionIssues[i]
          const known = r.operator in OPERATOR_WORDS
          return (
            <Fragment key={r.key}>
              <dt className={cn(LABEL, i > 0 && "text-right")}>{i === 0 ? "when" : "and"}</dt>
              <dd
                data-condition={i}
                data-invalid={issues ? "true" : undefined}
                className="flex flex-col gap-1.5"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Condition ${n} field`}
                    aria-invalid={issues ? true : undefined}
                    placeholder="field"
                    className="h-7 w-44 font-mono text-xs"
                    value={r.field}
                    onChange={(e) => editRow(i, { field: e.target.value })}
                  />
                  <NativeSelect
                    aria-label={`Condition ${n} operator`}
                    size="sm"
                    value={r.operator}
                    onChange={(e) => setOperator(i, e.target.value)}
                  >
                    {/* A stored operator warden does not know still shows,
                        so the select never claims a row says something it
                        does not. The server marks the row. */}
                    {!known && (
                      <NativeSelectOption value={r.operator}>{r.operator}</NativeSelectOption>
                    )}
                    {Object.entries(OPERATOR_WORDS).map(([op, words]) => (
                      <NativeSelectOption key={op} value={op}>
                        {words}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <ValueInput row={r} n={n} onChange={(next) => editRow(i, next)} />
                  <IconButton type="button" variant="ghost" onClick={() =>
                      edit({ conditions: state.conditions.filter((_, j) => j !== i) })
                    } label={`Remove condition ${n}`} />
                </span>
                {issues?.map((m) => (
                  <Issue key={m} part={`condition-${i}`}>
                    {m}
                  </Issue>
                ))}
              </dd>
            </Fragment>
          )
        })}
        <dt className={LABEL}>
          {/* The cell stays in the grid; only its word is for screen readers
              once the rows above carry when and and. */}
          {rows.length === 0 ? "when" : <span className="sr-only">more conditions</span>}
        </dt>
        <dd>
          <span className="flex flex-col gap-1">
            <span>
              <IconButton type="button" variant="outline" onClick={() =>
                  edit({
                    conditions: [
                      ...state.conditions,
                      { key: nextRowKey++, field: "", operator: "eq", items: [], text: "" },
                    ],
                  })
                } label="Add condition" />
            </span>
            {rows.length === 0 && <Muted>no conditions, so it applies whenever it matches</Muted>}
          </span>
        </dd>

        <dt className={LABEL}>in effect</dt>
        <dd data-row="window" className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <Muted>from</Muted>
            <Input
              aria-label="In effect from"
              aria-invalid={fieldIssues.window ? true : undefined}
              placeholder="no start"
              className="h-7 w-56 font-mono text-xs"
              value={state.notBefore}
              onChange={(e) => edit({ notBefore: e.target.value })}
            />
            <IconButton type="button" variant="ghost" disabled={state.notBefore === ""} onClick={() => edit({ notBefore: "" })} label="Clear start" />
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Muted>until</Muted>
            <Input
              aria-label="In effect until"
              aria-invalid={fieldIssues.window ? true : undefined}
              placeholder="no end"
              className="h-7 w-56 font-mono text-xs"
              value={state.notAfter}
              onChange={(e) => edit({ notAfter: e.target.value })}
            />
            <IconButton type="button" variant="ghost" disabled={state.notAfter === ""} onClick={() => edit({ notAfter: "" })} label="Clear end" />
          </span>
          <span className="text-xs text-muted-foreground">
            RFC3339, like 2026-06-01T09:00:00Z. An empty bound is no bound.
          </span>
          {fieldIssues.window?.map((m) => (
            <Issue key={m} part="window">
              {m}
            </Issue>
          ))}
        </dd>

        <dt className={LABEL}>emits</dt>
        <dd data-row="emits" className="flex flex-col gap-1.5">
          <RemovableChips
            values={state.obligations}
            anyWord="nothing"
            noun="obligation"
            onRemove={(i) => edit({ obligations: state.obligations.filter((_, j) => j !== i) })}
          />
          <AddEntry
            noun="obligation"
            placeholder="obligation"
            onAdd={(v) => edit({ obligations: [...state.obligations, v] })}
          />
          {fieldIssues.obligations?.map((m) => (
            <Issue key={m} part="obligations">
              {m}
            </Issue>
          ))}
        </dd>
      </dl>
    </section>
  )

  const aside = (
    <section aria-label="Details" className="flex flex-col gap-4 text-sm">
      <span className="flex flex-col gap-1.5">
        <Label htmlFor="policy-edit-name">Name</Label>
        <Input
          id="policy-edit-name"
          aria-invalid={fieldIssues.name ? true : undefined}
          value={state.name}
          onChange={(e) => edit({ name: e.target.value })}
        />
        {fieldIssues.name?.map((m) => (
          <Issue key={m} part="name">
            {m}
          </Issue>
        ))}
      </span>
      <span className="flex flex-col gap-1.5">
        <Label htmlFor="policy-edit-description">Description</Label>
        <Textarea
          id="policy-edit-description"
          value={state.description}
          onChange={(e) => edit({ description: e.target.value })}
        />
      </span>
      <span className="flex flex-col gap-1.5">
        <Label htmlFor="policy-edit-priority">Priority</Label>
        <Input
          id="policy-edit-priority"
          type="number"
          inputMode="numeric"
          aria-invalid={priorityBad ? true : undefined}
          className="w-32 tabular-nums"
          value={state.priority}
          onChange={(e) => edit({ priority: e.target.value })}
        />
        <span className="text-xs text-muted-foreground">{PRIORITY_HELP}</span>
        {priorityBad && <Issue part="priority">{PRIORITY_NOT_WHOLE}</Issue>}
      </span>
    </section>
  )

  return (
    <div className="flex flex-col gap-4">
      <DetailLayout main={main} aside={aside} />

      {otherFields.map((k) =>
        fieldIssues[k].map((m) => (
          <Issue key={`${k}-${m}`} part={k}>
            {`${k}: ${m}`}
          </Issue>
        ))
      )}
      {/* Errors live in the form that failed. While the dialog is open the
          form is inert, so the dialog carries its own. */}
      {!dialogOpen && saveError}
      <CommandAlert error={checkError} title="Could not check the draft" />
      {changedMidCheck && (
        <p role="status" className="text-sm text-muted-foreground">
          {CHANGED_MID_CHECK}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          disabled={!changed || priorityBad || checking || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : checking ? "Checking…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving || checking}
          onClick={() => {
            cancelled.current = true
            navigate(`/policies/${loaded.id}`)
          }}
        >
          Cancel
        </Button>
      </div>

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Save changes to ${loaded.name}?`}
        destructive={false}
        confirmLabel="Save changes"
        pending={update.loading}
        onConfirm={() => void confirmSave()}
        description={confirming?.sentence}
      >
        {saveError}
      </ConfirmDialog>
    </div>
  )
}
