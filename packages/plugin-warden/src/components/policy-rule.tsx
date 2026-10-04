import { Fragment, type ReactNode } from "react"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import type { PolicySummary } from "../pages/policies"

/** Mirrors the Go `PolicySubject`. Every part is omitted when empty. */
export interface PolicySubject {
  kind?: string
  id?: string
  role?: string
}

/**
 * Mirrors the Go `PolicyCondition`. `value` is `any` there and omitted when
 * nil, so it is `unknown` here and can be absent.
 */
export interface PolicyCondition {
  id?: string
  field: string
  operator: string
  value?: unknown
}

/** The Go `ConditionProblem` values. Absent on the wire when there is none. */
export type ConditionProblem = "throws" | "alwaysFalse" | "alwaysTrue"

/** The Go `ConditionReason` values. Absent on the wire when there is none. */
export type ConditionReason =
  | "unknownOperator"
  | "invalidRegex"
  | "unresolvableField"
  | "notAList"
  | "emptyList"
  | "notANumber"
  | "noValidCIDR"
  | "notATime"
  | "alwaysPresent"
  | "matchesAnything"

/**
 * Mirrors the Go `PolicyConditionView`: the stored condition, embedded so the
 * JSON is flat, plus what the server's analysis says it will do.
 */
export interface PolicyConditionView extends PolicyCondition {
  problem?: ConditionProblem
  reason?: ConditionReason
}

/**
 * Mirrors the Go `PolicyDetail`: `PolicySummary` embedded, so the JSON is flat.
 *
 * The three `*Unrestricted` flags, `hasRoleMatcher`, `decidingCondition` and
 * every condition's `problem` and `reason` come from the server's analysis.
 * The page renders them and never derives them: which action patterns match
 * everything, for one, is a fact about warden's matcher that only the server
 * is tested against.
 */
export interface PolicyDetail extends PolicySummary {
  subjects: PolicySubject[]
  actions: string[]
  resources: string[]
  conditions: PolicyConditionView[]
  obligations: string[]
  notBefore?: string
  notAfter?: string
  subjectsUnrestricted: boolean
  actionsUnrestricted: boolean
  resourcesUnrestricted: boolean
  hasRoleMatcher: boolean
  /** The index of the condition that fails closed or never holds. */
  decidingCondition?: number
  createdBy?: string
  updatedBy?: string
  createdAt: string
}

/** Each operator in words, keyed by the Go `policy.Operator` value. */
export const OPERATOR_WORDS: Record<string, string> = {
  eq: "equals",
  neq: "does not equal",
  in: "in",
  not_in: "not in",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  gt: "greater than",
  lt: "less than",
  gte: "at least",
  lte: "at most",
  exists: "exists",
  not_exists: "does not exist",
  ip_in_cidr: "in network",
  time_after: "after",
  time_before: "before",
  regex: "matches",
}

/** The operators that test presence and so have no value to show. */
const NO_VALUE = new Set(["exists", "not_exists"])

/** A field as written, with the empty one made visible. */
function fieldText(field: string): string {
  return field === "" ? '""' : field
}

function reasonText(reason: ConditionReason, field: string): string | null {
  switch (reason) {
    case "matchesAnything":
      return "This value matches every string."
    case "alwaysPresent":
      return `Warden always gives ${fieldText(field)} a value, even an empty one.`
    case "unresolvableField":
      return `Warden never gives ${fieldText(field)} a value.`
    case "notAList":
      return "It needs a list of values, not one."
    case "emptyList":
      return "The list is empty."
    case "notANumber":
      return "It compares numbers, and the value is not one."
    case "noValidCIDR":
      return "None of these parse as a network."
    case "notATime":
      return "The value is not an RFC3339 time."
  }
  return null
}

/**
 * The note under a condition row, or null when the condition depends on the
 * check being made.
 *
 * Every sentence here was checked against `classifyCondition` in
 * `policy_analysis.go` for every condition that can carry the pair. Some of
 * them describe the value ("It needs a list of values, not one."), and they
 * are true of what warden evaluates because every store hands the engine
 * plain Go values: the mongo store normalises its driver types (bson.A,
 * bson.DateTime) on read, so a stored list is a list to the evaluator too.
 *
 * `notAList` arrives two ways. Current warden refuses to evaluate an `in` or
 * `not_in` whose value is not a list, so it sends `throws`. An older warden
 * read that value as an empty list and sends `alwaysTrue` or `alwaysFalse`.
 * Both are rendered, because the page can talk to either.
 */
export function conditionNote(
  problem: ConditionProblem | undefined,
  reason: ConditionReason | undefined,
  field: string
): string | null {
  if (!problem) return null
  if (problem === "throws") {
    if (reason === "unknownOperator") {
      return "This is not an operator warden knows, so it cannot be evaluated."
    }
    if (reason === "invalidRegex") {
      return "This pattern does not compile, so it cannot be evaluated."
    }
    if (reason === "notAList") {
      return "This needs a list of values, not one, so it cannot be evaluated."
    }
    return null
  }
  const lead =
    problem === "alwaysTrue" ? "This is always true, so it restricts nothing." : "This is always false."
  const why = reason ? reasonText(reason, field) : null
  return why ? `${lead} ${why}` : lead
}

/**
 * A window bound in words. UTC, and to the minute (to the second when there is
 * one), because "until 30 Jun" in a viewer's own zone can be a day off from
 * when the window actually closes.
 */
export function windowTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const format = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(d.getUTCSeconds() !== 0 && { second: "2-digit" }),
    hourCycle: "h23",
    timeZone: "UTC",
  })
  return `${format.format(d)} UTC`
}

/** "from X until Y", "from X", "until Y", or null with no window. */
export function windowPhrase(notBefore?: string, notAfter?: string): string | null {
  if (notBefore && notAfter) return `from ${windowTime(notBefore)} until ${windowTime(notAfter)}`
  if (notBefore) return `from ${windowTime(notBefore)}`
  if (notAfter) return `until ${windowTime(notAfter)}`
  return null
}

/** The priority's help text, on the detail page and in the editor. */
export const PRIORITY_HELP =
  "Decides which policy is cited when several match, not which one wins."

/**
 * Whether the policy's window would stop it taking effect even once active:
 * "inverted" when it ends before it starts, "ended" when its end is past,
 * null otherwise. The same tests `policyState` makes, applied to an inactive
 * policy, whose server state says only "inactive".
 */
export function closedWindow(p: PolicyDetail, now: number): "inverted" | "ended" | null {
  const start = p.notBefore ? Date.parse(p.notBefore) : Number.NaN
  const end = p.notAfter ? Date.parse(p.notAfter) : Number.NaN
  if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) return "inverted"
  if (!Number.isNaN(end) && end < now) return "ended"
  return null
}

/** A subject matcher's AND-ed parts, read as one phrase. */
export function subjectText(s: PolicySubject): string {
  const role = s.role ? `role ${s.role}` : ""
  let who: string
  if (s.kind && s.id) who = `${s.kind}: ${s.id}`
  else if (s.id) who = `id: ${s.id}`
  else if (s.kind) who = role ? s.kind : `any ${s.kind}`
  else return `role: ${s.role ?? ""}`
  return role ? `${who} with ${role}` : who
}

/** The entries that match every action or resource in warden's matchGlob. */
const MATCH_EVERY = new Set(["*", "*:*", "*.*"])

function valueItem(v: unknown): string {
  if (typeof v === "string") return v === "" ? '""' : v
  if (v === null || typeof v === "object") return JSON.stringify(v)
  return String(v)
}

/**
 * A condition's value as written. A list keeps its brackets, so a list of one
 * never reads like the single string an `in` refuses.
 */
function ValueText({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <NoneCell label="value" />
  const text = Array.isArray(value)
    ? `[${value.map(valueItem).join(", ")}]`
    : valueItem(value)
  return <span className="font-mono text-xs">{text}</span>
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

function Chips({ values }: { values: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {values.map((v, i) => (
        <Fragment key={`${i}-${v}`}>
          {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
          <Badge variant="outline" className="font-mono text-xs">
            {v}
          </Badge>
        </Fragment>
      ))}
    </span>
  )
}

/**
 * One matcher row's value: chips joined by `or`, or the muted any-word.
 *
 * Unrestricted is the server's flag, never a count of the list here. When the
 * list is not empty, a note names what made it unrestricted, because the
 * entries are right there and an operator would otherwise ask why they do not
 * show.
 */
function Matchers({
  unrestricted,
  anyWord,
  chips,
  note,
}: {
  unrestricted: boolean
  anyWord: string
  chips: string[]
  note: ReactNode
}) {
  if (unrestricted) {
    return (
      <>
        <Muted>{anyWord}</Muted>
        {chips.length > 0 && note && <Note>{note}</Note>}
      </>
    )
  }
  return <Chips values={chips} />
}

function wildcardNote(list: string[], noun: string): ReactNode {
  const entry = list.find((v) => MATCH_EVERY.has(v))
  if (entry === undefined) return null
  return (
    <>
      <span className="font-mono">{entry}</span> matches every {noun}.
    </>
  )
}

/**
 * Whether the block reads dimmed. Visual weight tracks real effect now: a
 * policy that is off, out of its window or can never hold does nothing, and
 * neither does any policy while the deployment has policy evaluation turned
 * off. An active deny that fails closed, with evaluation on, is never dimmed,
 * because it is the most consequential thing a policy can do, and it is
 * doing it.
 */
export function isDimmed(policy: PolicyDetail, evaluationOff = false): boolean {
  return evaluationOff || policy.state !== "active" || policy.neverApplies
}

const LABEL = "text-muted-foreground"

/**
 * The rule block: what one policy does, read top to bottom.
 *
 * Colour means "this overrides", so only the Deny heading carries it. An
 * explicit deny beats every other model; an allow does not, and stays in the
 * foreground colour.
 */
export function PolicyRule({
  policy,
  evaluationOff = false,
}: {
  policy: PolicyDetail
  /** The deployment reports policy evaluation turned off. Only an explicit false from config.detail, never an unreadable config. */
  evaluationOff?: boolean
}) {
  const dimmed = isDimmed(policy, evaluationOff)
  const isAllow = policy.effect === "allow"
  const subjects = policy.subjects ?? []
  const actions = policy.actions ?? []
  const resources = policy.resources ?? []
  const conditions = policy.conditions ?? []
  const obligations = policy.obligations ?? []
  const inEffect = windowPhrase(policy.notBefore, policy.notAfter)
  const hasEmptyMatcher = subjects.some((s) => !s.kind && !s.id && !s.role)

  return (
    <section
      aria-label="Rule"
      data-dimmed={dimmed ? "true" : "false"}
      className={cn("flex flex-col gap-3 rounded-md border p-4", dimmed && "opacity-60")}
    >
      {/* Anything but exactly "allow" is a deny to the evaluator, so it reads
          as one here too. */}
      <h2 className={cn("text-base font-medium", isAllow ? "text-foreground" : "text-destructive")}>
        {isAllow ? "Allow" : "Deny"}
      </h2>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 text-sm">
        <dt className={LABEL}>subject</dt>
        <dd data-row="subject">
          <Matchers
            unrestricted={policy.subjectsUnrestricted}
            anyWord="anyone"
            chips={subjects.map(subjectText)}
            note={
              hasEmptyMatcher
                ? "One of its subject matchers is empty, which matches every subject."
                : null
            }
          />
        </dd>

        <dt className={LABEL}>action</dt>
        <dd data-row="action">
          <Matchers
            unrestricted={policy.actionsUnrestricted}
            anyWord="any action"
            chips={actions}
            note={wildcardNote(actions, "action")}
          />
        </dd>

        <dt className={LABEL}>resource</dt>
        <dd data-row="resource">
          <Matchers
            unrestricted={policy.resourcesUnrestricted}
            anyWord="any resource"
            chips={resources}
            note={wildcardNote(resources, "resource")}
          />
        </dd>

        {conditions.map((c, i) => {
          const note = conditionNote(c.problem, c.reason, c.field)
          const deciding = policy.decidingCondition === i
          return (
            <Fragment key={c.id || i}>
              <dt className={cn(LABEL, i > 0 && "text-right")}>{i === 0 ? "when" : "and"}</dt>
              <dd
                data-condition={i}
                data-deciding={deciding ? "true" : undefined}
                className={cn(deciding && "-ml-2 border-l-2 border-foreground pl-2")}
              >
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xs">{fieldText(c.field)}</span>
                  <span>{OPERATOR_WORDS[c.operator] ?? c.operator}</span>
                  {!NO_VALUE.has(c.operator) && <ValueText value={c.value} />}
                  {deciding && (
                    <span className="text-xs text-muted-foreground">condition {i + 1}</span>
                  )}
                </span>
                {note && <Note>{note}</Note>}
              </dd>
            </Fragment>
          )
        })}

        {inEffect && (
          <>
            <dt className={LABEL}>in effect</dt>
            <dd data-row="window">{inEffect}</dd>
          </>
        )}

        {obligations.length > 0 && (
          <>
            <dt className={LABEL}>emits</dt>
            <dd data-row="emits">
              <span className="flex flex-wrap gap-1.5">
                {obligations.map((o, i) => (
                  <Badge key={`${i}-${o}`} variant="outline" className="font-mono text-xs">
                    {o}
                  </Badge>
                ))}
              </span>
            </dd>
          </>
        )}
      </dl>
    </section>
  )
}
