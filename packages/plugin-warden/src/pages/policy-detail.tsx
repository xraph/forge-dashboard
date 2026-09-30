import { useState } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription } from "@forge-go/dashboard-kit/components/alert"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { NamespaceCell } from "../components/namespace-filter"
import { PolicyEditor } from "../components/policy-editor"
import {
  PolicyRule,
  windowPhrase,
  windowTime,
  type PolicyDetail,
} from "../components/policy-rule"
import type { ConfigDetail } from "./config"
import type { AckResponse } from "./roles"

export const ABAC_OFF =
  "Policy evaluation is turned off in this deployment, so this policy takes no effect."

export const PRIORITY_HELP =
  "Decides which policy is cited when several match, not which one wins."

const LINK_CLASS = "text-sm underline underline-offset-4"

/**
 * The line for a policy that is not in effect, or null when it is.
 *
 * `state` is the server's, computed at read time. `inactive` wins over the
 * window states there, so an inactive policy with a closed window reads as
 * inactive, which is the thing to change first.
 *
 * With policy evaluation off, no policy takes effect whatever its state or
 * window, so these lines then describe only the switch and the window, and
 * promise nothing about activation or a start date.
 */
export function stateLine(p: PolicyDetail, evaluationOff: boolean, now: number): string | null {
  switch (p.state) {
    case "inactive":
      return inactiveLine(p, evaluationOff, now)
    case "scheduled":
      if (!p.notBefore) return evaluationOff ? null : "Not yet in effect."
      return evaluationOff
        ? `Its window opens on ${windowTime(p.notBefore)}.`
        : `Not yet in effect. It starts on ${windowTime(p.notBefore)}.`
    case "expired":
      if (!p.notAfter) return evaluationOff ? null : "No longer in effect."
      return evaluationOff
        ? `Its window ended on ${windowTime(p.notAfter)}.`
        : `No longer in effect. It ended on ${windowTime(p.notAfter)}.`
    case "never":
      return "Never in effect. Its end is before its start."
  }
  return null
}

/**
 * The state line for an inactive policy. "Until you activate it" is said only
 * where activating really would put it into effect: evaluation on, a window
 * that is open or absent, and conditions that can hold. A window that has
 * ended or ends before it starts keeps it out of effect activated or not, a
 * window that has not opened puts it into effect only on its date, and a
 * policy that never applies takes no effect in any state.
 */
function inactiveLine(p: PolicyDetail, evaluationOff: boolean, now: number): string {
  if (evaluationOff || p.neverApplies) return "Inactive."
  const closed = closedWindow(p, now)
  if (closed === "ended") return "Inactive, and its window has ended."
  if (closed === "inverted") return "Inactive, and its window ends before it starts."
  const start = p.notBefore ? Date.parse(p.notBefore) : Number.NaN
  if (p.notBefore && !Number.isNaN(start) && start > now) {
    return `Inactive. If you activate it, it takes effect on ${windowTime(p.notBefore)}.`
  }
  return "Inactive. It takes no effect until you activate it."
}

/**
 * What the deactivate dialog says. It opens for any policy with `isActive`
 * set, which includes one whose window keeps it out of effect already, so it
 * is worded by the server's state.
 */
export function deactivateSentence(p: PolicyDetail, evaluationOff: boolean): string {
  if (evaluationOff) return ABAC_OFF
  if (p.neverApplies) return "It already takes no effect, because it never applies."
  switch (p.state) {
    case "scheduled":
      return p.notBefore
        ? `It will not take effect on ${windowTime(p.notBefore)}.`
        : "It will not take effect."
    case "expired":
      return "It already takes no effect, because its window has ended."
    case "never":
      return "It already takes no effect, because its window ends before it starts."
  }
  return "It stops taking effect."
}

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

/**
 * How a sentence about what the policy does must be worded.
 *
 * `present` for an active policy. `once` for a policy that will take effect
 * without editing: scheduled, or inactive with a window that is open or has
 * not started. `would` for one that will not: expired, never in effect, or
 * inactive with a window that has ended or ends before it starts.
 */
export type Mood = "present" | "once" | "would"

export function moodOf(p: PolicyDetail, now: number): Mood {
  switch (p.state) {
    case "active":
      return "present"
    case "scheduled":
      return "once"
    case "expired":
    case "never":
      return "would"
  }
  return closedWindow(p, now) ? "would" : "once"
}

/** One sentence in the right mood. `who` is "this deny" or "it". */
function tensed(mood: Mood, who: string, does: string, would: string, rest: string): string {
  if (mood === "present") return `${who[0].toUpperCase()}${who.slice(1)} ${does} ${rest}`
  if (mood === "once") return `Once it is in effect, ${who} ${does} ${rest}`
  return `If it were in effect, ${who} would ${would} ${rest}`
}

/**
 * What the policy does when it is evaluated, as the callout says it. Empty
 * when it behaves as written.
 *
 * Each sentence was checked against the evaluator and the engine for every
 * policy that can carry the flag. `evaluateConditions` stops at the first
 * false and the first error; a deny that errors applies anyway, an allow
 * that errors is skipped. `evaluateABAC` loads only the policies of the
 * check's own namespace and its ancestors, so a policy reaches checks in its
 * namespace and below, and every scope sentence says so. Every flag is the
 * server's, never derived here.
 *
 * When `matchesEverything` is set it is always said, whatever else is set:
 * a deny that fails closed with nothing narrowing it denies every check in
 * its namespace and below, and that is the consequence to state. The server
 * never sets it together with `neverApplies`.
 */
export function effectSentences(p: PolicyDetail, now: number): string[] {
  const d = p.decidingCondition
  const conditions = p.conditions ?? []
  const mood = moodOf(p, now)
  const out: string[] = []
  if (p.failsClosed && d !== undefined) {
    out.push(
      `Condition ${d + 1} cannot be evaluated, so warden treats it, and every condition after it, as met.`
    )
    if (!p.matchesEverything) {
      out.push(
        d === 0
          ? tensed(
              mood,
              "this deny",
              "applies",
              "apply",
              "to every check in its namespace and below that its subjects, actions and resources select."
            )
          : tensed(
              mood,
              "this deny",
              "applies",
              "apply",
              "to the checks it selects in its namespace and below whenever the conditions before it hold."
            )
      )
    }
  } else if (p.neverApplies && d !== undefined) {
    return conditions[d]?.problem === "throws"
      ? [`Condition ${d + 1} cannot be evaluated, so this allow never grants anything.`]
      : [`Condition ${d + 1} is always false, so this policy never applies.`]
  }
  if (p.matchesEverything) {
    out.push(tensed(mood, "it", "matches", "match", "every check in its namespace and below."))
  }
  return out
}

/**
 * What the activate dialog says, for an inactive policy.
 *
 * Evaluation off: nothing it does takes effect, activated or not. A window
 * that has ended or is inverted: activating will not put it into effect, so
 * no "once it is in effect" sentence may show. Otherwise the callout's own
 * sentences, which are the "once" forms, and the window they apply inside.
 */
export function activateSentences(p: PolicyDetail, now: number, evaluationOff: boolean): string[] {
  if (evaluationOff) return [ABAC_OFF]
  const closed = closedWindow(p, now)
  if (closed === "inverted") {
    return ["Its window ends before it starts, so activating it will not put it into effect."]
  }
  if (closed === "ended") {
    return ["Its window has ended, so activating it will not put it into effect."]
  }
  const inEffect = windowPhrase(p.notBefore, p.notAfter)
  const effect = effectSentences(p, now)
  // Nothing to warn about and no window: it takes effect the moment it is
  // active, and the dialog says so rather than saying nothing.
  if (effect.length === 0 && !inEffect) return ["It takes effect as soon as you activate it."]
  return [...effect, ...(inEffect ? [`In effect ${inEffect}.`] : [])]
}

/**
 * The page's props. The edit route renders this page with `editing` set, and
 * the rule block is then the editor. The URL always says which mode you are
 * in: Edit goes to `/policies/<id>/edit`, and Cancel and a successful Save
 * come back to `/policies/<id>`.
 */
export type PolicyPageProps = PluginPageProps & { editing?: boolean }

export function WardenPolicyDetailPage({ params, editing = false }: PolicyPageProps) {
  const id = params.id as string
  const detail = useQuery<PolicyDetail>("policies.detail", { id })
  const config = useQuery<ConfigDetail>("config.detail")
  const setActive = useCommand<AckResponse>("policies.setActive")
  const remove = useCommand<AckResponse>("policies.delete")
  const navigate = useNavigateTo()

  // The clock the mood of each sentence is judged against. Read once on
  // mount, and again when the activate dialog opens, so the dialog judges a
  // window against the moment the operator is deciding.
  const [now, setNow] = useState(() => Date.now())
  // The value the open dialog would set, or null when it is closed.
  const [target, setTarget] = useState<boolean | null>(null)
  const [deleting, setDeleting] = useState(false)
  // `policies.delete` invalidates the detail this page is showing, and its
  // refetch would fail, so once a delete succeeds the page stops rendering
  // the policy at once rather than waiting on the navigation.
  const [deleted, setDeleted] = useState(false)

  // Only an explicit false. A config that failed to load says nothing, and the
  // page must not claim evaluation is off on the strength of an error.
  //
  // There is deliberately no matching alert for rbacEnabled. With RBAC off,
  // evaluateABAC resolves the subject's roles itself (engine.go), so role
  // subjects still match, and any sentence saying they do not would be false.
  const abacOff = config.data?.abacEnabled === false

  function openToggle(active: boolean) {
    // Reset at open, not at close, so a refusal from an earlier attempt is
    // not shown against this one.
    setActive.reset()
    setNow(Date.now())
    setTarget(active)
  }

  async function confirmToggle() {
    if (target === null) return
    const result = await setActive.execute({ id, active: target })
    // execute() resolves undefined only when the client throws, so this is
    // the success check. A refusal leaves the dialog open with its error.
    if (result !== undefined) setTarget(null)
  }

  async function confirmDelete() {
    const result = await remove.execute({ id })
    if (result === undefined) return
    setDeleted(true)
    navigate("/policies")
  }

  if (deleted) {
    return (
      <ZeroState
        title="This policy has been deleted."
        action={
          <PluginLink to="/policies" className={LINK_CLASS}>
            Back to policies
          </PluginLink>
        }
      />
    )
  }

  return (
    <QueryBoundary title="Policy" query={detail} skeletonRows={4}>
      {(policy) => {
        if (editing) {
          return (
            <section className="flex flex-col gap-6">
              <PageHeader title={policy.name} description="Editing this policy." />
              {abacOff && (
                <Alert>
                  <AlertDescription>{ABAC_OFF}</AlertDescription>
                </Alert>
              )}
              <PolicyEditor policy={policy} evaluationOff={abacOff} />
            </section>
          )
        }

        const state = stateLine(policy, abacOff, now)
        // Above the block: the state when the policy is not in effect, and
        // what it does when evaluated, in the mood its state allows. With
        // evaluation off nothing it would do happens at all, and the ABAC
        // alert says so instead.
        const effect = abacOff ? [] : effectSentences(policy, now)
        const onActivate = activateSentences(policy, now, abacOff)

        return (
          <section className="flex flex-col gap-6">
            <PageHeader
              title={policy.name}
              description={policy.description || undefined}
              actions={
                <>
                  <Button variant="outline" onClick={() => navigate(`/policies/${id}/edit`)}>
                    Edit
                  </Button>
                  {policy.isActive && (
                    <Button variant="outline" onClick={() => openToggle(false)}>
                      Deactivate
                    </Button>
                  )}
                  {/* Outline, not destructive: on this page colour means
                      "this overrides", and only the Deny heading carries it. */}
                  <Button
                    variant="outline"
                    onClick={() => {
                      remove.reset()
                      setDeleting(true)
                    }}
                  >
                    Delete
                  </Button>
                </>
              }
            />

            {abacOff && (
              <Alert>
                <AlertDescription>{ABAC_OFF}</AlertDescription>
              </Alert>
            )}

            <DetailLayout
              aside={
                <DescriptionList
                  items={[
                    {
                      term: "Priority",
                      value: (
                        <span className="flex flex-col gap-0.5">
                          <span className="tabular-nums">{policy.priority}</span>
                          <span className="text-xs text-muted-foreground">{PRIORITY_HELP}</span>
                        </span>
                      ),
                    },
                    { term: "Version", value: <span className="tabular-nums">{policy.version}</span> },
                    { term: "Namespace", value: <NamespaceCell path={policy.namespacePath} /> },
                    {
                      term: "Created by",
                      value: policy.createdBy ? (
                        <span className="font-mono text-xs">{policy.createdBy}</span>
                      ) : (
                        <NoneCell label="creator" />
                      ),
                    },
                    {
                      term: "Updated by",
                      value: policy.updatedBy ? (
                        <span className="font-mono text-xs">{policy.updatedBy}</span>
                      ) : (
                        <NoneCell label="updater" />
                      ),
                    },
                    {
                      term: "Created",
                      value: <Timestamp value={policy.createdAt} label="creation time" />,
                    },
                    {
                      term: "Updated",
                      value: <Timestamp value={policy.updatedAt} label="updated at" />,
                    },
                  ]}
                />
              }
              main={
                <div className="flex flex-col gap-3">
                  {state !== null && (
                    <div
                      data-testid="policy-state"
                      className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"
                    >
                      <p>{state}</p>
                      {policy.state === "inactive" && (
                        <Button size="sm" onClick={() => openToggle(true)}>
                          Activate
                        </Button>
                      )}
                    </div>
                  )}
                  {effect.length > 0 && (
                    <Alert>
                      <AlertDescription data-testid="policy-callout">
                        {effect.join(" ")}
                      </AlertDescription>
                    </Alert>
                  )}
                  <PolicyRule policy={policy} evaluationOff={abacOff} />
                </div>
              }
            />

            {/* Errors live inside the dialog that can fail. Base UI marks
                everything outside an open dialog inert, so an alert on the
                page body is unreachable while the dialog is open. */}
            <ConfirmDialog
              open={target !== null}
              onOpenChange={(open) => !open && setTarget(null)}
              title={target ? `Activate ${policy.name}?` : `Deactivate ${policy.name}?`}
              destructive={false}
              confirmLabel={target ? "Activate" : "Deactivate"}
              pending={setActive.loading}
              onConfirm={() => void confirmToggle()}
              description={
                <span className="flex flex-col gap-2">
                  {target ? (
                    onActivate.map((s) => <span key={s}>{s}</span>)
                  ) : (
                    <span>
                      {deactivateSentence(policy, abacOff)}
                    </span>
                  )}
                  <CommandAlert
                    error={setActive.error}
                    title={target ? "Could not activate" : "Could not deactivate"}
                  />
                </span>
              }
            />

            <ConfirmDialog
              open={deleting}
              onOpenChange={setDeleting}
              title={`Delete ${policy.name}?`}
              destructive={false}
              confirmLabel="Delete"
              pending={remove.loading}
              onConfirm={() => void confirmDelete()}
              description={
                <span className="flex flex-col gap-2">
                  <span>This cannot be undone.</span>
                  <CommandAlert error={remove.error} title="Could not delete" />
                </span>
              }
            />
          </section>
        )
      }}
    </QueryBoundary>
  )
}

/** The edit route: the same page, with the rule block as the editor. */
export function WardenPolicyEditPage(props: PluginPageProps) {
  return <WardenPolicyDetailPage {...props} editing />
}
