import { PluginLink } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import type { CheckMatch } from "./check-log"
import { relationGraphPath } from "./relation-graph-path"

/**
 * What one model did in an explained check. The values are `warden.LaneState`
 * in the engine, and the wire carries them as they are.
 */
export type LaneState =
  | "allow"
  | "deny"
  | "noMatch"
  | "skipped"
  | "disabled"
  | "error"
  | "notEvaluated"

/** Mirrors the Go `PlaygroundLane`. Field names are its JSON tags. */
export interface PlaygroundLane {
  model: "rbac" | "rebac" | "abac"
  state: LaneState
  decision?: string
  reason?: string
  matchedBy: CheckMatch[]
  walkTruncated?: boolean
  expressionError?: string
  error?: string
}

/**
 * Mirrors the Go `PlaygroundExplainResponse`. `decision` is "error" when a
 * model failed, and then `error` is set and there is no merged verdict.
 */
export interface PlaygroundResult {
  decision: string
  allowed: boolean
  reason?: string
  error?: string
  matchedBy: CheckMatch[]
  obligations: string[]
  evalTimeNs: number
  lanes: PlaygroundLane[]
}

/**
 * Mirrors the Go `PlaygroundExplainInput`. There is no tenant field: the
 * tenant is the caller's. `namespacePath` is always sent, and "" is the root.
 */
export interface PlaygroundInput {
  subjectKind: string
  subjectId: string
  action: string
  resourceType: string
  resourceId?: string
  namespacePath: string
  context?: Record<string, unknown>
  subjectAttributes?: Record<string, unknown>
  resourceAttributes?: Record<string, unknown>
}

type Model = PlaygroundLane["model"]

/** The engine's pipeline order, which is also the order `mergeDecisions` reads. */
const PIPELINE: readonly Model[] = ["rbac", "rebac", "abac"]

const MODEL_NAME: Record<Model, string> = {
  rbac: "RBAC",
  rebac: "ReBAC",
  abac: "ABAC",
}

/** The lanes in pipeline order, whatever order they arrived in. */
function inOrder(result: PlaygroundResult): PlaygroundLane[] {
  const found: PlaygroundLane[] = []
  for (const model of PIPELINE) {
    const lane = (result.lanes ?? []).find((l) => l.model === model)
    if (lane) found.push(lane)
  }
  return found
}

/**
 * Whether the deciding lane decided the verdict (an allow or an explicit
 * deny) or only supplied the reason for any other denial.
 */
export function decidingLaneOnlyGaveReason(result: PlaygroundResult): boolean {
  return result.decision !== "allow" && result.decision !== "deny_explicit"
}

/**
 * The lane whose result the engine's merge chose, or null.
 *
 * This mirrors `mergeDecisions`, which is the only place the choice is made:
 * an explicit deny always comes from ABAC; otherwise the first allow in order
 * rbac, rebac, abac wins; otherwise the first result with a reason is the
 * one whose reason the denial reports. A denial no model gave a reason for
 * is the engine's own default sentence, and no lane owns it. A failed model
 * has no merged result at all.
 */
export function decidingLane(result: PlaygroundResult): Model | null {
  if (result.decision === "error") return null
  if (result.decision === "deny_explicit") return "abac"
  const lanes = inOrder(result)
  if (result.decision === "allow") {
    return lanes.find((l) => l.state === "allow")?.model ?? null
  }
  return lanes.find((l) => l.reason)?.model ?? null
}

const WALK_NOTE =
  "The relation walk stopped at its limit, so a relation may exist beyond it."
const EXPRESSION_NOTE =
  "The resource type's permission expression failed, so it was treated as no match."
const EXPRESSION_ALLOW_NOTE =
  "The resource type's permission expression failed, so ReBAC's allow came from the relation walk."

/**
 * Why this beat that, in one or two sentences.
 *
 * Each sentence was checked against `mergeDecisions` and `Explain` for every
 * result that can select it. The two notes describe the ReBAC lane and are
 * added whenever it carries the flag, because both are true of that lane
 * whatever the merged verdict was.
 */
export function verdictSentence(result: PlaygroundResult): string {
  const lanes = inOrder(result)
  const abacOff = lanes.find((l) => l.model === "abac")?.state === "disabled"
  let sentence: string

  if (result.decision === "error") {
    const failed = lanes.find((l) => l.state === "error")
    sentence = failed
      ? `The ${MODEL_NAME[failed.model]} model failed, so no decision was returned.`
      : "A model failed, so no decision was returned."
  } else if (result.decision === "deny_explicit") {
    // RBAC and ReBAC are the two models an ABAC deny can override, and the
    // first of them that allowed is the one the deny displaced.
    const overridden = lanes.find(
      (l) => l.model !== "abac" && l.state === "allow"
    )
    sentence = overridden
      ? `An explicit deny overrides the ${MODEL_NAME[overridden.model]} allow.`
      : "A deny policy matched."
  } else if (result.decision === "allow") {
    const allowing = decidingLane(result)
    if (allowing === null) {
      sentence = "This check was allowed."
    } else if (abacOff) {
      sentence = `${MODEL_NAME[allowing]} allowed this check. Policy evaluation is off, so no deny policy could override it.`
    } else {
      sentence = `${MODEL_NAME[allowing]} allowed this check, and no deny policy matched.`
    }
  } else {
    sentence = "No model allowed this check."
  }

  const rebac = lanes.find((l) => l.model === "rebac")
  if (rebac?.walkTruncated) sentence += ` ${WALK_NOTE}`
  if (rebac?.expressionError) {
    // A failed expression is treated as no match, and the relation walk
    // supplies any allow. When that walk allowed, "no match" would say the
    // wrong thing.
    sentence += ` ${rebac.state === "allow" ? EXPRESSION_ALLOW_NOTE : EXPRESSION_NOTE}`
  }
  return sentence
}

const STATE_WORD: Record<LaneState, string> = {
  allow: "allow",
  deny: "deny",
  noMatch: "no match",
  skipped: "skipped",
  disabled: "disabled",
  error: "error",
  notEvaluated: "not evaluated",
}

const LINK_CLASS = "underline underline-offset-4"

/** Where a match's rule lives, for the sources that have a page for it. */
const MATCH_HREF: Record<string, (ruleId: string) => string> = {
  rbac: (id) => `/roles/${id}`,
  abac: (id) => `/policies/${id}`,
}

/**
 * One rule that decided a lane. A link needs text, so the recorded detail
 * leads and the rule id stands in for a match that recorded none. ReBAC
 * records no rule id and there is no page for one relation tuple, so its
 * match is plain text.
 */
function LaneMatch({ match }: { match: CheckMatch }) {
  const href =
    match.ruleId && Object.hasOwn(MATCH_HREF, match.source)
      ? MATCH_HREF[match.source](match.ruleId)
      : null
  const text = match.detail ? (
    match.detail
  ) : match.ruleId ? (
    <span className="font-mono text-xs">{match.ruleId}</span>
  ) : (
    <NoneCell label="detail" />
  )
  return href ? (
    <PluginLink to={href} className={LINK_CLASS}>
      {text}
    </PluginLink>
  ) : (
    <span>{text}</span>
  )
}

/** What ReBAC records for an allow it reached through a userset chain. */
const TRANSITIVE_DETAIL = "transitive: "

/**
 * Where the walk behind a transitive ReBAC allow is drawn, or null.
 *
 * Only an allow whose detail says it was transitive has a walk to draw: a
 * direct relation is one tuple, and an expression allow is decided outside the
 * walk. The relation the walk starts from is the check's action, which is how
 * ReBAC reads it, and the subject is the check's own. The path route has no
 * segment for an empty resource id, so a check on a type alone gets no link.
 */
export function walkGraphHref(
  lane: PlaygroundLane,
  input: PlaygroundInput | undefined
): string | null {
  if (lane.model !== "rebac" || lane.state !== "allow" || !input?.resourceId)
    return null
  if (
    !(lane.matchedBy ?? []).some((m) => m.detail?.startsWith(TRANSITIVE_DETAIL))
  )
    return null
  return relationGraphPath({
    objectType: input.resourceType,
    objectId: input.resourceId,
    relation: input.action,
    subject: { type: input.subjectKind, id: input.subjectId },
    namespace: input.namespacePath,
  })
}

function LaneDetail({ lane }: { lane: PlaygroundLane }) {
  const matches = lane.matchedBy ?? []
  switch (lane.state) {
    case "allow":
    case "deny":
      return (
        <>
          {matches.map((m, i) => (
            <LaneMatch key={`${i}-${m.source}-${m.ruleId ?? ""}`} match={m} />
          ))}
        </>
      )
    case "noMatch":
      if (lane.reason)
        return <span className="text-muted-foreground">{lane.reason}</span>
      // ABAC with no result has no reason. It is not always that no policy
      // matched: an allow policy whose condition threw is skipped too. RBAC
      // and ReBAC always give a reason.
      return lane.model === "abac" ? (
        <span className="text-muted-foreground">No policy applied.</span>
      ) : null
    case "skipped":
      return (
        <span className="text-muted-foreground">
          RBAC already allowed, so ReBAC did not run.
        </span>
      )
    case "disabled":
      return (
        <span className="text-muted-foreground">
          Turned off in warden's config.
        </span>
      )
    case "error":
      return lane.error ? (
        <span className="text-destructive">{lane.error}</span>
      ) : null
    case "notEvaluated":
      return (
        <span className="text-muted-foreground">
          An earlier model failed, so this one did not run.
        </span>
      )
  }
  return null
}

/**
 * One model's line in the playground: its name, what it did, and why.
 * `deciding` marks the lane the merge chose, with a left rule in the
 * foreground colour. On an allow or an explicit deny it "decided it". On any
 * other denial it only supplied the reason, so `reasonOnly` says it "gave the
 * reason". `input` is the check the lane belongs to, which a transitive ReBAC
 * allow needs to link to its walk. Render inside a list.
 */
export function LaneRow({
  lane,
  deciding,
  reasonOnly = false,
  input,
}: {
  lane: PlaygroundLane
  deciding: boolean
  reasonOnly?: boolean
  input?: PlaygroundInput
}) {
  const bad = lane.state === "deny" || lane.state === "error"
  const walkHref = walkGraphHref(lane, input)
  return (
    <li
      data-lane={lane.model}
      data-deciding={deciding ? "true" : undefined}
      className={cn(
        "grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-x-3 rounded-md border px-3 py-2 text-sm",
        deciding && "border-l-2 border-l-foreground"
      )}
    >
      <span className="font-medium">{MODEL_NAME[lane.model]}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={bad ? "font-medium text-destructive" : "font-medium"}
          >
            {STATE_WORD[lane.state]}
          </span>
          {deciding && (
            <Badge variant="outline">
              {reasonOnly ? "gave the reason" : "decided it"}
            </Badge>
          )}
        </span>
        <LaneDetail lane={lane} />
        {walkHref && (
          <PluginLink to={walkHref} className={cn(LINK_CLASS, "text-xs")}>
            Show this walk in the graph
          </PluginLink>
        )}
      </div>
    </li>
  )
}
