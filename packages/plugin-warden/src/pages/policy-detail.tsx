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
 */
export function stateLine(p: PolicyDetail): string | null {
  switch (p.state) {
    case "inactive":
      return "Inactive. It takes no effect until you activate it."
    case "scheduled":
      return p.notBefore
        ? `Not yet in effect. It starts on ${windowTime(p.notBefore)}.`
        : "Not yet in effect."
    case "expired":
      return p.notAfter
        ? `No longer in effect. It ended on ${windowTime(p.notAfter)}.`
        : "No longer in effect."
    case "never":
      return "Never in effect. Its end is before its start."
  }
  return null
}

/**
 * What the policy does when it is evaluated, as the callout says it. Empty
 * when it behaves as written.
 *
 * Each sentence was checked against the evaluator (`evaluateConditions` stops
 * at the first false and the first error; a deny that errors applies anyway,
 * an allow that errors is skipped) for every policy that can carry the flag.
 * Every flag is the server's, never derived here.
 *
 * The fail-closed and matches-every-check sentences say what the policy does
 * when it takes effect. For a policy that is not in effect now (inactive, not
 * yet in effect, expired, never in effect) the present tense would be false,
 * so they read "Once it is in effect, ...". The never-applies sentences are
 * true whatever the state, so they keep one form.
 */
export function effectSentences(p: PolicyDetail): string[] {
  const d = p.decidingCondition
  const conditions = p.conditions ?? []
  // `rest` starts lower case: "this deny applies ...".
  const when = (rest: string) =>
    p.state === "active" ? rest[0].toUpperCase() + rest.slice(1) : `Once it is in effect, ${rest}`
  if (p.failsClosed && d !== undefined) {
    return [
      `Condition ${d + 1} cannot be evaluated, so warden treats it, and every condition after it, as met.`,
      d === 0
        ? when("this deny applies to every check its subjects, actions and resources select.")
        : when("this deny applies whenever the conditions before it hold."),
    ]
  }
  if (p.neverApplies && d !== undefined) {
    return conditions[d]?.problem === "throws"
      ? [`Condition ${d + 1} cannot be evaluated, so this allow never grants anything.`]
      : [`Condition ${d + 1} is always false, so this policy never applies.`]
  }
  if (p.matchesEverything) {
    return [when("it matches every check in its namespace and below.")]
  }
  return []
}

/**
 * The page's props. The edit route renders this page with `editing` set, so
 * the create flow, which lands on `/policies/<id>/edit`, never meets a missing
 * route. Until the editor exists the flag changes nothing and both routes
 * show the read view.
 */
export type PolicyPageProps = PluginPageProps & { editing?: boolean }

export function WardenPolicyDetailPage({ params }: PolicyPageProps) {
  const id = params.id as string
  const detail = useQuery<PolicyDetail>("policies.detail", { id })
  const config = useQuery<ConfigDetail>("config.detail")
  const setActive = useCommand<AckResponse>("policies.setActive")
  const remove = useCommand<AckResponse>("policies.delete")
  const navigate = useNavigateTo()

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
        const state = stateLine(policy)
        // Above the block: the state when the policy is not in effect, and
        // what it does when evaluated, worded for whether it is in effect
        // now. With evaluation off nothing it would do happens at all, and
        // the ABAC alert says so instead.
        const effect = abacOff ? [] : effectSentences(policy)
        const inEffect = windowPhrase(policy.notBefore, policy.notAfter)
        // What activating will do, in the callout's own words. Only an
        // inactive policy is offered Activate, so these are the conditional
        // forms, and the window says when "in effect" is.
        const onActivate = abacOff
          ? [ABAC_OFF]
          : [
              ...effectSentences(policy),
              ...(inEffect ? [`In effect ${inEffect}.`] : []),
            ]

        return (
          <section className="flex flex-col gap-6">
            <PageHeader
              title={policy.name}
              description={policy.description || undefined}
              actions={
                <>
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
                  <PolicyRule policy={policy} />
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
                    <span>It takes no effect until you activate it again.</span>
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

/** The edit route. Renders the read view until the editor exists. */
export function WardenPolicyEditPage(props: PluginPageProps) {
  return <WardenPolicyDetailPage {...props} editing />
}
